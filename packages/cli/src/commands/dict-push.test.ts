import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEmptyModel, type LibraryItem, type ProjectModel } from '@erdd/core'
import type { ApiClient } from '../client.js'
import { readConfig, writeConfig } from '../config.js'
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

function client(server: ProjectModel, canWrite: boolean, opts: {
  promoteResult?: PromoteResult
  items?: LibraryItem[]
  requests?: unknown[]
} = {}) {
  const calls: { path: string; input: unknown }[] = []
  let current = server
  const c: ApiClient = {
    query: (async (path: string) => {
      if (path === 'model.get') return { model: current, seq: 1 }
      if (path === 'project.get') return { name: 'P', dialects: ['postgresql'], namingRules: TEST_CONFIG.namingRules }
      if (path === 'resource.library.listForProject') return [lib(canWrite)]
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
      if (path === 'promotion.create') return { id: 'R1', requested: 1, dropped: [] }
      throw new Error(`unexpected mutate ${path}`)
    }) as ApiClient['mutate'],
  }
  return { client: c, calls }
}
const ctx = (c: ApiClient, extra: Partial<DictPushCtx> = {}): DictPushCtx =>
  ({ cwd: dir, json: true, yes: true, strict: false, client: c, library: '표준', includeNameMatch: false, ...extra })

describe('dict push', () => {
  it('push 하지 않은 로컬 변경이 있으면 서버를 부르지 않고 거절한다', async () => {
    await seedPulled(dir, serverModel())
    const words = await readFile(join(dir, 'erdd/words.yaml'), 'utf8')
    await writeFile(join(dir, 'erdd/words.yaml'), words.replace('ORD', 'ORDR'))
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c))).toBe(1)
    expect(JSON.parse(out.join('')).error.message).toContain('erdd push')
    expect(calls).toEqual([])
  })

  it('쓰기 가능하면 resource.promote 에 expected 값을 싣고, 성공 뒤 origins.yaml 을 받는다', async () => {
    await seedPulled(dir, serverModel())
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c))).toBe(0)
    expect(calls).toEqual([{ path: 'resource.promote', input: {
      projectId: TEST_CONFIG.projectId, libraryId: 'L1',
      entries: [{ entityId: W1, expectedStatus: 'new', expectedTargetItemId: null, expectedTargetVersion: null }],
    } }])
    expect(await readTree(dir)).toHaveProperty('erdd/origins.yaml')
    // syncDown 이 config 를 다시 써도 구독은 남는다.
    expect((await readConfig(dir)).dictionaries).toEqual([{ id: 'L1', name: '표준' }])
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ mode: 'promote', inserted: 1, updated: 0 })
  })

  it('동명 원본이 둘이면 서버가 준 순서(createdAt)의 첫 항목을 expectedTargetItemId 로 싣는다', async () => {
    await seedPulled(dir, serverModel())
    // id 순이면 S1 이 먼저지만 서버(loadLibraryItems, createdAt 오름차순)는 S8 을 먼저 준다.
    const { client: c, calls } = client(serverModel(), true, { items: [custItem('S8', 'CST', 3), custItem('S1', 'CU', 5)] })
    expect(await dictPush(ctx(c, { includeNameMatch: true, names: ['고객'] }))).toBe(0)
    expect(calls).toEqual([{ path: 'resource.promote', input: {
      projectId: TEST_CONFIG.projectId, libraryId: 'L1',
      entries: [{ entityId: W2, expectedStatus: 'name-match', expectedTargetItemId: 'S8', expectedTargetVersion: 3 }],
    } }])
  })

  it('쓰기 불가면 promotion.create 에 entityIds 와 메모를 보내고 파일은 그대로다', async () => {
    await seedPulled(dir, serverModel())
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
    await seedPulled(dir, serverModel())
    const { client: c, calls } = client(serverModel(), false)
    expect(await dictPush(ctx(c, { includeNameMatch: true }))).toBe(0)
    expect((calls[0]!.input as { entityIds: string[] }).entityIds.sort()).toEqual([W1, W2].sort())
  })

  it('--kind·--name 으로 고른다', async () => {
    await seedPulled(dir, serverModel())
    const { client: c, calls } = client(serverModel(), false)
    expect(await dictPush(ctx(c, { includeNameMatch: true, kinds: ['word'], names: ['고객'] }))).toBe(0)
    expect((calls[0]!.input as { entityIds: string[] }).entityIds).toEqual([W2])
  })

  it('서버가 전부 건너뛰면 종료 코드 1 이고 파일을 받지 않는다', async () => {
    await seedPulled(dir, serverModel())
    const before = await readTree(dir)
    const { client: c } = client(serverModel(), true, {
      promoteResult: { seq: 1, inserted: 0, updated: 0, skipped: [{ entityId: W1, reason: 'plan-changed' }] },
    })
    expect(await dictPush(ctx(c))).toBe(1)
    expect(JSON.parse(out.at(-1)!)).toMatchObject({ mode: 'promote', inserted: 0, skipped: [{ entityId: W1 }] })
    expect(await readTree(dir)).toEqual(before)
  })

  it('--json 에서 --yes 가 없으면 확인이 필요하다며 멈춘다', async () => {
    await seedPulled(dir, serverModel())
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { yes: false }))).toBe(1)
    expect(out.join('')).toContain('--yes')
    expect(calls).toEqual([])
  })

  it('대화형 확인에서 거절하면 서버에 쓰지 않는다', async () => {
    await seedPulled(dir, serverModel())
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { yes: false, json: false, confirm: async () => false }))).toBe(1)
    expect(calls).toEqual([])
  })

  it('올릴 항목이 없으면 서버에 쓰지 않고 0 이다', async () => {
    await seedPulled(dir, serverModel())
    const { client: c, calls } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { kinds: ['domain'] }))).toBe(0)
    expect(calls).toEqual([])
  })

  it('--library 가 없으면 USAGE', async () => {
    await seedPulled(dir, serverModel())
    const { client: c } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { library: undefined }))).toBe(2)
  })

  it('사람용 출력은 계획 요약·항목·결과를 보인다', async () => {
    await seedPulled(dir, serverModel())
    const { client: c } = client(serverModel(), true)
    expect(await dictPush(ctx(c, { json: false }))).toBe(0)
    expect(err.join('')).toBe([
      '신규 추가 1 · 원본 갱신 0 · 동명 발견 1(제외 — --include-name-match)',
      '  + 단어 주문',
      '',
    ].join('\n'))
    expect(out.join('')).toBe('승격했습니다 — 신규 1 · 갱신 0\n')
  })
})

describe('dict requests', () => {
  it('반려 행의 처리 메모를 사람용 출력에 보인다', async () => {
    await seedPulled(dir, serverModel())
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

  it('요청이 없으면 그렇게 말한다', async () => {
    await seedPulled(dir, serverModel())
    const { client: c } = client(serverModel(), false)
    expect(await dictRequests({ cwd: dir, json: false, yes: false, strict: false, client: c, status: 'pending' })).toBe(0)
    expect(out.join('')).toBe('승격 요청이 없습니다\n')
  })
})
