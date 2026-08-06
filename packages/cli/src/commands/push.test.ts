import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { applyOps, modelToFiles, MAX_OPS_PER_MUTATION, type Op, type ProjectModel } from '@erdd/core'
import { fullModel } from '@erdd/core/src/testing/fixtures.js'
import type { ApiClient } from '../client.js'
import { writeConfig } from '../config.js'
import { flagValue, shortFlagValue } from '../main.js'
import { CliError } from '../output.js'
import { seedPulled, stubClient as stub, TEST_CONFIG as CONFIG } from '../testing/harness.js'
import { readTree, writeTree } from '../tree.js'
import { push } from './push.js'

/**
 * main.ts의 switch가 하는 것과 똑같은 표현으로 argv에서 -m/--message를 뽑는다. 여기서
 * 직접 파싱 함수를 실행하는 것이 핵심이다 — ctx.message에 문자열을 바로 박아 넣으면
 * shortFlagValue의 회귀(하이픈으로 시작하는 값을 삼키는지)가 있어도 테스트가 모르고
 * 통과한다.
 */
const messageFrom = (argv: string[]) => flagValue(argv, 'message') ?? shortFlagValue(argv, 'm')

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

/** stdout에 쌓인 마지막 JSON 한 줄. push를 두 번 부르는 테스트에서 쓴다. */
const lastJson = <T>(): T => {
  const lines = out.join('').trim().split('\n')
  return JSON.parse(lines[lines.length - 1]!) as T
}

/**
 * model.push를 받아 서버 모델을 제자리에서 갱신하는 pushImpl. "반영 뒤 model.get이 새 값을
 * 돌려준다"를 재현해야 암묵적 pull(syncDown)이 실제로 하는 일을 검증할 수 있다.
 */
const applyingPush = (server: ProjectModel, seq: number) => async (input: unknown) => {
  Object.assign(server, applyOps(server, (input as { ops: Op[] }).ops))
  return { seq }
}

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

  it('-m으로 받은 요약이 하이픈으로 시작해도 그대로 model.push의 summary가 된다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    // "-fix column"처럼 하이픈으로 시작하는 요약 — shortFlagValue가 예전처럼 단일 대시까지
    // 거절하면 여기서 undefined가 나와 아래 summary 단언이 자동 요약과 어긋나 실패한다.
    const argv = ['push', '-m', '-fix column', '--json']
    const message = messageFrom(argv)
    expect(message).toBe('-fix column')

    const { client, pushCalls } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client, message })).toBe(0)
    expect(pushCalls).toHaveLength(1)
    expect((pushCalls[0] as { summary: string }).summary).toBe('-fix column')
  })

  it('--message로 받은 요약도 그대로 summary가 된다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    const argv = ['push', '--message', '커스텀 요약', '--json']
    const message = messageFrom(argv)
    expect(message).toBe('커스텀 요약')

    const { client, pushCalls } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client, message })).toBe(0)
    expect((pushCalls[0] as { summary: string }).summary).toBe('커스텀 요약')
  })

  it('-m ""(빈 요약)은 서버 스키마에 걸리기 전에 자동 요약으로 대체한다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    // 값 자리에 빈 문자열이 온다 — ??는 ''를 통과시켜 서버의 z.string().min(1)에 걸린다.
    const argv = ['push', '-m', '', '--json']
    const message = messageFrom(argv)
    expect(message).toBe('')

    const { client, pushCalls } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client, message })).toBe(0)
    expect((pushCalls[0] as { summary: string }).summary).toMatch(/^CLI push/)
  })

  it('두 파일이 같은 id를 쓰면(복사) 서버에 보내기 전에 막는다', async () => {
    // 에이전트가 "이것과 비슷한 테이블"을 만들려고 파일을 복사하면서 id를 남긴 상황.
    // 막지 않으면 새 테이블이 생기는 대신 원본(tb3)이 PAY로 개명되는 update가 나간다.
    const server = fullModel()
    await seed(server)
    const { tree } = modelToFiles(server)
    tree['erdd/tables/PAY.yaml'] = {
      ...(tree['erdd/tables/MBR_DTL.yaml'] as Record<string, unknown>), name: 'PAY', logicalName: '결제',
    }
    await writeTree(dir, tree)

    const { client, pushCalls } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(1)
    expect(pushCalls).toHaveLength(0)
    expect(out.join('')).toContain('tb3')
    expect(out.join('')).toContain('erdd/tables/PAY.yaml')
  })

  it('model.push가 CONFLICT가 아닌 이유로 실패하면 반영 여부를 모른다고 알린다', async () => {
    // 커밋 직후 응답만 유실된 경우(TCP reset·프록시 타임아웃·서버 재시작)를 구분할 방법이
    // 없다. 그냥 실패로 보고하면 다음 push가 같은 것을 새 uuid로 다시 만들어 조용히
    // 중복이 생긴다 — 사용자가 서버 상태를 먼저 확인하게 만들어야 한다.
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    const { client, pushCalls } = stub(server, {
      pushImpl: async () => { throw new CliError('NETWORK', 'socket hang up') },
    })
    const code = await push({ cwd: dir, json: true, yes: true, strict: false, client })
    expect(code).toBe(1)
    expect(pushCalls).toHaveLength(1)          // 재전송하지 않는다 — 중복이 생긴다
    const payload = lastJson<{
      ok: boolean; outcomeUnknown: boolean; committed?: boolean; pushErrorCode?: string | null
    }>()
    expect(payload.ok).toBe(false)
    expect(payload.outcomeUnknown).toBe(true)
    expect(payload.committed).toBeUndefined()  // "커밋됨"과 구분된다
    expect(payload.pushErrorCode).toBe('NETWORK')   // --json 소비자가 원인 코드로 분기할 수 있다
  })

  it('model.push가 서버 응답 오류(FORBIDDEN)로 실패하면 outcome-unknown이 아니라 평범한 오류로 전달한다', async () => {
    // UNAUTHORIZED·FORBIDDEN·NOT_FOUND·VALIDATION은 살아있는 연결로 왕복해 서버가 직접
    // 거절한 응답이다(client.ts의 CODE_MAP) — 반영 여부가 불분명한 전송 실패(NETWORK)와
    // 달리 아무것도 커밋되지 않았다는 것이 확실하다. outcome-unknown으로 뭉뚱그리면 토큰이
    // 만료된 사용자가 인증 오류 대신 "반영 여부를 확인할 수 없습니다"를 읽게 된다.
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    const { client, pushCalls } = stub(server, {
      pushImpl: async () => { throw new CliError('FORBIDDEN', '권한이 없습니다') },
    })
    const code = await push({ cwd: dir, json: true, yes: true, strict: false, client })
    expect(code).toBe(1)
    expect(pushCalls).toHaveLength(1)
    const payload = lastJson<{ error?: { code: string; message: string }; outcomeUnknown?: boolean }>()
    expect(payload.error).toMatchObject({ code: 'FORBIDDEN' })
    expect(payload.outcomeUnknown).toBeUndefined()
  })

  it('model.push가 CONFLICT가 아닌 이유로 실패하면 사람용 문구가 확인 방법을 알려 준다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    const { client } = stub(server, {
      pushImpl: async () => { throw new CliError('NETWORK', 'socket hang up') },
    })
    expect(await push({ cwd: dir, json: false, yes: true, strict: false, client })).toBe(1)
    const text = out.join('')
    expect(text).toContain('반영 여부를 확인할 수 없습니다')
    expect(text).toContain('erdd pull')
    expect(text).toContain('socket hang up')
  })

  it('삭제 목록은 컬럼을 테이블로 한정하고, 정리(pruned) 목록도 같은 규칙을 쓴다', async () => {
    // 픽스처에는 MBR_NO 컬럼이 세 테이블에 있다. `컬럼 MBR_NO`라고만 쓰면 어느 것을
    // 지우는지 알 수 없고, 이름 없는 관계(r2)는 원시 id가 그대로 찍힌다.
    // 도메인 d1도 서버에서만 지워 c2(MBR.MBR_NM)의 domainId를 매달아 놓는다 — 삭제(deletes)와
    // 정리(pruned)가 한 프롬프트에 함께 나오게 해야, pruneDangling이 만드는 라벨이 opLabel과
    // 다른 표기를 쓰는 회귀를 이 테스트가 잡을 수 있다(따로 검증하면 한쪽만 옳아도 통과한다).
    const original = fullModel()
    await seed(original)
    await rm(join(dir, 'erdd/tables/MBR_DTL.yaml'))

    const server = fullModel()
    delete server.domains['d1']

    const { client, pushCalls } = stub(server)
    const code = await push({
      cwd: dir, json: false, yes: false, strict: false, client, confirm: async () => false,
    })
    expect(code).toBe(1)
    expect(pushCalls).toHaveLength(0)
    const text = err.join('')
    expect(text).toContain('컬럼 MBR_DTL.MBR_NO')   // 삭제 목록 — 테이블로 한정된 컬럼
    expect(text).toContain('관계 MBR_DTL→MBR')       // 삭제 목록 — 이름 없는 관계
    expect(text).toContain('컬럼 MBR.MBR_NM')        // 정리(pruned) 목록도 같은 한정 규칙을 쓴다
    expect(text).not.toContain('컬럼 MBR_NO\n')       // 한정 없는 옛 표기가 삭제 목록에 남으면 안 된다
    expect(text).not.toContain('컬럼 MBR_NM (')       // 한정 없는 표기가 정리 목록에 남으면 안 된다
  })

  it('삭제 확인을 수락하면 그대로 반영한다', async () => {
    // 성공 경로 테스트가 전부 yes:true라 confirmDeletes가 곧장 반환한다 — 확인을 수락한
    // 경로는 어느 테스트도 지나가지 않아, 항상 CANCELLED를 던지는 회귀도 전부 통과한다.
    const server = fullModel()
    await seed(server)
    await rm(join(dir, 'erdd/tables/MBR_DTL.yaml'))
    const { client, pushCalls } = stub(server, { pushImpl: applyingPush(server, 2) })
    let asked: string | null = null
    const code = await push({
      cwd: dir, json: false, yes: false, strict: false, client,
      confirm: async (q) => { asked = q; return true },
    })
    expect(code).toBe(0)
    expect(asked).not.toBeNull()
    expect(pushCalls).toHaveLength(1)
    expect((pushCalls[0] as { ops: Op[] }).ops.some((o) => o.action === 'delete')).toBe(true)
    expect(out.join('')).toContain('반영했습니다')
  })

  it('삭제 op는 없고 정리(pruned)만 있어도 확인을 받는다', async () => {
    // push.ts의 pruned 전용 분기 — deletes가 비어 있고 pruned만 있는 조합이다.
    // ops가 0이면 그전에 반환하므로, 삭제가 아닌 변경 하나를 함께 만든다.
    const original = fullModel()
    await seed(original)

    const local = fullModel()
    local.columns['c2']!.logicalName = '회원 이름'     // 삭제가 아닌 update op 하나
    local.columns['cnew'] = {
      id: 'cnew', tableId: 'tb2', logicalName: '추가', physicalName: 'EXTRA', type: 'BIGINT',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 100,
      comment: null, domainId: null, custom: {},
    }
    await writeTree(dir, modelToFiles(local).tree)

    // 서버는 tb2 서브트리를 이미 통째로 지웠다 — 로컬이 tb2에 붙인 새 컬럼은 갈 곳이 없다.
    const server = fullModel()
    delete server.tables['tb2']
    delete server.columns['c3']
    delete server.columns['c4']
    delete server.relationships['r1']
    delete server.indexes['ix2']

    const { client, pushCalls } = stub(server, { pushImpl: applyingPush(server, 2) })
    let asked = false
    const code = await push({
      cwd: dir, json: false, yes: false, strict: false, client,
      confirm: async () => { asked = true; return true },
    })
    expect(code).toBe(0)
    expect(asked).toBe(true)
    expect(pushCalls).toHaveLength(1)
    expect((pushCalls[0] as { ops: Op[] }).ops.every((o) => o.action !== 'delete')).toBe(true)
    const text = err.join('')
    expect(text).toContain('참조가 끊겨 함께 정리되는 항목')
    expect(text).not.toContain('건이 서버에 반영됩니다')   // 삭제 목록은 나오지 않는다
  })

  it('암묵적 pull이 새 id를 파일에 채워 다음 push가 중복을 만들지 않는다', async () => {
    // 이 되먹임이 없으면 다음 push의 filesToModel이 같은 파일에 새 uuid를 다시 발급해
    // 서버에 이미 있는 테이블을 한 번 더 create한다.
    const server = fullModel()
    await seed(server)
    await writeFile(
      join(dir, 'erdd/tables/PAY.yaml'),
      'name: PAY\nlogicalName: 결제\ncolumns:\n  - name: PAY_NO\n    logicalName: 결제번호\n    type: BIGINT\n    pk: true\n    nullable: false\n',
    )

    const { client, pushCalls } = stub(server, { pushImpl: applyingPush(server, 2) })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
    expect(pushCalls).toHaveLength(1)

    const sent = (pushCalls[0] as { ops: Op[] }).ops
    const created = sent.find((o) => o.entity === 'table' && o.action === 'create')
    if (created === undefined) throw new Error('table create op가 sent에 없다')
    const file = await readFile(join(dir, 'erdd/tables/PAY.yaml'), 'utf8')
    expect(file).toContain(created.entityId)      // 발급된 id가 파일에 채워졌다

    // 두 번째 push — 파일의 id가 서버 엔티티를 가리키므로 아무 op도 나오지 않는다.
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
    expect(pushCalls).toHaveLength(1)
    expect(lastJson<{ ops: number }>().ops).toBe(0)
  })

  it('--json에서 확인이 필요한데 --yes가 없으면 무엇을 해야 하는지 알려 준다', async () => {
    // 비대화형에서는 ctx.confirm이 없다 — 아무도 취소하지 않았는데 "사용자가 취소했습니다"가
    // 나오면 이 CLI의 주 소비자(에이전트)가 원인을 알 수 없다.
    const server = fullModel()
    await seed(server)
    await rm(join(dir, 'erdd/tables/MBR_DTL.yaml'))
    const { client, pushCalls } = stub(server)
    const code = await push({ cwd: dir, json: true, yes: false, strict: false, client })
    expect(code).toBe(1)
    expect(pushCalls).toHaveLength(0)
    expect(out.join('')).toContain('--yes')
  })

  it('-m 뒤에 실제 플래그(--json)가 오면 값 없음으로 보고 자동 요약을 쓴다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))

    // --json이 -m의 값 자리를 차지한다 — 삼키지 않고 값 없음으로 처리돼야 한다.
    const argv = ['push', '-m', '--json']
    const message = messageFrom(argv)
    expect(message).toBeUndefined()

    const { client, pushCalls } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client, message })).toBe(0)
    expect((pushCalls[0] as { summary: string }).summary).toMatch(/^CLI push/)
  })

  /** MBR 테이블에 id 없는 컬럼을 하나 더한다 — 계획에 create가 하나 생긴다. */
  const addNewColumn = async (name = 'NEW_COL'): Promise<void> => {
    const tree = await readTree(dir)
    const mbr = tree['erdd/tables/MBR.yaml'] as { columns: Record<string, unknown>[] }
    mbr.columns.push({ name, logicalName: '새컬럼', type: 'INT' })
    await writeTree(dir, tree)
  }

  /** pushCalls[i]의 컬럼 create op가 쓴 entityId. */
  const createdColumnId = (calls: unknown[], i: number): string =>
    (calls[i] as { ops: Array<{ entity: string; action: string; entityId: string }> }).ops
      .find((o) => o.entity === 'column' && o.action === 'create')!.entityId

  it('커밋 뒤 응답이 유실돼도 다시 push하면 사본이 생기지 않는다', async () => {
    // 이 사이클의 핵심 회귀. 서버는 커밋을 마쳤는데 응답만 사라진 상황을 만든 뒤,
    // 사용자가 아무것도 모르고 그냥 다시 push하는 것을 재현한다.
    const server = fullModel()
    await seed(server)
    await addNewColumn()

    const first = stub(server, {
      pushImpl: async (input) => {
        Object.assign(server, applyOps(server, (input as { ops: Op[] }).ops))
        throw new CliError('NETWORK', 'socket hang up')
      },
    })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client: first.client })).toBe(1)
    expect(lastJson<{ outcomeUnknown: boolean }>().outcomeUnknown).toBe(true)
    expect(Object.values(server.columns).filter((c) => c.physicalName === 'NEW_COL')).toHaveLength(1)

    // 파일은 그대로, 서버는 이미 반영된 상태. 다시 실행한다.
    const second = stub(server, { seq: 2 })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client: second.client })).toBe(0)
    expect(second.pushCalls).toHaveLength(0)          // 보낼 것이 없다
    expect(lastJson<{ ops: number }>().ops).toBe(0)
    // 사본이 없다. id를 기록하지 않으면 여기가 2가 된다.
    expect(Object.values(server.columns).filter((c) => c.physicalName === 'NEW_COL')).toHaveLength(1)
  })

  it('전송이 실패해 아무것도 커밋되지 않았어도 다음 push가 같은 id를 쓴다', async () => {
    const server = fullModel()
    await seed(server)
    await addNewColumn()

    const first = stub(server, { pushImpl: async () => { throw new CliError('NETWORK', 'lost') } })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client: first.client })).toBe(1)

    const second = stub(server, { pushImpl: applyingPush(server, 2) })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client: second.client })).toBe(0)
    expect(createdColumnId(second.pushCalls, 0)).toBe(createdColumnId(first.pushCalls, 0))
  })

  it('파일명과 물리명이 달라도 원래 파일에 id를 기록한다', async () => {
    // filesToModel은 파일명과 name의 일치를 강제하지 않는다. 정규 경로(NEWTBL.yaml)에
    // 기록하면 같은 테이블이 두 파일에 남아 다음 filesToModel이 id 중복으로 막는다.
    const server = fullModel()
    await seed(server)
    await writeFile(join(dir, 'erdd/tables/새테이블.yaml'), stringifyYaml({
      name: 'NEWTBL', logicalName: '새테이블',
      columns: [{ name: 'ID', logicalName: '아이디', type: 'INT' }],
    }), 'utf8')

    // 실패시켜야 syncDown이 파일을 정규화하기 전 상태를 볼 수 있다.
    const { client } = stub(server, { pushImpl: async () => { throw new CliError('NETWORK', 'lost') } })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(1)

    const written = parseYaml(await readFile(join(dir, 'erdd/tables/새테이블.yaml'), 'utf8')) as { id?: string }
    expect(typeof written.id).toBe('string')
    await expect(readFile(join(dir, 'erdd/tables/NEWTBL.yaml'), 'utf8')).rejects.toThrow()
  })

  it('CONFLICT로 다시 계산해도 신규 id가 바뀌지 않는다', async () => {
    const server = fullModel()
    await seed(server)
    await addNewColumn()

    let attempt = 0
    const { client, pushCalls } = stub(server, {
      getImpl: () => ({ model: server, seq: attempt === 0 ? 1 : 2 }),
      pushImpl: async () => {
        if (attempt++ === 0) throw new CliError('CONFLICT', '서버가 앞서 있습니다')
        return { seq: 3 }
      },
    })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
    expect(pushCalls).toHaveLength(2)
    expect(createdColumnId(pushCalls, 1)).toBe(createdColumnId(pushCalls, 0))
  })

  it('삭제 확인에서 취소하면 파일에 아무것도 기록하지 않는다', async () => {
    const original = fullModel()
    await seed(original)
    await rm(join(dir, 'erdd/tables/MBR_DTL.yaml'))   // 삭제를 만든다
    await addNewColumn()                              // 신규 항목도 함께 만든다
    const before = await readTree(dir)

    const { client, pushCalls } = stub(fullModel())
    const code = await push({
      cwd: dir, json: false, yes: false, strict: false, client, confirm: async () => false,
    })
    expect(code).toBe(1)
    expect(pushCalls).toHaveLength(0)
    expect(await readTree(dir)).toEqual(before)
  })

  it('충돌이 있으면 파일에 아무것도 기록하지 않는다', async () => {
    const original = fullModel()
    await seed(original)
    // 같은 필드를 로컬과 서버가 서로 다르게 고친다.
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 로컬'))
    await addNewColumn()
    const before = await readTree(dir)

    const server = fullModel()
    Object.values(server.columns).find((c) => c.logicalName === '회원명')!.logicalName = '서버'

    const { client, pushCalls } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(1)
    expect(pushCalls).toHaveLength(0)
    expect(await readTree(dir)).toEqual(before)
  })

  it('보낼 변경이 없으면 파일에 아무것도 기록하지 않는다', async () => {
    const server = fullModel()
    await seed(server)
    const before = await readTree(dir)

    const { client } = stub(server)
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
    expect(await readTree(dir)).toEqual(before)
  })

  it('기록에 실패하면 model.push를 보내지 않는다', async () => {
    // id를 못 남긴 채 보내면 원래의 사본 문제가 그대로다 — 조용히 넘어가서는 안 된다.
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      throw new Error('root로 실행 중이라 chmod 444가 무의미하다 — 이 테스트는 검증력이 없다')
    }
    const server = fullModel()
    await seed(server)
    await addNewColumn()
    await chmod(join(dir, 'erdd/tables/MBR.yaml'), 0o444)

    const { client, pushCalls } = stub(server)
    await expect(push({ cwd: dir, json: true, yes: true, strict: false, client })).resolves.toBe(1)
    expect(pushCalls).toHaveLength(0)
    await chmod(join(dir, 'erdd/tables/MBR.yaml'), 0o644)
  })

  it('성공 봉투에 기록한 파일 목록이 담긴다', async () => {
    const server = fullModel()
    await seed(server)
    await addNewColumn()

    const { client } = stub(server, { pushImpl: applyingPush(server, 2) })
    expect(await push({ cwd: dir, json: true, yes: true, strict: false, client })).toBe(0)
    expect(lastJson<{ reservedFiles: string[] }>().reservedFiles).toEqual(['erdd/tables/MBR.yaml'])
  })

  it('반영 여부 불명 문구가 다시 push해도 안전하다고 알린다', async () => {
    const server = fullModel()
    await seed(server)
    await addNewColumn()

    const { client } = stub(server, { pushImpl: async () => { throw new CliError('NETWORK', 'lost') } })
    expect(await push({ cwd: dir, json: false, yes: true, strict: false, client })).toBe(1)
    const text = out.join('')
    expect(text).toContain('반영 여부를 확인할 수 없습니다')
    expect(text).toContain('중복 없이 수렴')
    expect(text).toContain('erdd pull')     // 기존 안내도 남는다
  })
})
