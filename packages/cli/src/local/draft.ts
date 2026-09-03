import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ProjectModelSchema, type ProjectModel } from '@erdd/core'
import { STATE_DIR } from '../config.js'

export const DRAFT_FILE = `${STATE_DIR}/draft.json`

/**
 * `status`·`validate`·`push` 가 **같은 문구**를 쓴다. 갈리면 사용자가 다른 일로 읽는다.
 */
export const UNSAVED_NOTICE =
  '⚠️ 저장하지 않은 편집이 있습니다 — erdd serve 화면에서 저장해야 파일에 반영됩니다'

/**
 * 저장하지 않은 편집. **모델+배치가 한 덩어리**다(좌표·메모가 `model` 안에 들어 있다).
 *
 * `baseSignature` 는 이 드래프트를 뜬 시점의 파일 서명이다 — `serve` 가 꺼진 사이 `git pull` 이
 * 파일을 바꿨는지 **재시작 때 판정하는 유일한 근거**다. 조용히 얹으면 사용자는 브랜치가 바뀐 줄
 * 모른 채 저장해 남의 변경을 덮는다.
 */
export type Draft = {
  formatVersion: 1
  baseSignature: string
  seq: number
  updatedAt: string
  model: ProjectModel
}

export type DraftRead =
  | { kind: 'none' }
  | { kind: 'corrupt'; backupPath: string }
  | { kind: 'ok'; draft: Draft }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 드래프트를 읽는다. **손상이면 지우지 않고 격리한 뒤 `corrupt` 로 알린다.**
 *
 * 🔥 `ProjectModelSchema` 로 판정하는 것이 요점이다. 손으로 만든 모양 검사(`model` 키 유무)로는
 * 부족하다 — `{}` 가 그대로 통과해 `{ ...createEmptyModel(), ...model }` 정규화에서 「유효한 빈
 * 모델」이 되고, 무결성 검사에 걸릴 것이 없어 통과한 뒤 **다음 저장이 `erdd/` 를 통째로 비운다.**
 * `snapshots.ts` 의 같은 방어와 한 벌이고, 그쪽보다 위험하다 — 스냅샷은 사용자가 복원을 눌러야
 * 닿지만 드래프트는 기동 시 자동으로 얹힌다.
 *
 * ⚠️ 반환하는 `model` 은 원본이 아니라 **파싱 결과**다 — `words`·`terms`·`customFields` 는
 * `.default({})` 라 누락 컬렉션 보충이 파싱 안에서 일어난다. 원본을 그대로 넘기면 그 보충이 사라진다.
 */
export async function readDraft(cwd: string): Promise<DraftRead> {
  const abs = join(cwd, DRAFT_FILE)
  let raw: string
  try {
    raw = await readFile(abs, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'none' }
    throw err
  }

  const quarantine = async (): Promise<DraftRead> => {
    const backupPath = join(cwd, `${STATE_DIR}/draft.corrupt-${Date.now()}.json`)
    await rename(abs, backupPath)
    return { kind: 'corrupt', backupPath }
  }

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return quarantine() }
  if (!isRecord(parsed)) return quarantine()

  const model = ProjectModelSchema.safeParse(parsed['model'])
  if (!model.success) return quarantine()

  return {
    kind: 'ok',
    draft: {
      formatVersion: 1,
      baseSignature: typeof parsed['baseSignature'] === 'string' ? parsed['baseSignature'] : '',
      seq: typeof parsed['seq'] === 'number' ? parsed['seq'] : 0,
      updatedAt: typeof parsed['updatedAt'] === 'string' ? parsed['updatedAt'] : '',
      model: model.data,
    },
  }
}

/**
 * **원자적으로 쓴다** — 임시 파일에 쓰고 `rename` 한다. 이 파일 하나가 사용자의 미저장 작업
 * 전부를 담으므로, 쓰다가 죽어 반쪽이 남는 갈래를 만들면 안 된다(`rename` 은 같은 파일시스템에서
 * 원자적이다).
 */
export async function writeDraft(cwd: string, draft: Draft): Promise<void> {
  const abs = join(cwd, DRAFT_FILE)
  await mkdir(dirname(abs), { recursive: true })
  const tmp = `${abs}.tmp`
  await writeFile(tmp, `${JSON.stringify(draft)}\n`, 'utf8')
  await rename(tmp, abs)
}

/** 이미 없는 것은 성공으로 본다. */
export async function removeDraft(cwd: string): Promise<void> {
  try {
    await rm(join(cwd, DRAFT_FILE))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
}

/**
 * 존재만 본다 — **파싱하지 않는다.** `status`·`validate`·`push` 가 이것만 쓰므로, 손상된
 * 드래프트 때문에 그 명령들이 실패하거나 (더 나쁘게) 격리를 일으키면 안 된다.
 */
export async function hasDraft(cwd: string): Promise<boolean> {
  try {
    await readFile(join(cwd, DRAFT_FILE), 'utf8')
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}
