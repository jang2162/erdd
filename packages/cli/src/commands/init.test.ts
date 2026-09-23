import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir as osTmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiClient } from '../client.js'
import { createEmptyModel, DEFAULT_NAMING_RULES, DEFAULT_TABLE_OPTIONS, modelToFiles } from '@erdd/core'
import { readConfig, writeConfig } from '../config.js'
import { readTree } from '../tree.js'
import { CliError } from '../output.js'
import { init } from './init.js'

async function tmpdir(): Promise<string> {
  return mkdtemp(join(osTmpdir(), 'erdd-init-'))
}

let dir: string
let out: string[]
beforeEach(async () => {
  dir = await tmpdir()
  out = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})
afterEach(() => vi.restoreAllMocks())

function stubClient(): ApiClient {
  return {
    query: vi.fn(async (path: string) => {
      if (path === 'auth.me') return { id: 'u1', email: 'u1@test.dev', name: '사용자1', role: 'user' }
      if (path === 'org.list') return [{ id: 'o1', name: '스모크조직', role: 'owner' }]
      if (path === 'project.list') return [{ id: 'p1', name: '커머스' }]
      if (path === 'project.get') {
        return {
          name: '커머스', dialects: ['postgresql'],
          namingRules: { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30 },
        }
      }
      throw new Error(`unexpected ${path}`)
    }) as ApiClient['query'],
    mutate: vi.fn(async (path: string) => {
      throw new Error(`unexpected mutate ${path}`)
    }) as ApiClient['mutate'],
  }
}

describe('init', () => {
  it('비대화형 인자로 config·credentials·gitignore를 만든다', async () => {
    const code = await init({
      cwd: dir, json: true, yes: true, strict: false, client: stubClient(),
      serverUrl: 'https://erdd.example.com', token: 'erdd_pat_x', projectId: 'p1',
    })
    expect(code).toBe(0)
    expect(await readFile(join(dir, 'erdd.config.yaml'), 'utf8')).toContain('projectId: p1')
    expect(await readFile(join(dir, '.erdd/credentials.json'), 'utf8')).toContain('erdd_pat_x')
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toContain('.erdd/')
    expect(JSON.parse(out.join(''))).toMatchObject({ projectId: 'p1', projectName: '커머스' })
  })

  it('대화형이면 서버·토큰을 묻고 조직·프로젝트를 고르게 한다', async () => {
    const prompt = vi.fn(async (q: string) => (q.includes('서버') ? 'https://erdd.example.com' : 'erdd_pat_x'))
    const choose = vi.fn(async (_q: string, opts: { id: string }[]) => opts[0]!.id)
    const code = await init({
      cwd: dir, json: true, yes: true, strict: false, client: stubClient(), prompt, choose,
    })
    expect(code).toBe(0)
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(choose).toHaveBeenCalledTimes(2)   // 조직, 프로젝트
  })

  it('이미 config가 있으면 확인을 받고 거절하면 CANCELLED다', async () => {
    await init({
      cwd: dir, json: true, yes: true, strict: false, client: stubClient(),
      serverUrl: 'https://x', token: 't', projectId: 'p1',
    })
    out.length = 0
    const confirm = vi.fn(async () => false)
    const code = await init({
      cwd: dir, json: true, yes: false, strict: false, client: stubClient(), confirm,
      serverUrl: 'https://x', token: 't', projectId: 'p1',
    })
    expect(confirm).toHaveBeenCalled()
    expect(code).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('CANCELLED')
  })

  it('토큰이 유효하지 않으면 UNAUTHORIZED로 끝난다', async () => {
    const client: ApiClient = {
      query: vi.fn(async () => {
        throw new CliError('UNAUTHORIZED', '토큰이 유효하지 않습니다')
      }) as ApiClient['query'],
      mutate: vi.fn(async () => {
        throw new CliError('UNAUTHORIZED', '토큰이 유효하지 않습니다')
      }) as ApiClient['mutate'],
    }
    const code = await init({
      cwd: dir, json: true, yes: true, strict: false, client,
      serverUrl: 'https://x', token: 'bad', projectId: 'p1',
    })
    expect(code).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('UNAUTHORIZED')
  })

  describe('재-init 의 구독', () => {
    const connect = { json: true, yes: true, strict: false, serverUrl: 'https://erdd.example.com', token: 't' }
    async function subscribed(): Promise<void> {
      await init({ ...connect, cwd: dir, client: stubClient(), projectId: 'p1' })
      await writeConfig(dir, { ...(await readConfig(dir)), dictionaries: [{ id: 'L1', name: '표준' }] })
    }

    it('같은 서버·프로젝트로 다시 연결하면 구독을 잇는다', async () => {
      await subscribed()
      expect(await init({ ...connect, cwd: dir, client: stubClient(), projectId: 'p1' })).toBe(0)
      expect((await readConfig(dir)).dictionaries).toEqual([{ id: 'L1', name: '표준' }])
    })

    it('다른 프로젝트나 다른 서버로 연결하면 구독을 비운다', async () => {
      await subscribed()
      expect(await init({ ...connect, cwd: dir, client: stubClient(), projectId: 'p2' })).toBe(0)
      expect((await readConfig(dir)).dictionaries).toEqual([])

      await subscribed()
      expect(await init({ ...connect, serverUrl: 'https://other.example.com', cwd: dir, client: stubClient(), projectId: 'p1' })).toBe(0)
      expect((await readConfig(dir)).dictionaries).toEqual([])
    })
  })
})

describe('init --local', () => {
  it('서버 호출 없이 연결 설정 없는 config 를 만든다', async () => {
    const dir = await tmpdir()
    const code = await init({ cwd: dir, json: true, yes: true, strict: false, local: true })
    expect(code).toBe(0)
    const config = await readConfig(dir)
    expect(config.serverUrl).toBeNull()
    expect(config.projectId).toBeNull()
    expect(config.dialects.length).toBeGreaterThan(0)
  })

  it('.gitignore 에 .erdd/ 를 넣는다', async () => {
    const dir = await tmpdir()
    await init({ cwd: dir, json: true, yes: true, strict: false, local: true })
    expect(await readFile(join(dir, '.gitignore'), 'utf8')).toContain('.erdd/')
  })

  it('이미 config 가 있으면 덮어쓰지 않고 실패한다', async () => {
    const dir = await tmpdir()
    await init({ cwd: dir, json: true, yes: true, strict: false, local: true })
    const code = await init({ cwd: dir, json: true, yes: true, strict: false, local: true })
    expect(code).toBe(1)
  })
  it('--local 은 --dialect·--case 를 config 에 싣고 나머지 명명 규칙은 기본값 그대로다', async () => {
    const code = await init({
      cwd: dir, json: true, yes: false, strict: false,
      local: true, dialect: 'mysql', namingCase: 'lower_snake',
    })
    expect(code).toBe(0)
    const config = await readConfig(dir)
    expect(config.dialects).toEqual(['mysql'])
    expect(config.namingRules).toEqual({
      ...DEFAULT_NAMING_RULES, case: 'lower_snake',
    })
  })

  it('--local 의 기본값은 postgresql · UPPER_SNAKE 다', async () => {
    expect(await init({ cwd: dir, json: true, yes: false, strict: false, local: true })).toBe(0)
    const config = await readConfig(dir)
    expect(config.dialects).toEqual(['postgresql'])
    expect(config.namingRules).toEqual(DEFAULT_NAMING_RULES)
  })
})

describe('init --create', () => {
  const ORG = '018f6b0e-0000-7000-8000-00000000000a'
  const CREATED = '018f6b0e-0000-7000-8000-0000000000f1'
  function createClient(opts: { forbid?: boolean } = {}) {
    const calls: { path: string; input: unknown }[] = []
    const c: ApiClient = {
      query: vi.fn(async (path: string) => {
        if (path === 'auth.me') return { id: 'u1', email: 'u1@test.dev', name: '사용자1', role: 'user' }
        if (path === 'org.list') return [{ id: ORG, name: '플랫폼팀', role: 'owner' }]
        throw new Error(`unexpected ${path}`)
      }) as ApiClient['query'],
      mutate: vi.fn(async (path: string, input: unknown) => {
        calls.push({ path, input })
        if (path !== 'project.create') throw new Error(`unexpected mutate ${path}`)
        // 서버 project.create 의 실제 문구(apps/server routers/project.ts, token-api.test.ts 가 잠근다)
        if (opts.forbid) throw new CliError('FORBIDDEN', '프로젝트 생성 권한이 없습니다')
        return { id: CREATED, name: (input as { name: string }).name }
      }) as ApiClient['mutate'],
    }
    return { client: c, calls }
  }
  const base = {
    json: true, yes: true, strict: false, serverUrl: 'https://erdd.example.com', token: 'erdd_pat_x',
    create: true, org: '플랫폼팀', name: '주문시스템',
  }
  const emptyServer = {
    query: async (p: string) => (p === 'model.get' ? { model: createEmptyModel(), seq: 0 } : null),
    mutate: async () => null,
  } as unknown as ApiClient
  async function planAgainstEmptyServer() {
    const { buildPlan } = await import('../plan.js')
    return buildPlan(dir, { serverUrl: 'https://erdd.example.com', projectId: CREATED }, emptyServer)
  }

  it('새 디렉터리: 프로젝트를 만들고 빈 모델을 기준선으로 연결한다', async () => {
    const { client, calls } = createClient()
    expect(await init({ ...base, cwd: dir, client, dialect: 'mysql' })).toBe(0)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      path: 'project.create',
      input: {
        orgId: ORG, name: '주문시스템', dialects: ['mysql'],
        namingRules: DEFAULT_NAMING_RULES, tableOptions: DEFAULT_TABLE_OPTIONS,
      },
    })
    const cfg = await readConfig(dir)
    expect(cfg).toMatchObject({ serverUrl: 'https://erdd.example.com', projectId: CREATED, dialects: ['mysql'], dictionaries: [] })
    expect(await readFile(join(dir, '.erdd/credentials.json'), 'utf8')).toContain('erdd_pat_x')
    const emptyTree = modelToFiles(createEmptyModel()).tree
    expect(JSON.parse(await readFile(join(dir, '.erdd/base.json'), 'utf8'))).toEqual(emptyTree)
    expect(JSON.parse(await readFile(join(dir, '.erdd/sync.json'), 'utf8'))).toMatchObject({ revisionSeq: 0 })
    // erdd/ 도 빈 서버를 pull 한 것과 같다 — 비어 있으면 push·diff 가 「erdd/ 아래에 파일이 없습니다」로 막힌다.
    expect(await readTree(dir)).toEqual(emptyTree)
    const plan = await planAgainstEmptyServer()
    expect(plan).toMatchObject({ ops: [], conflicts: [] })
    expect(JSON.parse(out.join(''))).toEqual({
      configPath: 'erdd.config.yaml', projectId: CREATED, projectName: '주문시스템', migrated: false,
    })
  })

  it('--case 를 명명 규칙에 싣고, 조직은 id 로도 고른다', async () => {
    const { client, calls } = createClient()
    expect(await init({ ...base, org: ORG, cwd: dir, client, namingCase: 'lower_snake' })).toBe(0)
    expect(calls[0]!.input).toMatchObject({
      orgId: ORG, dialects: ['postgresql'], namingRules: { ...DEFAULT_NAMING_RULES, case: 'lower_snake' },
    })
  })

  it('조직을 찾지 못하면 NOT_FOUND 이고 아무것도 만들지 않는다', async () => {
    const { client, calls } = createClient()
    expect(await init({ ...base, org: '없는팀', cwd: dir, client })).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('NOT_FOUND')
    expect(calls).toEqual([])
    expect(existsSync(join(dir, 'erdd.config.yaml'))).toBe(false)
  })

  it('--org 가 없으면 대화형으로 조직을 고르고, 비대화형이면 USAGE', async () => {
    const { client } = createClient()
    expect(await init({ ...base, org: undefined, cwd: dir, client })).toBe(2)
    const choose = vi.fn(async (_q: string, opts: { id: string }[]) => opts[0]!.id)
    const second = createClient()
    expect(await init({ ...base, org: undefined, cwd: dir, client: second.client, choose })).toBe(0)
    expect(choose).toHaveBeenCalledTimes(1)
    expect(second.calls[0]!.input).toMatchObject({ orgId: ORG })
  })

  it('로컬 전용 프로젝트를 이관한다 — erdd/ 는 그대로, config 의 규칙을 생성값으로 보낸다', async () => {
    await init({ cwd: dir, json: true, yes: false, strict: false, local: true, dialect: 'oracle', namingCase: 'lower_snake' })
    await mkdir(join(dir, 'erdd'), { recursive: true })
    await writeFile(join(dir, 'erdd/words.yaml'), 'words:\n  - logicalName: 주문\n    abbreviation: ORD\n')
    const before = await readFile(join(dir, 'erdd/words.yaml'), 'utf8')
    out.length = 0
    const { client, calls } = createClient()
    expect(await init({ ...base, cwd: dir, client })).toBe(0)
    expect(calls[0]!.input).toMatchObject({
      dialects: ['oracle'],
      namingRules: { ...DEFAULT_NAMING_RULES, case: 'lower_snake' },
      tableOptions: DEFAULT_TABLE_OPTIONS,
    })
    expect(await readFile(join(dir, 'erdd/words.yaml'), 'utf8')).toBe(before)
    // 이관은 erdd/ 에 파일을 더하지도 않는다 — 빈 트리의 다른 파일(groups.yaml 등)이 생기면 안 된다.
    expect(Object.keys(await readTree(dir))).toEqual(['erdd/words.yaml'])
    const cfg = await readConfig(dir)
    expect(cfg).toMatchObject({ serverUrl: 'https://erdd.example.com', projectId: CREATED, dialects: ['oracle'] })
    expect(JSON.parse(out.join(''))).toMatchObject({ migrated: true })

    // 기준선이 빈 모델이라 다음 push 는 로컬 스키마 전부를 「추가」로 올린다.
    const plan = await planAgainstEmptyServer()
    expect(plan.conflicts).toEqual([])
    expect(plan.ops.length).toBeGreaterThan(0)
    expect(plan.ops.every((op) => op.action === 'create')).toBe(true)
  })

  it('이관은 확인을 받는다 — 비대화형에 --yes 가 없으면 멈춘다', async () => {
    await init({ cwd: dir, json: true, yes: false, strict: false, local: true })
    out.length = 0
    const { client, calls } = createClient()
    expect(await init({ ...base, yes: false, cwd: dir, client })).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('CANCELLED')
    expect(calls).toEqual([])
    expect((await readConfig(dir)).projectId).toBeNull()
  })

  it('이관 확인을 대화형으로 받으면 진행하고, 거절하면 서버를 부르지 않는다', async () => {
    await init({ cwd: dir, json: true, yes: false, strict: false, local: true })
    const no = createClient()
    const confirmNo = vi.fn(async () => false)
    expect(await init({ ...base, yes: false, cwd: dir, client: no.client, confirm: confirmNo })).toBe(1)
    expect(confirmNo).toHaveBeenCalledWith('이 로컬 프로젝트를 서버 프로젝트 "주문시스템"로 연결합니다. 계속할까요?')
    expect(no.calls).toEqual([])

    const yes = createClient()
    expect(await init({ ...base, yes: false, cwd: dir, client: yes.client, confirm: async () => true })).toBe(0)
    expect(yes.calls).toHaveLength(1)
  })

  it('이관에 --dialect·--case 를 주면 USAGE', async () => {
    await init({ cwd: dir, json: true, yes: false, strict: false, local: true })
    const { client, calls } = createClient()
    expect(await init({ ...base, cwd: dir, client, dialect: 'mysql' })).toBe(2)
    expect(await init({ ...base, cwd: dir, client, namingCase: 'lower_snake' })).toBe(2)
    expect(calls).toEqual([])
  })

  it('이미 연결된 config 면 거절한다', async () => {
    const { client } = createClient()
    expect(await init({ ...base, cwd: dir, client })).toBe(0)
    out.length = 0
    const again = createClient()
    expect(await init({ ...base, cwd: dir, client: again.client })).toBe(1)
    expect(out.join('')).toContain('--project')
    expect(again.calls).toEqual([])
  })

  it('생성 권한이 없으면 관리자에게 요청하라고 안내한다', async () => {
    const { client } = createClient({ forbid: true })
    expect(await init({ ...base, cwd: dir, client })).toBe(1)
    const err = JSON.parse(out.join('')).error
    expect(err.code).toBe('FORBIDDEN')
    expect(err.message).toContain('--project <id>')
    expect(existsSync(join(dir, 'erdd.config.yaml'))).toBe(false)
    expect(existsSync(join(dir, '.erdd'))).toBe(false)
  })

  it('사람용 출력은 새 디렉터리와 이관을 구분해 다음 할 일을 안내한다', async () => {
    const human = { ...base, json: false }
    expect(await init({ ...human, cwd: dir, client: createClient().client })).toBe(0)
    expect(out.join('')).toBe('서버 프로젝트 주문시스템을(를) 만들어 연결했습니다. erdd serve로 편집을 시작하세요.\n')

    const dir2 = await tmpdir()
    await init({ cwd: dir2, json: true, yes: false, strict: false, local: true })
    out.length = 0
    expect(await init({ ...human, cwd: dir2, client: createClient().client })).toBe(0)
    expect(out.join('')).toBe('서버 프로젝트 주문시스템을(를) 만들어 연결했습니다. erdd diff로 확인한 뒤 erdd push로 올리세요.\n')
  })
})
