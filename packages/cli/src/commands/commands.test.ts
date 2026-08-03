import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyModel, type ProjectModel } from '@erdd/core'
import { writeConfig } from '../config.js'
import { readTree, writeTree } from '../tree.js'
import type { ApiClient } from '../client.js'
import { pull } from './pull.js'
import { status } from './status.js'
import { validate } from './validate.js'

let dir: string
let out: string[]
let err: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-cmd-'))
  out = []; err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
  await writeConfig(dir, {
    serverUrl: 'https://erdd.example.com',
    projectId: '018f6b0e-0000-7000-8000-000000000000',
    dialects: ['postgresql'],
    namingRules: { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 },
  })
})
afterEach(() => vi.restoreAllMocks())

function model(): ProjectModel {
  const m = createEmptyModel()
  m.tables['tb1'] = {
    id: 'tb1', logicalName: '회원', physicalName: 'MBR', comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 'tb1', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT',
    isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0,
    comment: null, domainId: null, custom: {},
  }
  return m
}

function stubClient(overrides: Partial<Record<string, unknown>> = {}): ApiClient {
  return {
    query: vi.fn(async (path: string) => {
      if (path === 'project.get') {
        return {
          id: 'p1', name: '커머스', dialects: ['postgresql'],
          namingRules: { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 },
          ...(overrides['project.get'] as object ?? {}),
        }
      }
      if (path === 'model.get') return { model: model(), seq: 42, ...(overrides['model.get'] as object ?? {}) }
      throw new Error(`unexpected ${path}`)
    }) as ApiClient['query'],
  }
}

describe('pull', () => {
  it('파일 트리·base·sync를 쓴다', async () => {
    const code = await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    expect(code).toBe(0)
    const tree = await readTree(dir)
    expect(Object.keys(tree)).toContain('erdd/tables/MBR.yaml')
    expect(JSON.parse(await readFile(join(dir, '.erdd/sync.json'), 'utf8'))).toMatchObject({ revisionSeq: 42 })
    expect(JSON.parse(out.join(''))).toMatchObject({ revisionSeq: 42, tables: 1 })
  })

  it('서버의 방언·명명 규칙을 config에 갱신한다', async () => {
    await pull({
      cwd: dir, json: true, yes: false, strict: false,
      client: stubClient({ 'project.get': { dialects: ['oracle'], namingRules: { case: 'lower_snake', separator: '', maxLengthBytes: 20 } } }),
    })
    const raw = await readFile(join(dir, 'erdd.config.yaml'), 'utf8')
    expect(raw).toContain('oracle')
    expect(raw).toContain('lower_snake')
  })

  it('로컬 변경이 있으면 확인을 받고, 거절하면 CANCELLED로 끝난다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    out.length = 0
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'id: tb1\nname: CHANGED\n', 'utf8')
    const confirm = vi.fn(async () => false)
    const code = await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient(), confirm })
    expect(confirm).toHaveBeenCalled()
    expect(code).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('CANCELLED')
    expect(await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')).toContain('CHANGED')
  })

  it('--yes면 확인 없이 덮어쓴다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'id: tb1\nname: CHANGED\n', 'utf8')
    const confirm = vi.fn(async () => false)
    const code = await pull({ cwd: dir, json: true, yes: true, strict: false, client: stubClient(), confirm })
    expect(confirm).not.toHaveBeenCalled()
    expect(code).toBe(0)
    expect(await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')).toContain('MBR')
  })

  it('최초 pull은 base가 없으므로 확인하지 않는다', async () => {
    const confirm = vi.fn(async () => false)
    const code = await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient(), confirm })
    expect(confirm).not.toHaveBeenCalled()
    expect(code).toBe(0)
  })
})

describe('status', () => {
  it('pull 직후에는 변경이 없다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    out.length = 0
    const code = await status({ cwd: dir, json: true, yes: false, strict: false })
    expect(code).toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({
      revisionSeq: 42, changes: { added: [], modified: [], deleted: [] },
    })
  })

  it('파일을 고치면 modified로 잡는다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    out.length = 0
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'id: tb1\nname: CHANGED\n', 'utf8')
    await status({ cwd: dir, json: true, yes: false, strict: false })
    expect(JSON.parse(out.join('')).changes.modified).toEqual(['erdd/tables/MBR.yaml'])
  })

  it('status는 서버를 부르지 않는다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    const client = stubClient()
    await status({ cwd: dir, json: true, yes: false, strict: false, client })
    expect(client.query).not.toHaveBeenCalled()
  })
})

describe('validate', () => {
  it('정상 트리는 0으로 끝난다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    out.length = 0
    const code = await validate({ cwd: dir, json: true, yes: false, strict: false })
    expect(code).toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({ ok: true, parseErrors: [], integrityIssues: [] })
  })

  it('해소되지 않는 이름 참조는 parseErrors로 잡고 1로 끝난다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    const tree = await readTree(dir)
    ;(tree['erdd/tables/MBR.yaml'] as Record<string, unknown>)['group'] = '없는그룹'
    await writeTree(dir, tree)
    out.length = 0
    const code = await validate({ cwd: dir, json: true, yes: false, strict: false })
    expect(code).toBe(1)
    const parsed = JSON.parse(out.join(''))
    expect(parsed.ok).toBe(false)
    expect(JSON.stringify(parsed.parseErrors)).toContain('없는그룹')
  })

  it('명명 경고만 있으면 0이지만 --strict면 1이다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    out.length = 0
    // 사전이 비어 있으므로 MBR_NO는 미등록 단어 경고가 난다.
    const lenient = await validate({ cwd: dir, json: true, yes: false, strict: false })
    const warnings = JSON.parse(out.join('')).warnings as unknown[]
    expect(warnings.length).toBeGreaterThan(0)
    expect(lenient).toBe(0)
    out.length = 0
    expect(await validate({ cwd: dir, json: true, yes: false, strict: true })).toBe(1)
  })

  it('validate는 서버를 부르지 않는다', async () => {
    await pull({ cwd: dir, json: true, yes: false, strict: false, client: stubClient() })
    const client = stubClient()
    await validate({ cwd: dir, json: true, yes: false, strict: false, client })
    expect(client.query).not.toHaveBeenCalled()
  })
})
