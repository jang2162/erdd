import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ProjectModel } from '@erdd/core'

export const SNAPSHOTS_FILE = '.erdd/snapshots.json'

export type SnapshotRecord = {
  id: string
  name: string
  description: string
  revisionSeq: number
  model: ProjectModel
  /** 서버가 Date 를 주므로 로컬도 Date 로 되살려 넘긴다. 파일에는 ISO 문자열로 담는다. */
  createdAt: string
}

export async function readSnapshots(cwd: string): Promise<SnapshotRecord[]> {
  let raw: string
  try {
    raw = await readFile(join(cwd, SNAPSHOTS_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) return []
  const items = (parsed as { snapshots?: unknown }).snapshots
  return Array.isArray(items) ? (items as SnapshotRecord[]) : []
}

export async function writeSnapshots(cwd: string, items: SnapshotRecord[]): Promise<void> {
  const abs = join(cwd, SNAPSHOTS_FILE)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, `${JSON.stringify({ snapshots: items }, null, 2)}\n`, 'utf8')
}
