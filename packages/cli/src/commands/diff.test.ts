import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProjectModel } from '@erdd/core'
import { fullModel } from '@erdd/core/src/testing/fixtures.js'
import { writeConfig } from '../config.js'
import { seedPulled, stubClient as stub, TEST_CONFIG as CONFIG } from '../testing/harness.js'
import { diff } from './diff.js'

/** cwd 아래 모든 파일 내용을 상대경로 → 텍스트로 스냅샷한다 — diff가 쓰기를 하나라도
 * 저지르면(새 파일이든 기존 파일 덮어쓰기든) before/after 비교가 어긋난다. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const rels = (await readdir(root, { recursive: true })) as string[]
  const out: Record<string, string> = {}
  for (const rel of rels) {
    try {
      out[rel] = await readFile(join(root, rel), 'utf8')
    } catch {
      // 디렉터리 항목이면 readFile이 실패한다 — 건너뛴다.
    }
  }
  return out
}

let dir: string
let out: string[]

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-diff-'))
  out = []
  vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
  vi.spyOn(process.stderr, 'write').mockReturnValue(true)
  await writeConfig(dir, { ...CONFIG, dialects: [...CONFIG.dialects] })
})
afterEach(() => vi.restoreAllMocks())

const seed = (server: ProjectModel) => seedPulled(dir, server)

describe('diff', () => {
  it('올릴 변경과 내려올 변경을 나눠 보여준다', async () => {
    const server = fullModel()
    await seed(server)                          // base = 원래 상태
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))
    const moved = fullModel()
    moved.tables['tb2']!.comment = '주문 마스터'   // 서버가 다른 곳을 고쳤다

    const { client } = stub(moved)
    expect(await diff({ cwd: dir, json: false, yes: false, strict: false, client })).toBe(0)
    const text = out.join('')
    // 섹션 경계로 잘라 각 항목이 '자기' 섹션에만 있는지 본다 — 무경계 toContain은
    // up·down이 통째로 뒤바뀌어도(diff.ts의 diffModelsForDisplay 두 호출이나 두
    // section() 호출이 swap돼도) 네 문자열이 여전히 어딘가엔 있으니 못 잡는다.
    const upIdx = text.indexOf('올릴 변경')
    const downIdx = text.indexOf('내려올 변경')
    const conflictIdx = text.indexOf('충돌', downIdx)
    expect(upIdx).toBeGreaterThanOrEqual(0)
    expect(downIdx).toBeGreaterThan(upIdx)
    expect(conflictIdx).toBeGreaterThan(downIdx)
    const upSection = text.slice(upIdx, downIdx)
    const downSection = text.slice(downIdx, conflictIdx)
    expect(upSection).toContain('올릴 변경 1건')
    expect(upSection).toContain('컬럼 MBR.MBR_NM')
    expect(upSection).not.toContain('테이블 ORD')
    expect(downSection).toContain('내려올 변경 1건')
    expect(downSection).toContain('테이블 ORD')
    expect(downSection).not.toContain('컬럼 MBR.MBR_NM')
    expect(text).toContain('충돌 없음')
  })

  it('변경이 없으면 양쪽 다 "없음"이다', async () => {
    const server = fullModel()
    await seed(server)
    const { client } = stub(server)
    expect(await diff({ cwd: dir, json: false, yes: false, strict: false, client })).toBe(0)
    expect(out.join('')).toContain('올릴 변경 없음')
    expect(out.join('')).toContain('내려올 변경 없음')
  })

  it('충돌이 있어도 기본은 0이고 --strict면 1이다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))
    const moved = fullModel()
    moved.columns['c2']!.logicalName = '회원성명'

    expect(await diff({ cwd: dir, json: false, yes: false, strict: false, client: stub(moved).client })).toBe(0)
    const text = out.join('')
    // renderConflicts(push와 공유하는 포매터)가 실제로 쓰였는지를 본다 — 이 구체적인
    // 내용(라벨·필드·기준/로컬/서버 값)은 하드코딩된 문자열이나 별도 포매터로는 안 나온다.
    expect(text).toContain('충돌 1건')
    expect(text).toContain('컬럼 MBR.MBR_NM · logicalName')
    expect(text).toContain('기준  회원명')
    expect(text).toContain('로컬  회원 이름')
    expect(text).toContain('서버  회원성명')
    out.length = 0
    expect(await diff({ cwd: dir, json: false, yes: false, strict: true, client: stub(moved).client })).toBe(1)
  })

  it('--json은 up·down·conflicts를 담는다', async () => {
    const server = fullModel()
    await seed(server)
    const path = join(dir, 'erdd/tables/MBR.yaml')
    await writeFile(path, (await readFile(path, 'utf8')).replace('logicalName: 회원명', 'logicalName: 회원 이름'))
    const { client } = stub(server)
    expect(await diff({ cwd: dir, json: true, yes: false, strict: false, client })).toBe(0)
    const payload = JSON.parse(out.join('')) as { ok: boolean; up: unknown[]; down: unknown[]; conflicts: unknown[] }
    expect(payload.ok).toBe(true)
    expect(payload.up).toHaveLength(1)
    expect(payload.down).toEqual([])
    expect(payload.conflicts).toEqual([])
  })

  it('diff는 서버를 고치지 않는다', async () => {
    const server = fullModel()
    await seed(server)
    const { client, pushCalls } = stub(server)
    await diff({ cwd: dir, json: true, yes: false, strict: false, client })
    expect(pushCalls).toHaveLength(0)
  })

  it('추가·삭제 항목은 필드 목록 없이 마커만 붙는다', async () => {
    const server = fullModel()
    await seed(server)
    // 테이블 파일을 통째로 지운다 — added/removed 엔트리는 항상 fields: []이므로
    // (model-diff.ts) diff.ts:34의 "fields가 없으면 헤드만 반환" 분기를 지나가게 한다.
    await rm(join(dir, 'erdd/tables/MBR_DTL.yaml'))
    const { client } = stub(server)
    expect(await diff({ cwd: dir, json: false, yes: false, strict: false, client })).toBe(0)
    const text = out.join('')
    // 필드 목록이 붙었다면 마커 다음에 "  <필드 라벨>: ..."가 이어져 줄이 곧장 끝나지
    // 않는다. 여기서는 마커·이름 뒤 바로 줄바꿈이어야 한다.
    expect(text).toMatch(/\n {2}- 테이블 MBR_DTL\n/)
  })

  it('diff는 로컬 파일을 하나도 건드리지 않는다', async () => {
    const server = fullModel()
    await seed(server)
    const before = await snapshot(dir)
    const { client } = stub(server)
    await diff({ cwd: dir, json: true, yes: false, strict: false, client })
    expect(await snapshot(dir)).toEqual(before)
  })
})
