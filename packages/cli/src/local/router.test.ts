import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@erdd/server/src/router.js'
import { MAX_OPS_PER_MUTATION, type Op } from '@erdd/core'
import { FileStore } from './store.js'
import { SNAPSHOTS_FILE } from './snapshots.js'
import { createLocalRouter, type LocalContext, type LocalRouter } from './router.js'
import { LOCAL_PROJECT_ID, readConfig } from '../config.js'

async function ctx(): Promise<LocalContext> {
  const cwd = await mkdtemp(join(tmpdir(), 'erdd-router-'))
  await writeFile(join(cwd, 'erdd.config.yaml'), [
    'dialects: [postgresql]',
    'namingRules: { case: UPPER_SNAKE, separator: _, maxLengthBytes: 30 }',
    '',
  ].join('\n'), 'utf8')
  const store = new FileStore(cwd)
  await store.load()
  return { store, cwd, projectId: LOCAL_PROJECT_ID, config: await readConfig(cwd) }
}

const caller = async () => createLocalRouter().createCaller(await ctx())

/**
 * ⚠️ `entityId` 는 **UUID 여야 한다** — `model.mutate` 가 `parseOps` 를 타고, 그것이
 * `UUID_RE.test(entityId)` 로 거절한다(`packages/core/src/op-guard.ts`). `'t1'` 같은 짧은 id 는
 * 저장소 단위 테스트(Task 5)에서만 통하고 라우터를 통과하지 못한다.
 */
const T1 = '018f6b0e-0000-7000-8000-000000000001'

/** `NamingRulesStrictSchema` 는 모든 키를 요구한다 — 부분 페이로드는 통과하지 못한다. */
const LOWER_SNAKE = {
  case: 'lower_snake', separator: '_', logicalSeparator: '', maxLengthBytes: 64,
  tablePhysicalTemplate: '', tableLogicalTemplate: '',
} as const

const createTable = (entityId: string): Op => ({
  action: 'create',
  entity: 'table',
  entityId,
  data: {
    id: entityId, logicalName: '회원', physicalName: 'MBR', comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  },
})

/** 존재하지 않는 테이블을 가리키는 컬럼 — `applyOps` 의 무결성 검사에 걸린다. */
const ORPHAN_COLUMN = '018f6b0e-0000-7000-8000-0000000000c1'
const MISSING_TABLE = '018f6b0e-0000-7000-8000-0000000000cf'

const createOrphanColumn = (): Op => ({
  action: 'create',
  entity: 'column',
  entityId: ORPHAN_COLUMN,
  data: {
    id: ORPHAN_COLUMN, tableId: MISSING_TABLE, logicalName: '이름', physicalName: 'NM',
    type: 'VARCHAR(10)', isPk: false, autoIncrement: false, nullable: true,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  },
})

const MISSING_SNAPSHOT = '00000000-0000-7000-8000-0000000000aa'

/** 손상된 `.erdd/snapshots.json` 을 직접 만든다 — 라우터를 거치지 않아야 담을 수 있는 모양이다. */
async function writeSnapshotsFile(cwd: string, snapshots: unknown[]): Promise<void> {
  const abs = join(cwd, SNAPSHOTS_FILE)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, JSON.stringify({ snapshots }), 'utf8')
}

describe('로컬 라우터', () => {
  it('auth.me 가 로컬 모드를 알린다', async () => {
    expect(await (await caller()).auth.me()).toMatchObject({ mode: 'local' })
  })

  it('project.get 이 config 의 방언·명명 규칙을 낸다', async () => {
    const p = await (await caller()).project.get({ projectId: LOCAL_PROJECT_ID })
    expect(p.dialects).toEqual(['postgresql'])
    expect(p.canEdit).toBe(true)
    expect(p.canManage).toBe(true)
  })

  it('project.update 가 erdd.config.yaml 에 되쓴다', async () => {
    const c = await ctx()
    const call = createLocalRouter().createCaller(c)
    await call.project.update({ projectId: LOCAL_PROJECT_ID, namingRules: LOWER_SNAKE })
    expect((await readConfig(c.cwd)).namingRules.case).toBe('lower_snake')
  })

  /**
   * 이 경로가 쓰는 대상은 `erdd.config.yaml` 이다 — 오염되면 `readConfig` 가 거절해 프로젝트가
   * 아예 열리지 않는다. 서버와 **같은** core 스키마로 막는지 확인한다.
   */
  it('없는 방언·모자란 명명 규칙은 거절하고 config 를 건드리지 않는다', async () => {
    const c = await ctx()
    const call = createLocalRouter().createCaller(c)

    await expect(call.project.update({
      projectId: LOCAL_PROJECT_ID, dialects: ['nosuchdb'],
    } as never)).rejects.toThrow()

    // ⚠️ 키 누락을 통과시키면 그것이 곧 「기본값으로 되쓰기」가 되어 꺼 둔 구분자가 조용히 켜진다
    // (서버가 읽기용이 아니라 strict 스키마를 쓰는 이유다).
    await expect(call.project.update({
      projectId: LOCAL_PROJECT_ID,
      namingRules: { case: 'lower_snake', separator: '_', maxLengthBytes: 64 },
    } as never)).rejects.toThrow()

    const after = await readConfig(c.cwd)
    expect(after.dialects).toEqual(['postgresql'])
    expect(after.namingRules.case).toBe('UPPER_SNAKE')
  })

  /**
   * 저장 직후 같은 컨텍스트로 다시 읽는 것은 화면이 실제로 하는 일이다(저장 → 재조회).
   * 파일만 되쓰고 `ctx.config` 를 그대로 두면 서버가 살아 있는 동안 설정 화면이 옛 값을
   * 계속 보여 준다 — 사용자에게는 저장이 안 된 것으로 보인다.
   */
  it('project.update 뒤의 project.get 이 새 값을 낸다', async () => {
    const call = createLocalRouter().createCaller(await ctx())
    await call.project.update({ projectId: LOCAL_PROJECT_ID, dialects: ['mysql'] })
    expect((await call.project.get({ projectId: LOCAL_PROJECT_ID })).dialects).toEqual(['mysql'])
  })

  it('model.get → model.mutate → model.get 이 이어진다', async () => {
    const call = await caller()
    expect((await call.model.get({ projectId: LOCAL_PROJECT_ID })).seq).toBe(0)
    const { seq } = await call.model.mutate({ projectId: LOCAL_PROJECT_ID, ops: [createTable(T1)] })
    expect(seq).toBe(1)
    const after = await call.model.get({ projectId: LOCAL_PROJECT_ID })
    expect(after.model.tables[T1]!.physicalName).toBe('MBR')
  })

  it('다른 projectId 는 NOT_FOUND 로 거절한다', async () => {
    const call = await caller()
    await expect(call.model.get({ projectId: '00000000-0000-7000-8000-0000000000ff' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('스냅샷을 만들고 목록·조회·복원·삭제한다', async () => {
    const call = await caller()
    await call.model.mutate({ projectId: LOCAL_PROJECT_ID, ops: [createTable(T1)] })
    const { id } = await call.snapshot.create({ projectId: LOCAL_PROJECT_ID, name: '1차' })

    const list = await call.snapshot.list({ projectId: LOCAL_PROJECT_ID })
    expect(list.items.map((i) => i.name)).toEqual(['1차'])

    const got = await call.snapshot.get({ projectId: LOCAL_PROJECT_ID, snapshotId: id })
    expect(got.model.tables[T1]).toBeDefined()

    // 스냅샷 이후 지운 테이블이 복원으로 되살아난다.
    // ⚠️ delete op 은 `before` 가 **반드시 있어야** 한다(parseOps 가 존재 여부를 검사한다).
    const table = got.model.tables[T1]!
    await call.model.mutate({
      projectId: LOCAL_PROJECT_ID,
      ops: [{ action: 'delete', entity: 'table', entityId: T1, before: table }],
    })
    await call.snapshot.restore({ projectId: LOCAL_PROJECT_ID, snapshotId: id })
    expect((await call.model.get({ projectId: LOCAL_PROJECT_ID })).model.tables[T1]).toBeDefined()

    await call.snapshot.delete({ projectId: LOCAL_PROJECT_ID, snapshotId: id })
    expect((await call.snapshot.list({ projectId: LOCAL_PROJECT_ID })).items).toEqual([])
  })

  /**
   * 읽기-수정-쓰기가 겹치면 한쪽이 읽은 목록 위에 다른 쪽이 덮어써 스냅샷 하나가 조용히 사라진다.
   * 탭 둘이나 빠른 연속 클릭으로 충분히 만들어진다.
   */
  it('동시에 만든 스냅샷 두 개가 둘 다 남는다', async () => {
    const call = await caller()
    await Promise.all([
      call.snapshot.create({ projectId: LOCAL_PROJECT_ID, name: '가' }),
      call.snapshot.create({ projectId: LOCAL_PROJECT_ID, name: '나' }),
    ])
    const list = await call.snapshot.list({ projectId: LOCAL_PROJECT_ID })
    expect(list.items.map((i) => i.name).sort()).toEqual(['가', '나'])
  })

  it('없는 스냅샷은 조회·삭제 모두 NOT_FOUND 로 던진다', async () => {
    const call = await caller()
    await expect(call.snapshot.get({
      projectId: LOCAL_PROJECT_ID, snapshotId: MISSING_SNAPSHOT,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(call.snapshot.delete({
      projectId: LOCAL_PROJECT_ID, snapshotId: MISSING_SNAPSHOT,
    })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  /**
   * ⚠️ 오류 **코드**는 계약의 일부다 — 웹은 400(사용자 오류 표시)과 500(장애)을 다르게 다룬다.
   * 저장소의 도메인 오류가 500 이 되면 「잘못된 op」이 「서버가 죽었다」로 보인다.
   * 아래 둘은 `wrap()` 이 없으면 곧바로 빨개진다(`LocalStoreError` 가 그대로 새어 나가 500 이 된다).
   */
  it('무결성을 깨는 op 은 BAD_REQUEST 로 거절하고 모델을 바꾸지 않는다', async () => {
    const call = await caller()
    // applyOps 의 OpApplyError → LocalStoreError(Task 5) → wrap() → BAD_REQUEST 경로다.
    await expect(call.model.mutate({ projectId: LOCAL_PROJECT_ID, ops: [createOrphanColumn()] }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
    const after = await call.model.get({ projectId: LOCAL_PROJECT_ID })
    expect(after.seq).toBe(0)
    expect(after.model.columns[ORPHAN_COLUMN]).toBeUndefined()
  })

  it('op 상한을 넘는 mutate 는 BAD_REQUEST 로 거절한다', async () => {
    const call = await caller()
    // 상한 검사는 저장소가 한다(라우터 입력 스키마에는 없다) — 그 LocalStoreError 가 400 이 돼야 한다.
    const tooMany = Array.from({ length: MAX_OPS_PER_MUTATION + 1 }, () => createTable(T1))
    await expect(call.model.mutate({ projectId: LOCAL_PROJECT_ID, ops: tooMany }))
      .rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  /**
   * ③ `.erdd/snapshots.json` 은 사용자가 손으로 열 수 있는 평범한 파일이다. 반쪽짜리 `model` 을
   * 그대로 복원하면 `{ ...createEmptyModel(), ...s.model }` 정규화가 **「유효한 빈 모델」**을 만들고,
   * 그것은 무결성 검사에 걸릴 것이 없어 통과한 뒤 flush 가 사용자의 `erdd/` 를 통째로 비운다.
   * 오류도 로그도 없는 조용한 데이터 손실이라 반드시 막아야 한다.
   *
   * ⚠️ **`model` 키가 없는 것과 `{}` 인 것은 손상 모양만 한 끗 다를 뿐 결과가 같다** — 둘 다 잠근다.
   */
  const BROKEN_MODELS: [name: string, model: unknown][] = [
    ['model 키가 아예 없다', undefined],
    ['model 이 빈 객체다', {}],
    ['model 에 필수 컬렉션이 모자란다', { tables: {}, columns: {} }],
  ]

  for (const [label, model] of BROKEN_MODELS) {
    it(`손상 스냅샷을 거절하고 사용자 모델을 지킨다 — ${label}`, async () => {
      const c = await ctx()
      const call = createLocalRouter().createCaller(c)
      await call.model.mutate({ projectId: LOCAL_PROJECT_ID, ops: [createTable(T1)] })

      await writeSnapshotsFile(c.cwd, [{
        id: MISSING_SNAPSHOT, name: '깨진 것', description: '',
        revisionSeq: 0, createdAt: new Date(0).toISOString(),
        ...(model === undefined ? {} : { model }),
      }])

      await expect(call.snapshot.restore({
        projectId: LOCAL_PROJECT_ID, snapshotId: MISSING_SNAPSHOT,
      })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      await expect(call.snapshot.get({
        projectId: LOCAL_PROJECT_ID, snapshotId: MISSING_SNAPSHOT,
      })).rejects.toMatchObject({ code: 'BAD_REQUEST' })

      // 요점은 이것이다 — 사용자 모델이 그대로 남아 있어야 한다.
      expect((await call.model.get({ projectId: LOCAL_PROJECT_ID })).model.tables[T1]).toBeDefined()
    })
  }

  /**
   * ⚠️ 옛 스냅샷에는 나중에 생긴 컬렉션 키가 아예 없을 수 있다. 그 보충은 이제
   * `ProjectModelSchema` 의 `.default({})` 가 **파싱하며** 한다 — 판정만 하고 원본을 그대로
   * 넘기면 보충이 사라진다. 그래서 파싱 **결과**를 쓰는지를 여기서 잠근다.
   */
  it('신규 컬렉션 키가 없는 옛 스냅샷도 보충해서 복원한다', async () => {
    const c = await ctx()
    const call = createLocalRouter().createCaller(c)
    await call.model.mutate({ projectId: LOCAL_PROJECT_ID, ops: [createTable(T1)] })

    // words·terms·customFields 가 없는 옛 모양이다(나머지 일곱 컬렉션은 있다).
    await writeSnapshotsFile(c.cwd, [{
      id: MISSING_SNAPSHOT, name: '옛 것', description: '',
      revisionSeq: 0, createdAt: new Date(0).toISOString(),
      model: {
        tables: {}, columns: {}, relationships: {}, indexes: {}, notes: {},
        tableGroups: {}, domains: {},
      },
    }])

    await call.snapshot.restore({ projectId: LOCAL_PROJECT_ID, snapshotId: MISSING_SNAPSHOT })
    const { model } = await call.model.get({ projectId: LOCAL_PROJECT_ID })
    expect(model.tables[T1]).toBeUndefined()
    expect(model.words).toEqual({})
    expect(model.terms).toEqual({})
    expect(model.customFields).toEqual({})
  })

  /**
   * ⚠️ 손상 판정이 **정상 경로를 막지 않는다**는 증거다. 빈 프로젝트에서 만든 스냅샷은
   * 「비어 있음」이 아니라 **열 컬렉션 키가 전부 있는 온전한 모델**이므로 통과해야 한다.
   * 이것이 없으면 위 잠금은 「빈 모델을 전부 거절」로 과하게 조여도 초록으로 남는다.
   */
  it('정당하게 비어 있는 스냅샷은 그대로 복원된다', async () => {
    const call = await caller()
    const { id } = await call.snapshot.create({ projectId: LOCAL_PROJECT_ID, name: '빈 상태' })

    await call.model.mutate({ projectId: LOCAL_PROJECT_ID, ops: [createTable(T1)] })
    expect((await call.model.get({ projectId: LOCAL_PROJECT_ID })).model.tables[T1]).toBeDefined()

    await call.snapshot.restore({ projectId: LOCAL_PROJECT_ID, snapshotId: id })
    expect((await call.model.get({ projectId: LOCAL_PROJECT_ID })).model.tables[T1]).toBeUndefined()
  })
})

/**
 * 계약 잠금. 웹은 AppRouter **타입**으로 클라이언트를 만들므로, 여기서 어긋나면
 * 컴파일에 안 잡히고 런타임에 깨진다.
 */
describe('서버 라우터와의 계약', () => {
  type ServerIn = inferRouterInputs<AppRouter>
  type ServerOut = inferRouterOutputs<AppRouter>
  type LocalIn = inferRouterInputs<LocalRouter>
  type LocalOut = inferRouterOutputs<LocalRouter>

  /** 입력은 **서버가 받는 것을 로컬도 받아야** 한다 — 로컬이 좁히면 웹이 보내는 값이 거절된다. */
  it('입력 타입이 서버와 호환된다 — 10개 전부', () => {
    expectTypeOf<ServerIn['auth']['me']>().toExtend<LocalIn['auth']['me']>()
    expectTypeOf<ServerIn['model']['get']>().toExtend<LocalIn['model']['get']>()
    expectTypeOf<ServerIn['model']['mutate']>().toExtend<LocalIn['model']['mutate']>()
    expectTypeOf<ServerIn['project']['get']>().toExtend<LocalIn['project']['get']>()
    expectTypeOf<ServerIn['project']['update']>().toExtend<LocalIn['project']['update']>()
    expectTypeOf<ServerIn['snapshot']['create']>().toExtend<LocalIn['snapshot']['create']>()
    expectTypeOf<ServerIn['snapshot']['list']>().toExtend<LocalIn['snapshot']['list']>()
    expectTypeOf<ServerIn['snapshot']['get']>().toExtend<LocalIn['snapshot']['get']>()
    expectTypeOf<ServerIn['snapshot']['delete']>().toExtend<LocalIn['snapshot']['delete']>()
    expectTypeOf<ServerIn['snapshot']['restore']>().toExtend<LocalIn['snapshot']['restore']>()
  })

  /** 출력은 **로컬이 서버 모양을 채워야** 한다 — 웹이 서버 타입으로 읽는다. */
  it('출력 타입이 서버와 호환된다 — 10개 전부', () => {
    expectTypeOf<LocalOut['auth']['me']>().toExtend<ServerOut['auth']['me']>()
    expectTypeOf<LocalOut['model']['get']>().toExtend<ServerOut['model']['get']>()
    expectTypeOf<LocalOut['model']['mutate']>().toExtend<ServerOut['model']['mutate']>()
    expectTypeOf<LocalOut['project']['get']>().toExtend<ServerOut['project']['get']>()
    expectTypeOf<LocalOut['project']['update']>().toExtend<ServerOut['project']['update']>()
    expectTypeOf<LocalOut['snapshot']['create']>().toExtend<ServerOut['snapshot']['create']>()
    expectTypeOf<LocalOut['snapshot']['list']>().toExtend<ServerOut['snapshot']['list']>()
    expectTypeOf<LocalOut['snapshot']['get']>().toExtend<ServerOut['snapshot']['get']>()
    expectTypeOf<LocalOut['snapshot']['delete']>().toExtend<ServerOut['snapshot']['delete']>()
    expectTypeOf<LocalOut['snapshot']['restore']>().toExtend<ServerOut['snapshot']['restore']>()
  })

  /**
   * ⚠️ 위 두 목록은 **손으로 관리한다** — 그래서 실제로 두 번 빠뜨렸다(`project.update` 의 입력,
   * `snapshot.delete` 의 양축). 아래 세 타입은 로컬이 구현한 프로시저를 **전부 훑어** 어긋난 것의
   * 이름을 뱉는다. 목록에 없는 프로시저가 생겨도 자동으로 걸리므로 같은 누락이 되풀이되지 않는다.
   *
   * 서버에 있는데 로컬에 없는 것은 여기서 보지 않는다 — 로컬은 의도적으로 축소된 라우터다.
   */
  type InputGaps = {
    [R in keyof LocalIn & keyof ServerIn]: {
      [P in keyof LocalIn[R] & keyof ServerIn[R]]:
        ServerIn[R][P] extends LocalIn[R][P] ? never : `${R & string}.${P & string}`
    }[keyof LocalIn[R] & keyof ServerIn[R]]
  }[keyof LocalIn & keyof ServerIn]

  type OutputGaps = {
    [R in keyof LocalOut & keyof ServerOut]: {
      [P in keyof LocalOut[R] & keyof ServerOut[R]]:
        LocalOut[R][P] extends ServerOut[R][P] ? never : `${R & string}.${P & string}`
    }[keyof LocalOut[R] & keyof ServerOut[R]]
  }[keyof LocalOut & keyof ServerOut]

  /** 서버에 **없는** 로컬 전용 프로시저. 있으면 웹은 그 이름을 부를 수조차 없다. */
  type LocalOnly = {
    [R in keyof LocalIn]: R extends keyof ServerIn
      ? `${R & string}.${Exclude<keyof LocalIn[R], keyof ServerIn[R]> & string}`
      : `${R & string}.*`
  }[keyof LocalIn]

  /**
   * 어긋난 것이 있으면 `T` 가 그 **이름**이 되어 제약을 어긴다 — 오류 메시지가 어느 프로시저인지
   * 그대로 말해 준다(`expectTypeOf(...).toEqualTypeOf<never>()` 는 이름을 잃는다).
   */
  const noGaps = <_T extends never>(): void => {}

  it('빠진 축 없이 로컬의 모든 프로시저가 서버와 대조된다', () => {
    noGaps<InputGaps>()
    noGaps<OutputGaps>()
    noGaps<LocalOnly>()
  })

  it('로컬이 구현한 프로시저는 전부 서버에도 있다', () => {
    const local = createLocalRouter()
    const names = Object.keys(local._def.procedures).sort()
    expect(names).toEqual([
      'auth.me',
      'model.get', 'model.mutate',
      'project.get', 'project.update',
      'snapshot.create', 'snapshot.delete', 'snapshot.get', 'snapshot.list', 'snapshot.restore',
    ])
  })
})
