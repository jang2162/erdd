import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
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
    expect(text).toContain('올릴 변경 1건')
    expect(text).toContain('컬럼 MBR.MBR_NM')
    expect(text).toContain('내려올 변경 1건')
    expect(text).toContain('테이블 ORD')
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

  it('diff는 로컬 파일을 하나도 건드리지 않는다', async () => {
    const server = fullModel()
    await seed(server)
    const before = await snapshot(dir)
    const { client } = stub(server)
    await diff({ cwd: dir, json: true, yes: false, strict: false, client })
    expect(await snapshot(dir)).toEqual(before)
  })
})
