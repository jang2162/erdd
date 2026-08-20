import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fullModel } from '@erdd/core/src/testing/fixtures.js'
import { readConfig, requireConnection, writeConfig } from './config.js'
import { buildPlan } from './plan.js'
import { seedPulled, stubClient as stub, TEST_CONFIG as CONFIG } from './testing/harness.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-plan-'))
  // buildPlan은 CliError를 던지므로 실패 시 process.stdout/stderr를 건드리지 않는다 —
  // 다른 커맨드 테스트와 달리 write 스파이는 필요 없다.
  await writeConfig(dir, { ...CONFIG, dialects: [...CONFIG.dialects] })
})
afterEach(() => vi.restoreAllMocks())

describe('buildPlan', () => {
  // push.ts는 plan.conflicts.length > 0일 때 plan.ops를 아예 읽지 않고 먼저 반환하므로,
  // "충돌이 있으면 ops:[]다"라는 buildPlan 자체의 불변식은 push 통합 테스트로는 가려지지
  // 않는다. Task 9의 diff가 buildPlan을 그대로 쓰면 이 불변식에 직접 의존하므로 여기서
  // buildPlan 수준에서 별도로 확인한다.
  it('충돌이 있으면 ops는 항상 빈 배열이다 — merged에 남은 서버 값으로 diff하지 않는다', async () => {
    const server = fullModel()
    await seedPulled(dir, server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    let content = await readFile(path, 'utf8')
    // c2.logicalName은 서버와 충돌시키고, c1.comment는 로컬만 바꿔 충돌 없이 정상 병합되게
    // 한다. 후자가 diffModels로 새는지가 관건이다: 충돌 게이트가 없으면 merged/applied는
    // c1(비충돌 필드)의 로컬 변경을 정상 반영하므로 diffModels(server, applied)가 c1 update를
    // 만들어낸다 — 충돌 전체를 이유로 push를 막으면서 일부만 몰래 반영하는 셈이 된다.
    content = content.replace('logicalName: 회원명', 'logicalName: 회원 이름')
    content = content.replace('comment: 회원 식별자', 'comment: 회원 식별자(로컬수정)')
    await writeFile(path, content)

    const moved = fullModel()
    moved.columns['c2']!.logicalName = '회원성명'   // 서버도 같은 필드를 다르게 고쳤다 → 충돌
    // c1.comment는 서버가 건드리지 않는다 — base와 같아 로컬 변경이 충돌 없이 병합된다.

    const { client } = stub(moved)
    const connection = requireConnection(await readConfig(dir))
    const plan = await buildPlan(dir, connection, client)

    expect(plan.conflicts.length).toBeGreaterThan(0)
    // 회귀 확인: 이 단언은 충돌 게이트(`conflicts.length > 0 ? [] : ...`)가 없으면
    // c1(비충돌 필드) 변경 때문에 실패한다 — 실제로 게이트를 제거해 확인했다(자기 검토).
    expect(plan.ops).toEqual([])
  })
})
