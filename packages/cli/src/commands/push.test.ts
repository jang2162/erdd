import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { modelToFiles, MAX_OPS_PER_MUTATION, type ProjectModel } from '@erdd/core'
import { fullModel } from '@erdd/core/src/testing/fixtures.js'
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
})
