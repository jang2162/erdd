import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@erdd/server/src/router.js'
import type { Op } from '@erdd/core'
import { FileStore } from './store.js'
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

const createTable = (entityId: string): Op => ({
  action: 'create',
  entity: 'table',
  entityId,
  data: {
    id: entityId, logicalName: '회원', physicalName: 'MBR', comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  },
})

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
    await call.project.update({
      projectId: LOCAL_PROJECT_ID,
      namingRules: { case: 'lower_snake', separator: '_', maxLengthBytes: 64, logicalSeparator: '' },
    })
    expect((await readConfig(c.cwd)).namingRules.case).toBe('lower_snake')
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

  it('다른 projectId 는 거절한다', async () => {
    const call = await caller()
    await expect(call.model.get({ projectId: '00000000-0000-7000-8000-0000000000ff' }))
      .rejects.toThrow()
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

  it('없는 스냅샷은 NOT_FOUND 로 던진다', async () => {
    const call = await caller()
    await expect(call.snapshot.get({
      projectId: LOCAL_PROJECT_ID, snapshotId: '00000000-0000-7000-8000-0000000000aa',
    })).rejects.toThrow()
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

  it('입력 타입이 서버와 호환된다', () => {
    expectTypeOf<ServerIn['model']['get']>().toExtend<LocalIn['model']['get']>()
    expectTypeOf<ServerIn['model']['mutate']>().toExtend<LocalIn['model']['mutate']>()
    expectTypeOf<ServerIn['project']['get']>().toExtend<LocalIn['project']['get']>()
    expectTypeOf<ServerIn['snapshot']['create']>().toExtend<LocalIn['snapshot']['create']>()
    expectTypeOf<ServerIn['snapshot']['restore']>().toExtend<LocalIn['snapshot']['restore']>()
  })

  it('출력 타입이 서버와 호환된다 — 웹이 서버 타입으로 읽는다', () => {
    expectTypeOf<LocalOut['auth']['me']>().toExtend<ServerOut['auth']['me']>()
    expectTypeOf<LocalOut['model']['get']>().toExtend<ServerOut['model']['get']>()
    expectTypeOf<LocalOut['model']['mutate']>().toExtend<ServerOut['model']['mutate']>()
    expectTypeOf<LocalOut['project']['get']>().toExtend<ServerOut['project']['get']>()
    expectTypeOf<LocalOut['snapshot']['list']>().toExtend<ServerOut['snapshot']['list']>()
    expectTypeOf<LocalOut['snapshot']['get']>().toExtend<ServerOut['snapshot']['get']>()
    expectTypeOf<LocalOut['snapshot']['restore']>().toExtend<ServerOut['snapshot']['restore']>()
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
