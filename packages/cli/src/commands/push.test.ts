import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modelToFiles, MAX_OPS_PER_MUTATION, type ProjectModel } from '@erdd/core'
import { fullModel } from '@erdd/core/src/testing/fixtures.js'
import type { ApiClient } from '../client.js'
import { writeConfig } from '../config.js'
import { CliError } from '../output.js'
import { seedPulled, stubClient as stub, TEST_CONFIG as CONFIG } from '../testing/harness.js'
import { writeTree } from '../tree.js'
import { push } from './push.js'

let dir: string
let out: string[]
let err: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-push-'))
  out = []; err = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
  await writeConfig(dir, { ...CONFIG, dialects: [...CONFIG.dialects] })
})
afterEach(() => vi.restoreAllMocks())

const seed = (server: ProjectModel) => seedPulled(dir, server)

describe('push', () => {
  it('로컬 변경이 없으면 서버를 고치지 않고 0으로 끝난다', async () => {
    const server = fullModel()
    await seed(server)
    const { client, pushCalls } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
    expect(pushCalls).toHaveLength(0)
    expect(JSON.parse(out.join(''))).toMatchObject({ ok: true, ops: 0 })
  })

  it('파일 수정을 op로 만들어 expectedSeq와 함께 보낸다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    const { client, pushCalls } = stub(server, { seq: 5 })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
    expect(pushCalls).toHaveLength(1)
    expect(pushCalls[0]).toMatchObject({ projectId: CONFIG.projectId, expectedSeq: 5 })
    const sent = (pushCalls[0] as { ops: Array<{ entity: string; action: string }> }).ops
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ entity: 'column', action: 'update' })
  })

  it('충돌이 있으면 model.push를 부르지 않고 1로 끝난다', async () => {
    const server = fullModel()
    await seed(server)                         // base = 원래 서버 상태
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))
    // 서버도 같은 필드를 다르게 고쳤다.
    const moved = fullModel()
    moved.columns['c2']!.logicalName = '회원성명'

    const { client, pushCalls } = stub(moved)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(1)
    expect(pushCalls).toHaveLength(0)
    const payload = JSON.parse(out.join('')) as { ok: boolean; conflicts: Array<{ field: string }> }
    expect(payload.ok).toBe(false)
    expect(payload.conflicts[0]).toMatchObject({ field: 'logicalName' })
  })

  it('삭제가 있으면 확인을 받고, 거절하면 CANCELLED로 끝난다', async () => {
    const server = fullModel()
    await seed(server)
    await rm(join(dir, 'erdd/tables/MBR_DTL.yaml'))
    const { client, pushCalls } = stub(server)
    const code = await push({
      cwd: dir, json: false, yes: false, strict: false, client,
      confirm: async () => false,
    })
    expect(code).toBe(1)
    expect(pushCalls).toHaveLength(0)
    expect(err.join('')).toContain('삭제')
  })

  it('성공하면 트리와 base를 서버 상태로 다시 쓴다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    // stubClient의 model.get은 매번 같은 server 참조를 돌려준다 — buildPlan(반영 전)과
    // syncDown(반영 후)이 같은 model.get을 공유하므로, "반영 뒤 서버 상태"를 미리 채운
    // 별도 모델을 넘기면 buildPlan조차 이미 수렴한 것으로 보여 ops가 0이 되어 mutate가
    // 아예 호출되지 않는다(반영 전/후를 구분 못 함). pushImpl이 그 참조를 직접 갱신해야
    // "반영 성공 → 이후 model.get이 새 값을 돌려줌"이 재현된다.
    const { client } = stub(server, {
      pushImpl: async () => {
        server.columns['c2']!.logicalName = '회원 이름'
        return { seq: 2 }
      },
    })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)

    const base = JSON.parse(await readFile(join(dir, '.erdd/base.json'), 'utf8')) as Record<string, unknown>
    expect(JSON.stringify(base)).toContain('회원 이름')
  })

  it('반영 성공 후 파일 갱신(syncDown)이 실패하면 커밋됐음을 알리고 재전송하지 않는다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    const { client: base, pushCalls } = stub(server, { seq: 5 })
    let queryCalls = 0
    // buildPlan의 model.get(1번째 호출)은 통과시키고, 반영 성공 뒤 syncDown이 부르는
    // project.get(2번째 호출)부터 실패시켜 "커밋은 됐는데 파일 갱신이 죽었다"를 재현한다.
    const client: ApiClient = {
      mutate: base.mutate,
      query: (async (p: string, input: unknown) => {
        queryCalls += 1
        if (queryCalls > 1) throw new Error('디스크 쓰기 실패')
        return base.query(p, input)
      }) as ApiClient['query'],
    }

    const code = await push({ cwd: dir, json: true, yes: true, strict: false, client })
    expect(code).toBe(1)
    expect(pushCalls).toHaveLength(1)   // model.push는 정확히 한 번만 — 커밋 후 재전송하지 않는다
    const payload = JSON.parse(out.join('')) as {
      ok: boolean; committed: boolean; revisionSeq: number
    }
    expect(payload.ok).toBe(false)
    expect(payload.committed).toBe(true)
    expect(payload.revisionSeq).toBe(6)   // stub(server,{seq:5})의 기본 응답 = seq+1
  })

  it('반영 후 syncDown에서 CONFLICT가 나도 model.push를 다시 부르지 않는다', async () => {
    // model.push(mutate)와 syncDown(query)을 같은 try로 묶으면, syncDown의 query 실패가
    // CONFLICT 코드를 달고 있을 때 "재시도할 실패"로 오분류돼 이미 커밋된 반영을 향해
    // model.push를 한 번 더 보낸다. syncDown 이후는 재시도 대상이 아니어야 한다.
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    const { client: base, pushCalls } = stub(server, { seq: 5 })
    let queryCalls = 0
    // syncDown의 첫 쿼리(project.get, 2번째 호출)만 CONFLICT로 한 번 실패시키고 그 뒤는
    // 정상으로 되돌린다 — "재시도 루프를 한 번 더 돌면 실제로 두 번째 model.push가
    // 나가는지"까지 드러내려면 재시도가 실제로 진행될 수 있어야 한다(영원히 막아 buildPlan
    // 자체가 죽게 하면 애초에 두 번째 mutate에 도달하지 못해 이 버그를 놓친다).
    const client: ApiClient = {
      mutate: base.mutate,
      query: (async (p: string, input: unknown) => {
        queryCalls += 1
        if (queryCalls === 2) throw new CliError('CONFLICT', '동시 수정이 감지됐습니다')
        return base.query(p, input)
      }) as ApiClient['query'],
    }

    const code = await push({ cwd: dir, json: true, yes: true, strict: false, client })
    expect(code).toBe(1)
    expect(pushCalls).toHaveLength(1)   // 커밋은 이미 끝났다 — CONFLICT 재시도 대상이 아니다
    const payload = JSON.parse(out.join('')) as { committed: boolean }
    expect(payload.committed).toBe(true)
  })

  it('CONFLICT를 한 번 만나면 다시 계산해 재시도한다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    let calls = 0
    const { client, pushCalls } = stub(server, {
      pushImpl: async () => {
        calls += 1
        if (calls === 1) throw new CliError('CONFLICT', '서버가 앞서 있습니다')
        return { seq: 2 }
      },
    })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
    expect(pushCalls).toHaveLength(2)
    expect(JSON.parse(out.join(''))).toMatchObject({ retried: true })
  })

  it('CONFLICT 재시도는 계획을 다시 계산한다 — 두 번째 model.push는 새 expectedSeq를 보낸다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    // seq를 스텁 밖에서 들고 있다가 첫 mutate가 실패하며 앞으로 민다 — buildPlan을 루프
    // 밖으로 끌어올리는 "최적화"를 하면 두 번째 model.push도 첫 번째와 같은 expectedSeq를
    // 보내게 되어 이 단언이 깨진다(직접 되돌려서 확인함 — 자기 검토 기록 참고).
    let serverSeq = 1
    const { client, pushCalls } = stub(server, {
      getImpl: () => ({ model: server, seq: serverSeq }),
      pushImpl: async () => {
        if (serverSeq === 1) {
          serverSeq = 2   // 계산과 반영 사이에 남이 앞서 커밋한 것을 흉내낸다
          throw new CliError('CONFLICT', '서버가 앞서 있습니다')
        }
        return { seq: serverSeq + 1 }
      },
    })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
    expect(pushCalls).toHaveLength(2)
    const first = pushCalls[0] as { expectedSeq: number }
    const second = pushCalls[1] as { expectedSeq: number }
    expect(second.expectedSeq).toBeGreaterThan(first.expectedSeq)
  })

  it('두 번 연속 CONFLICT면 실패한다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    const { client, pushCalls } = stub(server, {
      pushImpl: async () => { throw new CliError('CONFLICT', '서버가 앞서 있습니다') },
    })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(1)
    expect(pushCalls).toHaveLength(2)
    expect(JSON.parse(out.join(''))).toMatchObject({ error: { code: 'CONFLICT' } })
  })

  it('erdd/를 통째로 지운 상태는 전체 삭제로 해석하지 않는다', async () => {
    const server = fullModel()
    await seed(server)
    await rm(join(dir, 'erdd'), { recursive: true })
    const { client, pushCalls } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(1)
    expect(pushCalls).toHaveLength(0)
    expect(out.join('')).toContain('erdd/ 아래에 파일이 없습니다')
  })

  it('base가 없으면 pull을 안내한다', async () => {
    const server = fullModel()
    const { tree } = modelToFiles(server)
    await writeTree(dir, tree)               // base 없이 트리만
    const { client, pushCalls } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(1)
    expect(pushCalls).toHaveLength(0)
    expect(out.join('')).toContain('erdd pull')
  })

  it('op 상한을 넘으면 서버에 보내기 전에 막는다', async () => {
    const server = fullModel()
    await seed(server)
    // 컬럼을 상한 이상 늘린다 — 테이블을 늘리면 파일이 그만큼 생겨 테스트가 느려진다.
    const big = fullModel()
    for (let i = 0; i < MAX_OPS_PER_MUTATION + 10; i += 1) {
      const id = `cx${String(i).padStart(6, '0')}`
      big.columns[id] = {
        id, tableId: 'tb1', logicalName: `추가${i}`, physicalName: `EXTRA_${i}`, type: 'BIGINT',
        isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 100 + i,
        comment: null, domainId: null, custom: {},
      }
    }
    // base는 갱신하지 않는다 — base(원래 3테이블)와 로컬(컬럼 5010개 추가)의 차이가 상한을 넘는다.
    await writeTree(dir, modelToFiles(big).tree)
    const { client, pushCalls } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(1)
    expect(pushCalls).toHaveLength(0)
    expect(out.join('')).toContain(String(MAX_OPS_PER_MUTATION))
  })

  it('op 상한 초과 시 삭제 확인보다 먼저 막아 사용자에게 묻지 않는다', async () => {
    const server = fullModel()
    await seed(server)
    // 컬럼을 상한 이상 늘리면서 동시에 테이블 하나(MBR_DTL)를 통째로 지운다 —
    // 삭제 확인과 op 상한이 같은 계획 안에서 함께 걸리는 상황을 만든다.
    const big = fullModel()
    delete big.tables['tb3']         // MBR_DTL 삭제 — c5·c6·r2도 파일에서 함께 빠진다
    for (let i = 0; i < MAX_OPS_PER_MUTATION + 10; i += 1) {
      const id = `cx${String(i).padStart(6, '0')}`
      big.columns[id] = {
        id, tableId: 'tb1', logicalName: `추가${i}`, physicalName: `EXTRA_${i}`, type: 'BIGINT',
        isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 100 + i,
        comment: null, domainId: null, custom: {},
      }
    }
    await writeTree(dir, modelToFiles(big).tree)
    const { client, pushCalls } = stub(server)
    let confirmCalled = false
    const code = await push({
      cwd: dir, json: true, yes: false, strict: false, client,
      confirm: async () => { confirmCalled = true; return true },
    })
    expect(code).toBe(1)
    expect(pushCalls).toHaveLength(0)
    expect(confirmCalled).toBe(false)   // 삭제 확인 프롬프트까지 가지 않고 상한에서 먼저 막힌다
    expect(out.join('')).toContain(String(MAX_OPS_PER_MUTATION))
  })

  it('op가 0건이어도 정리된(pruned) 항목이 있으면 결과에 알린다', async () => {
    // 서버가 tb2(ORD) 서브트리를 이미 통째로 지운 상태(캐스케이드: 컬럼·관계·인덱스 포함)를
    // 흉내낸다. base/local은 그 사실을 모른 채 tb2에 새 컬럼을 추가한다 — merge는 tb2를
    // "서버가 지웠다"로 조용히 받아들이고(테이블 자체 필드는 로컬도 안 건드렸으므로 충돌 아님),
    // 그 위에 로컬이 새로 추가한 컬럼은 소속 테이블이 사라져 pruneDangling이 지운다.
    // diffModels는 서버(이미 tb2가 없음) 대비로 비교하므로 tb2/그 컬럼들은 애초에 서버에
    // "없던" 것과 같아 op가 하나도 안 생긴다 — 그런데도 사용자가 로컬에서 한 작업(새 컬럼)은
    // 사라졌으니 pruned로 알려야 한다.
    const original = fullModel()
    await seed(original)

    const local = fullModel()
    local.columns['cnew'] = {
      id: 'cnew', tableId: 'tb2', logicalName: '추가', physicalName: 'EXTRA', type: 'BIGINT',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 100,
      comment: null, domainId: null, custom: {},
    }
    await writeTree(dir, modelToFiles(local).tree)

    const server = fullModel()
    delete server.tables['tb2']
    delete server.columns['c3']
    delete server.columns['c4']
    delete server.relationships['r1']
    delete server.indexes['ix2']

    const { client, pushCalls } = stub(server)
    const code = await push({ cwd: dir, json: true, yes: true, strict: false, client })
    expect(code).toBe(0)
    expect(pushCalls).toHaveLength(0)
    const payload = JSON.parse(out.join('')) as { ops: number; pruned: unknown[] }
    expect(payload.ops).toBe(0)
    expect(payload.pruned.length).toBeGreaterThan(0)
  })
})
