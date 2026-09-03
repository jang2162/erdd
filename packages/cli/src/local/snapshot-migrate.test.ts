import { mkdtemp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEmptyModel } from '@erdd/core'
import { migrateSnapshots } from './snapshot-migrate.js'
import { listSnapshots, readSnapshot, type SnapshotRecord } from './snapshots.js'

const dir = () => mkdtemp(join(tmpdir(), 'erdd-migrate-'))

const ID_A = '018f6b0e-1111-7000-8000-000000000001'
const ID_B = '018f6b12-2222-7000-8000-000000000002'

const rec = (id: string, name: string): SnapshotRecord => ({
  id, name, description: '설명', revisionSeq: 42,
  model: createEmptyModel(), createdAt: '2026-09-03T05:25:30.000Z',
})

async function writeOld(cwd: string, snapshots: unknown[]): Promise<void> {
  await mkdir(join(cwd, '.erdd'), { recursive: true })
  await writeFile(join(cwd, '.erdd/snapshots.json'), JSON.stringify({ snapshots }), 'utf8')
}

const exists = async (cwd: string, rel: string): Promise<boolean> => {
  try { await readFile(join(cwd, rel), 'utf8'); return true } catch { return false }
}

describe('migrateSnapshots', () => {
  it('옛 파일이 없으면 null 이다', async () => {
    expect(await migrateSnapshots(await dir())).toBeNull()
  })

  it('정상 레코드를 새 포맷으로 옮기고 옛 파일을 .migrated 로 남긴다', async () => {
    const cwd = await dir()
    await writeOld(cwd, [rec(ID_A, '1차'), rec(ID_B, '2차')])

    const r = await migrateSnapshots(cwd)
    expect(r!.moved).toEqual([ID_A, ID_B])
    // 목록은 최신이 위다(서버 모드와 같은 순서) — B 가 A 보다 나중 id 다.
    expect((await listSnapshots(cwd)).map((s) => s.name)).toEqual(['2차', '1차'])
    expect((await readSnapshot(cwd, ID_A))!.model).toEqual(createEmptyModel())

    // ⚠️ 지우지 않는다 — gitignore 된 파일이라 남겨도 저장소가 더러워지지 않고,
    //    이행이 잘못됐을 때 되돌릴 유일한 근거다.
    expect(await exists(cwd, '.erdd/snapshots.json.migrated')).toBe(true)
    expect(await exists(cwd, '.erdd/snapshots.json')).toBe(false)
  })

  /**
   * 🔥 **손상 레코드를 옮기지 않는 것이 요점이다.** 옮기면 손상이 **커밋 대상으로 승격**되고
   * 그때부터 팀 전체가 그 파일을 본다. 남겨서 알린다.
   */
  it('손상 레코드는 옮기지 않고 이름을 돌려준다', async () => {
    const cwd = await dir()
    await writeOld(cwd, [
      rec(ID_A, '정상'),
      { id: ID_B, name: '깨진 것', description: '', revisionSeq: 0, createdAt: '', model: {} },
    ])

    const r = await migrateSnapshots(cwd)
    expect(r!.moved).toEqual([ID_A])
    expect(r!.skipped).toEqual([{ id: ID_B, name: '깨진 것' }])
    expect((await listSnapshots(cwd)).map((s) => s.id)).toEqual([ID_A])
  })

  it('두 번 돌려도 멱등이다 — 이미 있는 id 는 건너뛴다', async () => {
    const cwd = await dir()
    await writeOld(cwd, [rec(ID_A, '1차')])
    await migrateSnapshots(cwd)

    // 사용자가 .migrated 를 되돌린 경우를 흉내 낸다.
    await rename(join(cwd, '.erdd/snapshots.json.migrated'), join(cwd, '.erdd/snapshots.json'))
    const r = await migrateSnapshots(cwd)
    expect(r!.moved).toEqual([])
    expect((await listSnapshots(cwd)).length).toBe(1)
  })

  it('옛 파일이 깨져 있어도 던지지 않고 옮길 것 없음으로 끝낸다', async () => {
    const cwd = await dir()
    await mkdir(join(cwd, '.erdd'), { recursive: true })
    await writeFile(join(cwd, '.erdd/snapshots.json'), '{ 깨진', 'utf8')
    const r = await migrateSnapshots(cwd)
    expect(r).toEqual({ moved: [], skipped: [] })
    expect(await exists(cwd, '.erdd/snapshots.json.migrated')).toBe(true)
  })
})
