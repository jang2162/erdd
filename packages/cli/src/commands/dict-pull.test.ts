import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyModel, modelToFiles, type LibraryItem, type ProjectModel } from '@erdd/core'
import type { ApiClient } from '../client.js'
import { readConfig, writeConfig } from '../config.js'
import { TEST_CONFIG } from '../testing/harness.js'
import { readTree, writeTree } from '../tree.js'
import { dictPull, type DictPullCtx } from './dict-pull.js'
import type { LibraryRow } from './dict-shared.js'

let dir: string
let out: string[]
let err: string[]
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-dict-pull-'))
  out = []; err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
  await writeConfig(dir, { ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects], dictionaries: [] })
})
afterEach(() => vi.restoreAllMocks())

const LIB: LibraryRow = { id: 'L1', scope: 'org', orgId: 'o1', name: '표준', description: '', itemCount: 1, canWrite: false }
const word = (id: string, version: number, abbreviation: string): LibraryItem =>
  ({ id, kind: 'word', version, payload: { logicalName: '고객', abbreviation, englishName: null, description: null } })

function client(libs: LibraryRow[], items: Record<string, LibraryItem[]>): ApiClient {
  return {
    query: (async (path: string, input: { libraryId?: string }) => {
      if (path === 'resource.library.listForProject') return libs
      if (path === 'resource.items.list') return items[input.libraryId!] ?? []
      throw new Error(`unexpected ${path}`)
    }) as ApiClient['query'],
    mutate: (async (path: string) => { throw new Error(`unexpected mutate ${path}`) }) as ApiClient['mutate'],
  }
}
const ctx = (c: ApiClient, extra: Partial<DictPullCtx> = {}): DictPullCtx =>
  ({ cwd: dir, json: true, yes: true, strict: false, client: c, adopt: false, dryRun: false, ...extra })

async function seed(model: ProjectModel): Promise<void> {
  await writeTree(dir, modelToFiles(model).tree)
}
const localWord = (m: ProjectModel, id: string, abbreviation: string) => {
  m.words[id] = { id, logicalName: '고객', abbreviation, englishName: null, description: null, origin: null }
}
type Report = {
  added: number; adopted: number
  nameClashSkipped: { kind: string; name: string }[]
  unlinkable: { kind: string; name: string }[]
  conflicts: unknown[]
}
const lastReport = (): Report => JSON.parse(out.at(-1)!).libraries[0]

describe('dict pull', () => {
  it('신규 항목을 words.yaml·origins.yaml 에 쓰고 구독을 남긴다', async () => {
    await seed(createEmptyModel())
    expect(await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: '표준' }))).toBe(0)
    const tree = await readTree(dir)
    expect((tree['erdd/words.yaml'] as { words: { abbreviation: string }[] }).words).toEqual([expect.objectContaining({ abbreviation: 'CUST' })])
    expect((tree['erdd/origins.yaml'] as { origins: unknown[] }).origins).toEqual([expect.objectContaining({ library: 'L1', item: 'S1', version: 1 })])
    expect((await readConfig(dir)).dictionaries).toEqual([{ id: 'L1', name: '표준' }])
  })

  it('이름 중복은 기본으로 건너뛰고 --adopt 면 출처만 붙인다', async () => {
    const m = createEmptyModel(); localWord(m, 'w1', 'CSTMR'); await seed(m)
    const c = client([LIB], { L1: [word('S1', 1, 'CUST')] })
    await dictPull(ctx(c, { library: 'L1' }))
    expect(await readTree(dir)).not.toHaveProperty('erdd/origins.yaml')
    expect(lastReport()).toMatchObject({ adopted: 0, nameClashSkipped: [{ kind: '단어', name: '고객' }], unlinkable: [] })
    await dictPull(ctx(c, { adopt: true }))
    expect(lastReport()).toMatchObject({ adopted: 1, nameClashSkipped: [], unlinkable: [] })
    const tree = await readTree(dir)
    expect((tree['erdd/words.yaml'] as { words: { id: string; abbreviation: string }[] }).words)
      .toEqual([expect.objectContaining({ id: 'w1', abbreviation: 'CSTMR' })])
    expect((tree['erdd/origins.yaml'] as { origins: { id: string }[] }).origins).toEqual([expect.objectContaining({ id: 'w1', item: 'S1' })])
  })

  it('동명 원본 둘이 한 로컬 항목을 고르면 --adopt 여도 연결은 1, 밀려난 쪽은 연결할 수 없음이다', async () => {
    const m = createEmptyModel(); localWord(m, 'w1', 'CSTMR'); await seed(m)
    const c = client([LIB], { L1: [word('S2', 1, 'CS'), word('S1', 1, 'CUST')] })
    await dictPull(ctx(c, { library: 'L1' }))
    expect(lastReport()).toMatchObject({ adopted: 0, nameClashSkipped: [{ name: '고객' }], unlinkable: [{ name: '고객' }] })
    await dictPull(ctx(c, { adopt: true }))
    expect(lastReport()).toMatchObject({ adopted: 1, nameClashSkipped: [], unlinkable: [{ kind: '단어', name: '고객' }] })
    const tree = await readTree(dir)
    // 선착은 sourceId 순(core planResync) — S1 이 w1 을 잡는다.
    expect((tree['erdd/origins.yaml'] as { origins: { id: string; item: string }[] }).origins)
      .toEqual([expect.objectContaining({ id: 'w1', item: 'S1' })])
    expect((tree['erdd/words.yaml'] as { words: unknown[] }).words).toHaveLength(1)
  })

  it('target 이 다른 같은 이름 커스텀 항목은 연결할 수 없음으로 보고하고 --adopt 여도 연결하지 않는다', async () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '비고', target: 'column', type: 'text', options: [], required: false,
      defaultValue: null, order: 0, origin: null,
    }
    await seed(m)
    const item: LibraryItem = {
      id: 'S1', kind: 'customField', version: 1,
      payload: { name: '비고', target: 'table', type: 'text', options: [], required: false, defaultValue: null },
    }
    const c = client([LIB], { L1: [item] })
    await dictPull(ctx(c, { library: 'L1' }))
    expect(lastReport()).toMatchObject({ adopted: 0, nameClashSkipped: [], unlinkable: [{ kind: '커스텀 항목', name: '비고' }] })
    await dictPull(ctx(c, { adopt: true }))
    expect(lastReport()).toMatchObject({ adopted: 0, nameClashSkipped: [], unlinkable: [{ kind: '커스텀 항목', name: '비고' }] })
    expect(await readTree(dir)).not.toHaveProperty('erdd/origins.yaml')
  })

  it('사람용 출력은 라이브러리별 집계와 이름 중복 두 갈래, 반영한 파일을 보인다', async () => {
    const m = createEmptyModel(); localWord(m, 'w1', 'CSTMR'); await seed(m)
    const items = [word('S2', 1, 'CS'), word('S1', 1, 'CUST'),
      { id: 'S3', kind: 'word' as const, version: 1, payload: { logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null } }]
    expect(await dictPull(ctx(client([LIB], { L1: items }), { library: 'L1', json: false }))).toBe(0)
    expect(out.join('')).toBe([
      '표준 (조직)',
      '  추가 1 · 자동 갱신 0 · 연결 0 · 유지 0',
      '  이름 중복 1 — 건너뜀 (--adopt 로 연결)',
      '  이름 중복 1 — 연결할 수 없음 (같은 이름 항목에 이미 출처가 있거나 대상이 다릅니다)',
      '반영했습니다 — erdd/origins.yaml, erdd/words.yaml',
      '',
    ].join('\n'))
  })

  it('충돌은 기본 보류(종료 0), --conflicts theirs 면 원본을 반영한다', async () => {
    await seed(createEmptyModel())
    await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1' }))
    // 로컬에서 약어를 고친다
    const words = await readFile(join(dir, 'erdd/words.yaml'), 'utf8')
    await writeFile(join(dir, 'erdd/words.yaml'), words.replace('CUST', 'CSTMR'))
    const v2 = client([LIB], { L1: [word('S1', 2, 'CUS')] })
    expect(await dictPull(ctx(v2))).toBe(0)
    expect(await readFile(join(dir, 'erdd/words.yaml'), 'utf8')).toContain('CSTMR')
    expect(lastReport().conflicts).toHaveLength(1)
    await dictPull(ctx(v2, { conflicts: 'theirs' }))
    expect(await readFile(join(dir, 'erdd/words.yaml'), 'utf8')).toContain('CUS\n')
  })

  it('--dry-run 은 파일도 config 도 쓰지 않는다', async () => {
    await seed(createEmptyModel())
    const before = await readTree(dir)
    const cfgBefore = await readFile(join(dir, 'erdd.config.yaml'), 'utf8')
    expect(await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1', dryRun: true }))).toBe(0)
    expect(await readTree(dir)).toEqual(before)
    expect(await readFile(join(dir, 'erdd.config.yaml'), 'utf8')).toBe(cfgBefore)
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ dryRun: true, libraries: [{ added: 1 }] })
  })

  it('id 없는 로컬 단어가 있어도 파일에 new: 임시 id 를 쓰지 않는다', async () => {
    await seed(createEmptyModel())
    await writeFile(join(dir, 'erdd/words.yaml'), 'words:\n  - logicalName: 주문\n    abbreviation: ORD\n')
    await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1' }))
    const raw = await readFile(join(dir, 'erdd/words.yaml'), 'utf8')
    expect(raw).not.toContain('new:')
    expect(raw).toContain('ORD')
  })

  it('사전과 무관한 테이블 파일은 바이트 그대로다', async () => {
    await seed(createEmptyModel())
    const handmade = 'name: MBR\nlogicalName: 회원\ncolumns:\n  - name: MBR_NO\n    pk: true\n    nullable: false\n    type: bigint\n'
    await mkdir(join(dir, 'erdd/tables'), { recursive: true })
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), handmade)
    expect(await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1' }))).toBe(0)
    expect(JSON.parse(out.at(-1)!).written).toEqual(['erdd/origins.yaml', 'erdd/words.yaml'])
    expect(await readFile(join(dir, 'erdd/tables/MBR.yaml'), 'utf8')).toBe(handmade)
  })

  it('사라진 구독은 경고하고 건너뛰되 구독은 지우지 않는다', async () => {
    await seed(createEmptyModel())
    await writeConfig(dir, { ...(await readConfig(dir)), dictionaries: [{ id: 'GONE', name: '옛 사전' }, { id: 'L1', name: '표준' }] })
    expect(await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] })))).toBe(0)
    expect(err.join('')).toContain('옛 사전')
    expect((await readConfig(dir)).dictionaries.map((d) => d.id)).toEqual(['GONE', 'L1'])
  })

  it('구독 표시 이름은 서버의 현재 이름을 따른다', async () => {
    await seed(createEmptyModel())
    await writeConfig(dir, { ...(await readConfig(dir)), dictionaries: [{ id: 'L1', name: '옛 이름' }] })
    await dictPull(ctx(client([LIB], { L1: [] })))
    expect((await readConfig(dir)).dictionaries).toEqual([{ id: 'L1', name: '표준' }])
  })

  it('구독도 --library 도 없으면 USAGE', async () => {
    await seed(createEmptyModel())
    expect(await dictPull(ctx(client([LIB], {})))).toBe(2)
  })

  it('로컬 전용 config 면 연결 안내와 함께 실패한다', async () => {
    await writeConfig(dir, { ...(await readConfig(dir)), serverUrl: null, projectId: null })
    expect(await dictPull(ctx(client([LIB], {}), { library: 'L1' }))).toBe(1)
    expect(out.join('')).toContain('--create')
  })
})
