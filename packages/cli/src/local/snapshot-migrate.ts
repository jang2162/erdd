import { readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { ProjectModelSchema } from '@erdd/core'
import { STATE_DIR } from '../config.js'
import { readSnapshot, writeSnapshot, type SnapshotRecord } from './snapshots.js'

/** 옛 포맷 — gitignore 되는 `.erdd/` 안의 평문 JSON 단일 파일. */
const OLD_FILE = `${STATE_DIR}/snapshots.json`

export type MigrationResult = {
  moved: string[]
  skipped: { id: string; name: string }[]
}

/**
 * 옛 `.erdd/snapshots.json` 을 `erdd/snapshots/`(커밋 대상)로 **한 번** 옮긴다.
 * 옛 파일이 없으면 `null` — 이행할 것이 없다는 뜻이다.
 *
 * **「둘 다 읽는 기간」을 두지 않는 이유:** 옛 파일은 gitignore 된 머신 로컬 파일이라 그 기간이
 * 사 줄 것이 없고, `list` 합치기·id 충돌·삭제 대상 판정이라는 부채만 남는다.
 *
 * ⚠️ **손상 레코드는 옮기지 않는다.** 옮기면 손상이 **커밋 대상으로 승격**되고 그때부터 팀 전체가
 * 그 파일을 본다. 남겨서 이름을 돌려주고 호출자가 알린다.
 *
 * ⚠️ **옛 파일을 지우지 않고 `.migrated` 로 이름만 바꾼다** — 이행이 잘못됐을 때 되돌릴 유일한
 * 근거다. gitignore 된 파일이라 남겨도 저장소가 더러워지지 않는다.
 *
 * **멱등하다** — 이미 새 포맷에 있는 id 는 건너뛴다.
 */
export async function migrateSnapshots(cwd: string): Promise<MigrationResult | null> {
  let raw: string
  try {
    raw = await readFile(join(cwd, OLD_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }

  let items: unknown
  try {
    const parsed: unknown = JSON.parse(raw)
    items = typeof parsed === 'object' && parsed !== null
      ? (parsed as { snapshots?: unknown }).snapshots
      : undefined
  } catch {
    items = undefined
  }
  const records: SnapshotRecord[] = Array.isArray(items) ? (items as SnapshotRecord[]) : []

  const moved: string[] = []
  const skipped: { id: string; name: string }[] = []
  for (const rec of records) {
    const id: unknown = rec?.id
    if (typeof id !== 'string' || id === '') continue
    // 멱등: 이미 새 포맷에 있으면 건너뛴다. `readSnapshot` 이 던지는 것(= 이미 있는데 손상)도
    // 「있다」로 본다 — 덮어써서 고칠 일이 아니다.
    try {
      if (await readSnapshot(cwd, id) !== null) continue
    } catch {
      continue
    }
    if (!ProjectModelSchema.safeParse(rec.model).success) {
      skipped.push({ id, name: typeof rec.name === 'string' ? rec.name : '' })
      continue
    }
    await writeSnapshot(cwd, rec)
    moved.push(id)
  }

  await rename(join(cwd, OLD_FILE), join(cwd, `${OLD_FILE}.migrated`))
  return { moved, skipped }
}
