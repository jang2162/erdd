import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir as osTmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiClient } from '../client.js'
import { DEFAULT_NAMING_RULES } from '@erdd/core'
import { readConfig } from '../config.js'
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
