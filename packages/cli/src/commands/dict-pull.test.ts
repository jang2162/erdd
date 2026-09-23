import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fsp from 'node:fs/promises'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyModel, exportLibraryFile, modelToFiles, type LibraryItem, type ProjectModel } from '@erdd/core'
import type { ApiClient } from '../client.js'
import { readConfig, writeConfig } from '../config.js'
import { TEST_CONFIG } from '../testing/harness.js'
import { readTree, writeTree } from '../tree.js'
import { DRAFT_FILE, UNSAVED_NOTICE } from '../local/draft.js'
import { dictPull, type DictPullCtx } from './dict-pull.js'
import type { LibraryRow } from './dict-shared.js'

// 쓰기 순서를 보려고 writeFile 을 그대로 통과시키며 기록한다(동작은 원본과 같다).
vi.mock('node:fs/promises', async (importOriginal) => {
  const m = await importOriginal<typeof import('node:fs/promises')>()
  return { ...m, writeFile: vi.fn(m.writeFile) }
})

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
  adoptDiffers: { kind: string; name: string; fields: string[] }[]
  conflicts: unknown[]
}
const LIB2: LibraryRow = { ...LIB, id: 'L2', name: '확장' }
const lastReport = (): Report => JSON.parse(out.at(-1)!).libraries[0]
const namedWord = (id: string, version: number, logicalName: string, abbreviation: string): LibraryItem =>
  ({ id, kind: 'word', version, payload: { logicalName, abbreviation, englishName: null, description: null } })
type OriginRow = { id: string; library: string; item: string; version: number }
const origins = async (): Promise<OriginRow[]> =>
  ((await readTree(dir))['erdd/origins.yaml'] as { origins: OriginRow[] } | undefined)?.origins ?? []

describe('dict pull', () => {
  it('신규 항목을 words.yaml·origins.yaml 에 쓰고 구독을 남긴다', async () => {
    await seed(createEmptyModel())
    expect(await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: '표준' }))).toBe(0)
    const tree = await readTree(dir)
    expect((tree['erdd/words.yaml'] as { words: { abbreviation: string }[] }).words).toEqual([expect.objectContaining({ abbreviation: 'CUST' })])
    expect((tree['erdd/origins.yaml'] as { origins: unknown[] }).origins).toEqual([expect.objectContaining({ library: 'L1', item: 'S1', version: 1 })])
    expect((await readConfig(dir)).dictionaries).toEqual([{ id: 'L1', name: '표준' }])
  })

  it('내용이 같은 이름 중복은 기본으로 건너뛰고 --adopt 면 출처만 붙인다', async () => {
    const m = createEmptyModel(); localWord(m, 'w1', 'CUST'); await seed(m)
    const c = client([LIB], { L1: [word('S1', 1, 'CUST')] })
    await dictPull(ctx(c, { library: 'L1' }))
    expect(await readTree(dir)).not.toHaveProperty('erdd/origins.yaml')
    expect(lastReport()).toMatchObject({ adopted: 0, nameClashSkipped: [{ kind: '단어', name: '고객' }], unlinkable: [], adoptDiffers: [] })
    await dictPull(ctx(c, { adopt: true }))
    expect(lastReport()).toMatchObject({ adopted: 1, nameClashSkipped: [], unlinkable: [], adoptDiffers: [] })
    const tree = await readTree(dir)
    expect((tree['erdd/words.yaml'] as { words: { id: string; abbreviation: string }[] }).words)
      .toEqual([expect.objectContaining({ id: 'w1', abbreviation: 'CUST' })])
    expect((tree['erdd/origins.yaml'] as { origins: { id: string }[] }).origins).toEqual([expect.objectContaining({ id: 'w1', item: 'S1' })])
  })

  /**
   * 🔥 내용이 다른 채 연결하면 다음 `dict push` 가 그 항목을 원본 갱신으로 **기본 선택**해, 사용자가 본 적
   * 없는 라이브러리 값을 로컬 값으로 덮는다. 로컬 값 유지에 명시적으로 동의한 `--conflicts ours` 만 연결한다.
   */
  it('내용이 다른 이름 중복은 --adopt 여도 연결하지 않고 다른 필드를 보고한다', async () => {
    const m = createEmptyModel(); localWord(m, 'w1', 'CSTMR'); await seed(m)
    const c = client([LIB], { L1: [word('S1', 1, 'CUST')] })
    const differs = [{ kind: '단어', name: '고객', fields: ['abbreviation'] }]
    await dictPull(ctx(c, { library: 'L1' }))
    expect(lastReport()).toMatchObject({ adopted: 0, nameClashSkipped: [], unlinkable: [], adoptDiffers: differs })
    await dictPull(ctx(c, { adopt: true }))
    expect(lastReport()).toMatchObject({ adopted: 0, nameClashSkipped: [], unlinkable: [], adoptDiffers: differs })
    expect(await readTree(dir)).not.toHaveProperty('erdd/origins.yaml')
    // theirs 는 이 갈래에서 연결하지 않는다 — 원본 값으로 바꾸려면 로컬 항목을 지우고 다시 받는다
    await dictPull(ctx(c, { adopt: true, conflicts: 'theirs' }))
    expect(lastReport()).toMatchObject({ adopted: 0, adoptDiffers: differs })
    expect(await readTree(dir)).not.toHaveProperty('erdd/origins.yaml')
  })

  it('--adopt --conflicts ours 는 내용이 달라도 로컬 값을 둔 채 연결한다', async () => {
    const m = createEmptyModel(); localWord(m, 'w1', 'CSTMR'); await seed(m)
    await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1', adopt: true, conflicts: 'ours' }))
    expect(lastReport()).toMatchObject({ adopted: 1, adoptDiffers: [] })
    expect(await readFile(join(dir, 'erdd/words.yaml'), 'utf8')).toContain('CSTMR')
    expect(await origins()).toEqual([expect.objectContaining({ id: 'w1', item: 'S1' })])
  })

  it('내용이 달라 연결하지 않는 이름 중복은 사람용 출력에 필드와 함께 보인다', async () => {
    const m = createEmptyModel(); localWord(m, 'w1', 'CSTMR'); await seed(m)
    await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1', adopt: true, json: false }))
    expect(out.join('')).toBe([
      '표준 (조직)',
      '  추가 0 · 자동 갱신 0 · 연결 0 · 유지 0',
      '  이름 중복 1 — 내용이 달라 연결하지 않음 (--adopt --conflicts ours 로 로컬 값을 유지한 채 연결)',
      '    단어 고객  (abbreviation)',
      '바뀐 파일이 없습니다',
      '',
    ].join('\n'))
  })

  it('동명 원본 둘이 한 로컬 항목을 고르면 --adopt 여도 연결은 1, 밀려난 쪽은 연결할 수 없음이다', async () => {
    const m = createEmptyModel(); localWord(m, 'w1', 'CUST'); await seed(m)
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

  it('여러 라이브러리는 config 순서로 모델을 이어받는다 — 앞 구독이 연결한 항목을 뒤 구독이 다시 잡지 않는다', async () => {
    const m = createEmptyModel(); localWord(m, 'w1', 'CUST'); await seed(m)
    await writeConfig(dir, { ...(await readConfig(dir)), dictionaries: [{ id: 'L1', name: '표준' }, { id: 'L2', name: '확장' }] })
    const c = client([LIB, LIB2], {
      L1: [namedWord('SA', 1, '고객', 'CUST'), namedWord('SA2', 1, '주문', 'ORD')],
      L2: [namedWord('SB', 1, '고객', 'CS')],
    })
    expect(await dictPull(ctx(c, { adopt: true }))).toBe(0)
    const { libraries } = JSON.parse(out.at(-1)!) as { libraries: (Report & { id: string })[] }
    expect(libraries).toEqual([
      expect.objectContaining({ id: 'L1', added: 1, adopted: 1, unlinkable: [] }),
      expect.objectContaining({ id: 'L2', added: 0, adopted: 0, unlinkable: [{ kind: '단어', name: '고객' }] }),
    ])
    // w1 은 L1 에만 연결된다. L1 이 새로 더한 주문도 남는다 — 앞 라이브러리의 결과를 버리지 않는다.
    const rows = await origins()
    expect(rows.filter((o) => o.id === 'w1')).toEqual([expect.objectContaining({ library: 'L1', item: 'SA' })])
    expect(rows.every((o) => o.library === 'L1')).toBe(true)
    expect(rows.map((o) => o.item).sort()).toEqual(['SA', 'SA2'])
    const words = ((await readTree(dir))['erdd/words.yaml'] as { words: { logicalName: string; abbreviation: string }[] }).words
    expect(words.map((w) => `${w.logicalName}:${w.abbreviation}`).sort()).toEqual(['고객:CUST', '주문:ORD'])
  })

  it('--library 는 다른 구독이 있어도 그 라이브러리만 받는다', async () => {
    await seed(createEmptyModel())
    await writeConfig(dir, { ...(await readConfig(dir)), dictionaries: [{ id: 'L1', name: '표준' }] })
    const c = client([LIB, LIB2], { L1: [word('S1', 1, 'CUST')], L2: [namedWord('S9', 1, '주문', 'ORD')] })
    expect(await dictPull(ctx(c, { library: 'L2' }))).toBe(0)
    expect((JSON.parse(out.at(-1)!) as { libraries: { id: string }[] }).libraries.map((l) => l.id)).toEqual(['L2'])
    expect((await origins()).map((o) => o.library)).toEqual(['L2'])
    expect((await readConfig(dir)).dictionaries.map((d) => d.id)).toEqual(['L1', 'L2'])
  })

  it('원본이 올라가고 로컬이 그대로면 자동 갱신 1 이다', async () => {
    await seed(createEmptyModel())
    await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1' }))
    await dictPull(ctx(client([LIB], { L1: [word('S1', 2, 'CUS')] })))
    expect(lastReport()).toMatchObject({ added: 0, autoUpdated: 1, conflicts: [] })
    expect(await readFile(join(dir, 'erdd/words.yaml'), 'utf8')).toContain('CUS\n')
    expect((await origins())[0]).toMatchObject({ item: 'S1', version: 2 })
  })

  /**
   * 🔥 출처 파일은 **마지막**에 쓴다. 먼저 쓰고 내용 파일 전에 끊기면 출처는 v2·내용은 v1 이 되어
   * 다음 pull 이 「버전이 같다」로 조용히 넘긴다. 마지막이면 끊겨도 다음 pull 이 충돌로 알린다.
   */
  it('사전 내용 파일을 먼저 쓰고 origins.yaml 을 마지막에 쓴다', async () => {
    await seed(createEmptyModel())
    await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1' }))
    const spy = vi.mocked(fsp.writeFile)
    spy.mockClear()
    await dictPull(ctx(client([LIB], { L1: [word('S1', 2, 'CUS')] })))
    const written = spy.mock.calls.map(([p]) => String(p)).filter((p) => p.includes(`${join(dir, 'erdd')}/`))
    expect(written.map((p) => p.slice(dir.length + 1))).toEqual(['erdd/words.yaml', 'erdd/origins.yaml'])
    // 보고는 여전히 정렬된 목록이다.
    expect(JSON.parse(out.at(-1)!).written).toEqual(['erdd/origins.yaml', 'erdd/words.yaml'])
  })

  it('원본에서 사라진 항목은 로컬에 남기고 그 수를 보고한다', async () => {
    await seed(createEmptyModel())
    await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1' }))
    await dictPull(ctx(client([LIB], { L1: [] }), { json: false }))
    expect(out.at(-1)).toBe([
      '표준 (조직)',
      '  추가 0 · 자동 갱신 0 · 연결 0 · 유지 0',
      '  원본에서 사라짐 1 (로컬에 남겨 둠)',
      '바뀐 파일이 없습니다',
      '',
    ].join('\n'))
    await dictPull(ctx(client([LIB], { L1: [] })))
    expect(lastReport()).toMatchObject({ detached: 1 })
    expect(await readFile(join(dir, 'erdd/words.yaml'), 'utf8')).toContain('CUST')
  })

  it('사람용 출력은 라이브러리별 집계와 이름 중복 세 갈래, 반영한 파일을 보인다', async () => {
    const m = createEmptyModel(); localWord(m, 'w1', 'CUST')
    m.words['w2'] = { id: 'w2', logicalName: '주소', abbreviation: 'ADDR', englishName: null, description: null, origin: null }
    await seed(m)
    const items = [word('S2', 1, 'CS'), word('S1', 1, 'CUST'), namedWord('S4', 1, '주소', 'ADR'),
      { id: 'S3', kind: 'word' as const, version: 1, payload: { logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null } }]
    expect(await dictPull(ctx(client([LIB], { L1: items }), { library: 'L1', json: false }))).toBe(0)
    expect(out.join('')).toBe([
      '표준 (조직)',
      '  추가 1 · 자동 갱신 0 · 연결 0 · 유지 0',
      '  이름 중복 1 — 건너뜀 (--adopt 로 연결)',
      '  이름 중복 1 — 내용이 달라 연결하지 않음 (--adopt --conflicts ours 로 로컬 값을 유지한 채 연결)',
      '    단어 주소  (abbreviation)',
      '  이름 중복 1 — 연결할 수 없음 (같은 이름 항목을 다른 원본이 차지했거나 커스텀 항목의 적용 대상이 다릅니다)',
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

  /** 로컬 약어 CSTMR, 원본 v1 CUST → v2 CUS 인 충돌을 만든다. */
  async function seedConflict(): Promise<ApiClient> {
    await seed(createEmptyModel())
    await dictPull(ctx(client([LIB], { L1: [word('S1', 1, 'CUST')] }), { library: 'L1' }))
    const words = await readFile(join(dir, 'erdd/words.yaml'), 'utf8')
    await writeFile(join(dir, 'erdd/words.yaml'), words.replace('CUST', 'CSTMR'))
    return client([LIB], { L1: [word('S1', 2, 'CUS')] })
  }

  it('--conflicts ours 는 로컬 값을 두고 출처만 올린다 — 다음 pull 에 같은 충돌이 다시 뜨지 않는다', async () => {
    const v2 = await seedConflict()
    await dictPull(ctx(v2, { conflicts: 'ours' }))
    expect(lastReport().conflicts).toEqual([expect.objectContaining({ decision: 'keep' })])
    expect(await readFile(join(dir, 'erdd/words.yaml'), 'utf8')).toContain('CSTMR')
    expect((await origins())[0]).toMatchObject({ item: 'S1', version: 2 })
    await dictPull(ctx(v2))
    expect(lastReport()).toMatchObject({ conflicts: [], kept: 1 })
  })

  it('사람용 출력의 충돌 머리줄은 결정을 말한다 — 보류·원본 반영·로컬 유지', async () => {
    const v2 = await seedConflict()
    const header = async (extra: Partial<DictPullCtx>) => {
      out = []
      await dictPull(ctx(v2, { json: false, dryRun: true, ...extra }))
      return out.join('').split('\n').filter((l) => l.includes('충돌'))
    }
    expect(await header({})).toEqual(['  충돌 1 — 보류(--conflicts theirs|ours 로 정리):'])
    expect(await header({ conflicts: 'theirs' })).toEqual(['  충돌 1 — 원본 반영:'])
    expect(await header({ conflicts: 'ours' })).toEqual(['  충돌 1 — 로컬 유지:'])
    // 필드 키는 그대로 보인다(매뉴얼이 실물을 인용한다).
    expect(out.join('')).toContain('    단어 고객  (abbreviation)')
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

  it('저장하지 않은 편집(serve 드래프트)이 있으면 push 와 같은 문구로 알린다 — 판정·종료 코드는 그대로', async () => {
    await seed(createEmptyModel())
    const c = client([LIB], { L1: [word('S1', 1, 'CUST')] })
    expect(await dictPull(ctx(c, { library: 'L1', dryRun: true }))).toBe(0)
    expect(err.join('')).not.toContain(UNSAVED_NOTICE)
    await mkdir(join(dir, DRAFT_FILE, '..'), { recursive: true })
    await writeFile(join(dir, DRAFT_FILE), '{}')
    expect(await dictPull(ctx(c, { library: 'L1', dryRun: true }))).toBe(0)
    expect(err.join('')).toContain(UNSAVED_NOTICE)
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ dryRun: true, libraries: [{ added: 1 }] })
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

const LOCAL_CONFIG = { ...TEST_CONFIG, serverUrl: null, projectId: null }
const writeLib = async (items: LibraryItem[], id = 'L1', name = '표준') => {
  await mkdir(join(dir, 'vendor'), { recursive: true })
  await writeFile(join(dir, 'vendor/std.erdd-lib.yaml'), exportLibraryFile({ id, name, description: '' }, items).text)
}
const noServer: ApiClient = {
  query: (async (path: string) => { throw new Error(`서버를 부르면 안 된다: ${path}`) }) as ApiClient['query'],
  mutate: (async (path: string) => { throw new Error(`서버를 부르면 안 된다: ${path}`) }) as ApiClient['mutate'],
}

describe('dict pull --file', () => {
  beforeEach(async () => {
    await writeConfig(dir, { ...LOCAL_CONFIG, dialects: [...LOCAL_CONFIG.dialects], dictionaries: [] })
    await seed(createEmptyModel())
  })

  it('로컬 전용 프로젝트에서 배포 파일을 받아 출처를 남기고 구독에 file 을 적는다', async () => {
    await writeLib([word('S1', 1, 'CUST')])
    expect(await dictPull(ctx(noServer, { file: 'vendor/std.erdd-lib.yaml' }))).toBe(0)
    expect(await origins()).toEqual([expect.objectContaining({ library: 'L1', item: 'S1', version: 1 })])
    expect((await readConfig(dir)).dictionaries).toEqual([{ id: 'L1', name: '표준', file: 'vendor/std.erdd-lib.yaml' }])
  })

  it('서버 구독이 이미 있는 라이브러리를 --file 로 받으면 구독 줄이 하나로 유지되고 file 이 붙는다', async () => {
    await writeConfig(dir, { ...LOCAL_CONFIG, dialects: [...LOCAL_CONFIG.dialects], dictionaries: [{ id: 'L1', name: '옛이름' }] })
    await writeLib([word('S1', 1, 'CUST')])
    expect(await dictPull(ctx(noServer, { file: 'vendor/std.erdd-lib.yaml' }))).toBe(0)
    expect((await readConfig(dir)).dictionaries).toEqual([{ id: 'L1', name: '표준', file: 'vendor/std.erdd-lib.yaml' }])
  })

  it('개정 파일을 다시 받으면 3-way 재동기화한다(자동 갱신)', async () => {
    await writeLib([word('S1', 1, 'CUST')])
    await dictPull(ctx(noServer, { file: 'vendor/std.erdd-lib.yaml' }))
    await writeLib([word('S1', 2, 'CSTMR')])
    await dictPull(ctx(noServer))
    expect(JSON.parse(out.at(-1)!).libraries[0]).toMatchObject({ autoUpdated: 1, file: 'vendor/std.erdd-lib.yaml' })
    const words = ((await readTree(dir))['erdd/words.yaml'] as { words: { abbreviation: string }[] }).words
    expect(words.map((w) => w.abbreviation)).toEqual(['CSTMR'])
  })

  it('구독 id 와 파일의 library.id 가 다르면 멈춘다', async () => {
    await writeLib([word('S1', 1, 'CUST')])
    await dictPull(ctx(noServer, { file: 'vendor/std.erdd-lib.yaml' }))
    await writeLib([word('S9', 1, 'X')], 'OTHER')
    expect(await dictPull(ctx(noServer))).toBe(1)
    expect(out.join('')).toContain('다른 라이브러리')
  })

  it('로컬 전용이면 서버 구독 줄은 건너뛰고 파일 줄은 받는다', async () => {
    await writeLib([word('S1', 1, 'CUST')])
    await writeConfig(dir, { ...LOCAL_CONFIG, dialects: [...LOCAL_CONFIG.dialects], dictionaries: [
      { id: 'SRV', name: '서버표준' }, { id: 'L1', name: '표준', file: 'vendor/std.erdd-lib.yaml' },
    ] })
    expect(await dictPull(ctx(noServer))).toBe(0)
    const reports = JSON.parse(out.at(-1)!).libraries
    expect(reports[0]).toMatchObject({ id: 'SRV', missing: true, missingReason: 'not-connected' })
    expect(reports[1]).toMatchObject({ id: 'L1', added: 1 })
  })

  it('--file 과 --library 는 함께 못 쓴다', async () => {
    expect(await dictPull(ctx(noServer, { file: 'vendor/std.erdd-lib.yaml', library: 'L1' }))).toBe(2)
  })

  it('파일 구독에서 서버 구독으로 이어가면 추가 0 · 유지 N 이다', async () => {
    const items = [word('S1', 1, 'CUST')]
    await writeLib(items)
    await dictPull(ctx(noServer, { file: 'vendor/std.erdd-lib.yaml' }))
    // 서버에 붙은 뒤 구독 줄의 file 을 지웠다
    await writeConfig(dir, { ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects], dictionaries: [{ id: 'L1', name: '표준' }] })
    await dictPull(ctx(client([{ ...LIB, id: 'L1' }], { L1: items })))
    expect(JSON.parse(out.at(-1)!).libraries[0]).toMatchObject({ added: 0, autoUpdated: 0, kept: 1 })
  })
})
