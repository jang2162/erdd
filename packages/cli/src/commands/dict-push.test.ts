import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAX_OPS_PER_MUTATION, createEmptyModel, type LibraryItem, type ProjectModel } from '@erdd/core'
import type { ApiClient } from '../client.js'
import { readConfig, writeConfig, writeSync } from '../config.js'
import { TEST_CONFIG, seedPulled } from '../testing/harness.js'
import { readTree } from '../tree.js'
import { dictPush, type DictPushCtx } from './dict-push.js'
import { dictRequests } from './dict-requests.js'
import type { LibraryRow } from './dict-shared.js'

const W1 = '018f6b0e-0000-7000-8000-0000000000a1'
const W2 = '018f6b0e-0000-7000-8000-0000000000a2'
let dir: string
let out: string[]
let err: string[]
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-dict-push-'))
  out = []; err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
  await writeConfig(dir, {
    ...TEST_CONFIG, dialects: [...TEST_CONFIG.dialects],
    dictionaries: [{ id: 'L1', name: '표준' }],
  })
})
afterEach(() => vi.restoreAllMocks())

function serverModel(): ProjectModel {
  const m = createEmptyModel()
  m.words[W1] = { id: W1, logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null, origin: null }
  m.words[W2] = { id: W2, logicalName: '고객', abbreviation: 'CUST', englishName: null, description: null, origin: null }
  return m
}
const lib = (canWrite: boolean): LibraryRow =>
  ({ id: 'L1', scope: 'org', orgId: 'o1', name: '표준', description: '', itemCount: 1, canWrite })
const custItem = (id: string, abbreviation: string, version = 1): LibraryItem =>
  ({ id, kind: 'word', version, payload: { logicalName: '고객', abbreviation, englishName: null, description: null } })
// 라이브러리에 「고객」이 이미 있다 → W2 는 name-match, W1 은 new
const ITEMS: LibraryItem[] = [custItem('S2', 'CST')]

type PromoteResult = { seq: number; inserted: number; updated: number; skipped: { entityId: string; reason: string }[] }

/** pull 직후 상태 — 트리·base 에 더해 sync.json(리비전 1, 스텁 model.get 의 기본 seq 와 같다). */
async function seed(m: ProjectModel): Promise<void> {
  await seedPulled(dir, m)
  await writeSync(dir, { revisionSeq: 1, pulledAt: '2026-09-20T00:00:00.000Z' })
}

function client(server: ProjectModel, canWrite: boolean, opts: {
  promoteResult?: PromoteResult
  items?: LibraryItem[]
  requests?: unknown[]
  /** model.get 이 돌려줄 리비전. 기본 1(= seed 의 sync.json). */
  seq?: number
  /** 승격 뒤 syncDown 의 project.get 을 실패시킨다. */
  projectGetError?: Error
  scope?: LibraryRow['scope']
  created?: { id: string; requested: number; dropped: string[] }
} = {}) {
  const calls: { path: string; input: unknown }[] = []
  let current = server
  const c: ApiClient = {
    query: (async (path: string) => {
      if (path === 'model.get') return { model: current, seq: opts.seq ?? 1 }
      if (path === 'project.get') {
        if (opts.projectGetError !== undefined) throw opts.projectGetError
        return { name: 'P', dialects: ['postgresql'], namingRules: TEST_CONFIG.namingRules }
      }
      if (path === 'resource.library.listForProject') return [{ ...lib(canWrite), scope: opts.scope ?? 'org' }]
      if (path === 'resource.items.list') return opts.items ?? ITEMS
      if (path === 'promotion.listForProject') return opts.requests ?? []
      throw new Error(`unexpected ${path}`)
    }) as ApiClient['query'],
    mutate: (async (path: string, input: unknown) => {
      calls.push({ path, input })
      if (path === 'resource.promote') {
        const r = opts.promoteResult ?? { seq: 2, inserted: 1, updated: 0, skipped: [] }
        if (r.inserted + r.updated > 0) {
          current = structuredClone(server)
          current.words[W1]!.origin = {
            libraryId: 'L1', sourceId: 'S9', sourceVersion: 1,
            base: { logicalName: '주문', abbreviation: 'ORD', englishName: null, description: null },
          }
        }
        return r
      }
      if (path === 'promotion.create') return opts.created ?? { id: 'R1', requested: 1, dropped: [] }
      throw new Error(`unexpected mutate ${path}`)
    }) as ApiClient['mutate'],
  }
  return { client: c, calls }
}
const ctx = (c: ApiClient, extra: Partial<DictPushCtx> = {}): DictPushCtx =>
  ({ cwd: dir, json: true, yes: true, strict: false, client: c, library: '표준', includeNameMatch: false, ...extra })

describe('dict push', () => {
  it('push 하지 않은 로컬 변경이 있으면 서버를 부르지 않고 거절한다', async () => {
    await seed(serverModel())
    const words = await readFile(join(dir, 'erdd/words.yaml'), 'utf8')
    await writeFile(join(dir, 'erdd/words.yaml'), words.replace('ORD', 'ORDR'))
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c))).toBe(1)
    expect(JSON.parse(out.join('')).error.message).toContain('erdd push')
    expect(calls).toEqual([])
  })

  it('쓰기 가능하면 resource.promote 에 expected 값을 싣고, 성공 뒤 origins.yaml 을 받는다', async () => {
    await seed(serverModel())
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c))).toBe(0)
    expect(calls).toEqual([{ path: 'resource.promote', input: {
      projectId: TEST_CONFIG.projectId, libraryId: 'L1',
      entries: [{ entityId: W1, expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null }],
    } }])
    expect(await readTree(dir)).toHaveProperty('erdd/origins.yaml')
    // syncDown 이 config 를 다시 써도 구독은 남는다.
    expect((await readConfig(dir)).dictionaries).toEqual([{ id: 'L1', name: '표준' }])
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ mode: 'promote', ok: true, inserted: 1, updated: 0 })
  })

  it('동명 원본이 둘이면 서버가 준 순서(createdAt)의 첫 항목을 expectedTargetItemId 로 싣는다', async () => {
    await seed(serverModel())
    // id 순이면 S1 이 먼저지만 서버(loadLibraryItems, createdAt 오름차순)는 S8 을 먼저 준다.
    const { client: c, calls } = client(serverModel(), true, { items: [custItem('S8', 'CST', 3), custItem('S1', 'CU', 5)] })
    expect(await dictPush(ctx(c, { includeNameMatch: true, names: ['고객'] }))).toBe(0)
    expect(calls).toEqual([{ path: 'resource.promote', input: {
      projectId: TEST_CONFIG.projectId, libraryId: 'L1',
      entries: [{ entityId: W2, expectedStatus: 'name-match', expectedTargetItemId: 'S8', expectedTargetVersion: 3 }],
    } }])
  })

  it('쓰기 불가면 promotion.create 에 entityIds 와 메모를 보내고 파일은 그대로다', async () => {
    await seed(serverModel())
    const before = await readTree(dir)
    const { client: c, calls } = client(serverModel(), false)
    expect(await dictPush(ctx(c, { message: '주문 단어' }))).toBe(0)
    expect(calls).toEqual([{ path: 'promotion.create', input: {
      projectId: TEST_CONFIG.projectId, libraryId: 'L1', entityIds: [W1], note: '주문 단어',
    } }])
    expect(await readTree(dir)).toEqual(before)
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ mode: 'request', id: 'R1', requested: 1 })
  })

  it('동명 발견은 기본 제외, --include-name-match 면 포함한다', async () => {
    await seed(serverModel())
    const { client: c, calls } = client(serverModel(), false)
    expect(await dictPush(ctx(c, { includeNameMatch: true }))).toBe(0)
    expect((calls[0]!.input as { entityIds: string[] }).entityIds.sort()).toEqual([W1, W2].sort())
  })

  it('--kind·--name 으로 고른다', async () => {
    await seed(serverModel())
    const { client: c, calls } = client(serverModel(), false)
    expect(await dictPush(ctx(c, { includeNameMatch: true, kinds: ['word'], names: ['고객'] }))).toBe(0)
    expect((calls[0]!.input as { entityIds: string[] }).entityIds).toEqual([W2])
  })

  it('서버가 전부 건너뛰면 종료 코드 1 이고 파일을 받지 않는다', async () => {
    await seed(serverModel())
    const before = await readTree(dir)
    const { client: c } = client(serverModel(), true, {
      promoteResult: { seq: 1, inserted: 0, updated: 0, skipped: [{ entityId: W1, reason: 'plan-changed' }] },
    })
    expect(await dictPush(ctx(c))).toBe(1)
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ mode: 'promote', ok: false, inserted: 0, skipped: [{ entityId: W1 }] })
    expect(await readTree(dir)).toEqual(before)
  })

  it('--json 에서 --yes 가 없으면 확인이 필요하다며 멈춘다', async () => {
    await seed(serverModel())
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { yes: false }))).toBe(1)
    expect(out.join('')).toContain('--yes')
    expect(calls).toEqual([])
  })

  it('대화형 확인에서 거절하면 서버에 쓰지 않는다', async () => {
    await seed(serverModel())
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { yes: false, json: false, confirm: async () => false }))).toBe(1)
    expect(calls).toEqual([])
  })

  it('올릴 항목이 없으면 서버에 쓰지 않고 0 이다', async () => {
    await seed(serverModel())
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { kinds: ['domain'] }))).toBe(0)
    expect(calls).toEqual([])
  })

  it('--library 가 없으면 USAGE', async () => {
    await seed(serverModel())
    const { client: c } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { library: undefined }))).toBe(2)
  })

  it('사람용 출력은 계획 요약·항목·결과를 보인다', async () => {
    await seed(serverModel())
    const { client: c } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { json: false }))).toBe(0)
    expect(err.join('')).toBe([
      '신규 추가 1 · 원본 갱신 0 · 동명 발견 1(제외 — --include-name-match)',
      '  + 단어 주문',
      '',
    ].join('\n'))
    expect(out.join('')).toBe('승격했습니다 — 신규 1 · 갱신 0\n')
  })

  /**
   * 로컬이 깨끗해도 서버가 base 이후 앞서 나갔으면 올라가는 것은 「보던 값」이 아니라 남의 새 값이다.
   * 로컬이 깨끗하므로 erdd pull 은 무해하다 — 받은 뒤 다시 보게 한다.
   */
  it('서버가 마지막 pull 이후 앞서 나갔으면 계획을 보이기 전에 거절한다', async () => {
    await seed(serverModel())
    const { client: c, calls } = client(serverModel(), true, { seq: 5 })
    expect(await dictPush(ctx(c))).toBe(1)
    expect(JSON.parse(out.at(-1)!)).toMatchObject({
      error: { code: 'VALIDATION', message: '서버가 마지막 pull 이후 앞서 나갔습니다 — erdd pull 로 받은 뒤 다시 실행하세요' },
    })
    expect(err.join('')).toBe('')
    expect(calls).toEqual([])
  })

  it('갱신·동명 행에는 바뀐 필드를 보인다', async () => {
    const m = serverModel()
    // W1 은 L1 의 S1 에서 왔고 약어를 고쳤다 → update. W2 는 S2 와 이름만 같다 → name-match.
    m.words[W1]!.origin = {
      libraryId: 'L1', sourceId: 'S1', sourceVersion: 1,
      base: { logicalName: '주문', abbreviation: 'OR', englishName: null, description: null },
    }
    await seed(m)
    const items: LibraryItem[] = [
      { id: 'S1', kind: 'word', version: 1, payload: { logicalName: '주문', abbreviation: 'OR', englishName: null, description: null } },
      custItem('S2', 'CST'),
    ]
    const { client: c } = client(m, false, { items })
    expect(await dictPush(ctx(c, { json: false, includeNameMatch: true }))).toBe(0)
    expect(err.join('')).toBe([
      '신규 추가 0 · 원본 갱신 1 · 동명 발견 1',
      '  = 단어 고객  (abbreviation)',
      '  ~ 단어 주문  (abbreviation)',
      '',
    ].join('\n'))
  })

  /**
   * 승격은 이미 커밋됐다 — 파일 갱신 실패를 승격 실패처럼 보이면 사람도 에이전트도 재시도한다.
   * push.ts 의 committed 규약과 같다.
   */
  it('승격 뒤 파일 갱신이 실패하면 승격은 됐다고 알리고 erdd pull 을 안내한다(종료 1)', async () => {
    await seed(serverModel())
    const { client: c } = client(serverModel(), true, { projectGetError: new Error('연결이 끊겼습니다') })
    expect(await dictPush(ctx(c))).toBe(1)
    expect(JSON.parse(out.at(-1)!)).toMatchObject({
      mode: 'promote', ok: false, committed: true, syncError: '연결이 끊겼습니다', inserted: 1, updated: 0,
    })
    out = []
    expect(await dictPush(ctx(c, { json: false }))).toBe(1)
    expect(out.join('')).toContain(
      '승격했습니다 — 신규 1 · 갱신 0. 파일 갱신에 실패했습니다 — erdd pull을 실행하세요 (연결이 끊겼습니다)')
  })

  it('확인하는 사이 로컬 파일이 바뀌면 덮지 않고, 승격은 됐다고 알리며 erdd pull 을 안내한다', async () => {
    await seed(serverModel())
    const { client: c, calls } = client(serverModel(), true)
    const confirm = async () => {
      const words = await readFile(join(dir, 'erdd/words.yaml'), 'utf8')
      await writeFile(join(dir, 'erdd/words.yaml'), words.replace('ORD', 'ORDR'))
      return true
    }
    expect(await dictPush(ctx(c, { yes: false, json: false, confirm }))).toBe(1)
    expect(calls.map((x) => x.path)).toEqual(['resource.promote'])
    expect(out.join('')).toContain('승격했습니다 — 신규 1 · 갱신 0. 파일 갱신에 실패했습니다 — erdd pull을 실행하세요')
    // 사용자의 편집이 그대로다.
    expect(await readFile(join(dir, 'erdd/words.yaml'), 'utf8')).toContain('ORDR')
    expect(await readTree(dir)).not.toHaveProperty('erdd/origins.yaml')
  })

  it('쓸 수 없는 전역 라이브러리는 계획·확인 전에 거절한다', async () => {
    await seed(serverModel())
    const { client: c, calls } = client(serverModel(), false, { scope: 'global' })
    let asked = false
    expect(await dictPush(ctx(c, { yes: false, json: false, confirm: async () => { asked = true; return true } }))).toBe(1)
    expect(err.join('')).toContain('전역 라이브러리로는 승격을 요청할 수 없습니다')
    expect(err.join('')).not.toContain('신규 추가')
    expect(asked).toBe(false)
    expect(calls).toEqual([])
  })

  it('요청에서 그 사이 사라진 항목은 몇 건이 빠졌는지 말한다', async () => {
    await seed(serverModel())
    const { client: c } = client(serverModel(), false, {
      created: { id: 'R1', requested: 1, dropped: [W2] },
    })
    expect(await dictPush(ctx(c, { json: false, includeNameMatch: true }))).toBe(0)
    expect(out.join('')).toBe([
      '승격 요청을 만들었습니다 (1건). 조직 관리자가 웹에서 승인하면 반영됩니다',
      '(1건은 그 사이 사라져 빠졌습니다)',
      '',
    ].join('\n'))
  })

  it('선택이 0 이면 맞지 않은 --name 값과 제외된 동명 발견을 알린다(종료 0)', async () => {
    await seed(serverModel())
    const { client: c, calls } = client(serverModel(), true)
    // 고객은 name-match 라 기본 제외, 고갱은 오타.
    expect(await dictPush(ctx(c, { json: false, names: ['고객', '고갱'] }))).toBe(0)
    expect(calls).toEqual([])
    expect(err.join('')).toContain('--name 에 맞는 항목이 없습니다: 고갱')
    expect(err.join('')).toContain('동명 발견 1건은 제외했습니다 — 올리려면 --include-name-match')
    expect(out.join('')).toBe('올릴 항목이 없습니다\n')
  })

  it('요약의 동명 발견 수는 --kind·--name 필터를 적용한 뒤 센다', async () => {
    await seed(serverModel())
    const { client: c } = client(serverModel(), false)
    expect(await dictPush(ctx(c, { json: false, names: ['주문'] }))).toBe(0)
    expect(err.join('')).toContain('동명 발견 0(제외 — --include-name-match)')
  })

  it('op 상한을 넘는 선택은 서버를 부르지 않고 나눠 올리라고 한다', async () => {
    await seed(serverModel())
    const big = createEmptyModel()
    for (let i = 0; i <= MAX_OPS_PER_MUTATION; i += 1) {
      const id = `018f6b0e-0000-7000-8000-${String(i).padStart(12, '0')}`
      big.words[id] = { id, logicalName: `단어${i}`, abbreviation: `W${i}`, englishName: null, description: null, origin: null }
    }
    const { client: c, calls } = client(big, true, { items: [] })
    expect(await dictPush(ctx(c))).toBe(1)
    expect(JSON.parse(out.at(-1)!).error.message).toBe(
      `항목이 ${MAX_OPS_PER_MUTATION + 1}건으로 한 번에 올릴 수 있는 ${MAX_OPS_PER_MUTATION}건을 넘습니다 — --kind·--name 으로 나누세요`)
    expect(calls).toEqual([])
  })

  describe('라이브러리 원본이 마지막 dict pull 이후 앞선 항목', () => {
    const CSTMR = { logicalName: '고객', abbreviation: 'CSTMR', englishName: null, description: null }
    /** 고객 CSTMR 을 L1 의 S2 v2 로 받아 둔 동기 상태 — 로컬은 원본에서 고친 것이 없다. */
    function syncedAtV2(): ProjectModel {
      const m = serverModel()
      m.words[W2] = { ...m.words[W2]!, abbreviation: 'CSTMR', origin: { libraryId: 'L1', sourceId: 'S2', sourceVersion: 2, base: CSTMR } }
      return m
    }
    // 다른 프로젝트가 고객을 CSTM v3 으로 고쳤다.
    const AHEAD: LibraryItem[] = [custItem('S2', 'CSTM', 3)]

    /** 올리면 남이 고친 CSTM 이 이 프로젝트의 옛 값 CSTMR 로 되돌아간다. */
    it('기본 선택에서 빼고 승격 호출에 싣지 않으며, 제외 사실을 알린다', async () => {
      const m = syncedAtV2()
      await seed(m)
      const { client: c, calls } = client(m, true, { items: AHEAD })
      expect(await dictPush(ctx(c))).toBe(0)
      expect(calls).toEqual([{ path: 'resource.promote', input: {
        projectId: TEST_CONFIG.projectId, libraryId: 'L1',
        entries: [{ entityId: W1, expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null }],
      } }])
      expect(JSON.parse(out.at(-1)!)).toMatchObject({
        mode: 'promote', ok: true, behind: [{ kind: 'word', name: '고객', entityId: W2 }],
      })
    })

    it('사람용 출력은 계획 요약 뒤에 제외한 항목을 보인다', async () => {
      const m = syncedAtV2()
      await seed(m)
      const { client: c } = client(m, true, { items: AHEAD })
      expect(await dictPush(ctx(c, { json: false }))).toBe(0)
      expect(err.join('')).toBe([
        '신규 추가 1 · 원본 갱신 0 · 동명 발견 0(제외 — --include-name-match)',
        '  + 단어 주문',
        '라이브러리 원본이 마지막 dict pull 이후 바뀐 항목 1건은 제외했습니다 — erdd dict pull 로 먼저 받으세요',
        '  ~ 단어 고객  (abbreviation)',
        '',
      ].join('\n'))
    })

    it('--name 으로 콕 집어도 빼고, 선택이 0 이면 올릴 항목이 없다며 그 사실을 알린다(종료 0)', async () => {
      const m = syncedAtV2()
      await seed(m)
      const { client: c, calls } = client(m, true, { items: AHEAD })
      expect(await dictPush(ctx(c, { json: false, names: ['고객'] }))).toBe(0)
      expect(calls).toEqual([])
      expect(err.join('')).toBe([
        '라이브러리 원본이 마지막 dict pull 이후 바뀐 항목 1건은 제외했습니다 — erdd dict pull 로 먼저 받으세요',
        '  ~ 단어 고객  (abbreviation)',
        '',
      ].join('\n'))
      expect(out.join('')).toBe('올릴 항목이 없습니다\n')

      out = []
      expect(await dictPush(ctx(c, { names: ['고객'] }))).toBe(0)
      expect(JSON.parse(out.at(-1)!)).toEqual({
        libraryId: 'L1', selected: 0, behind: [{ kind: 'word', name: '고객', entityId: W2 }],
      })
    })

    /** dict pull --conflicts ours 는 내용은 그대로 두고 origin 만 v3 으로 올린다(applyResync 의 keep). */
    it('dict pull --conflicts ours 로 origin 을 v3 으로 올린 뒤에는 update 로 올라간다', async () => {
      const m = syncedAtV2()
      m.words[W2]!.origin = { libraryId: 'L1', sourceId: 'S2', sourceVersion: 3, base: { ...CSTMR, abbreviation: 'CSTM' } }
      await seed(m)
      const { client: c, calls } = client(m, true, { items: AHEAD })
      expect(await dictPush(ctx(c, { names: ['고객'] }))).toBe(0)
      expect(calls).toEqual([{ path: 'resource.promote', input: {
        projectId: TEST_CONFIG.projectId, libraryId: 'L1',
        entries: [{ entityId: W2, expectedStatus: 'update', expectedTargetItemId: 'S2', expectedTargetVersion: 3 }],
      } }])
      expect(JSON.parse(out.at(-1)!)).toMatchObject({ behind: [] })
    })
  })

  it('일부만 건너뛰면 종료 0 이고 건너뛴 항목과 사유를 보인다', async () => {
    await seed(serverModel())
    const { client: c } = client(serverModel(), true, {
      promoteResult: { seq: 2, inserted: 1, updated: 0, skipped: [{ entityId: W2, reason: 'plan-changed' }] },
    })
    expect(await dictPush(ctx(c, { json: false, includeNameMatch: true }))).toBe(0)
    expect(out.join('')).toBe([
      '승격했습니다 — 신규 1 · 갱신 0',
      '  건너뜀 단어 고객 (그 사이 계획이 바뀜)',
      '',
    ].join('\n'))
  })
})

describe('dict requests', () => {
  it('반려 행의 처리 메모를 사람용 출력에 보인다', async () => {
    await seed(serverModel())
    const { client: c } = client(serverModel(), false, { requests: [{
      id: 'R1', libraryId: 'L1', entityIds: [W1, W2], note: '주문·고객', status: 'rejected',
      createdAt: '2026-09-20T01:02:03.000Z', resolvedAt: '2026-09-21T00:00:00.000Z', resolutionNote: '중복',
      approvedEntityIds: null, requesterName: '홍길동',
    }] })
    expect(await dictRequests({ cwd: dir, json: false, yes: false, strict: false, client: c })).toBe(0)
    expect(out.join('')).toBe([
      '[반려] 2026-09-20 표준 — 2건 · 홍길동',
      '  메모: 주문·고객',
      '  처리 메모: 중복',
      '',
    ].join('\n'))
  })

  it('날짜는 로컬 날짜로 보인다', async () => {
    const tz = process.env['TZ']
    process.env['TZ'] = 'Asia/Seoul'
    try {
      await seed(serverModel())
      // UTC 로는 19일이지만 서울에서는 20일 새벽이다.
      const { client: c } = client(serverModel(), false, { requests: [{
        id: 'R1', libraryId: 'L1', entityIds: [W1], note: '', status: 'pending',
        createdAt: '2026-09-19T20:00:00.000Z', resolvedAt: null, resolutionNote: null,
        approvedEntityIds: null, requesterName: '홍길동',
      }] })
      expect(await dictRequests({ cwd: dir, json: false, yes: false, strict: false, client: c })).toBe(0)
      expect(out.join('')).toBe('[대기] 2026-09-20 표준 — 1건 · 홍길동\n')
    } finally {
      if (tz === undefined) delete process.env['TZ']
      else process.env['TZ'] = tz
    }
  })

  it('요청이 없으면 그렇게 말한다', async () => {
    await seed(serverModel())
    const { client: c } = client(serverModel(), false)
    expect(await dictRequests({ cwd: dir, json: false, yes: false, strict: false, client: c, status: 'pending' })).toBe(0)
    expect(out.join('')).toBe('승격 요청이 없습니다\n')
  })
})
