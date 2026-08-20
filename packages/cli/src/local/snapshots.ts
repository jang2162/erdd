import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ProjectModelSchema, type ProjectModel } from '@erdd/core'

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

/**
 * 레코드에서 **복원에 쓸 수 있는 모델**을 꺼낸다. 못 꺼내면 `null`.
 *
 * ⚠️ 반쪽짜리 `model` 을 그대로 쓰면 `{ ...createEmptyModel(), ...s.model }` 정규화가
 * **「유효한 빈 모델」**을 만든다. 그것은 무결성 검사에 걸릴 것이 없어 통과하고, `setModel` 뒤의
 * flush 가 사용자의 `erdd/` 파일을 통째로 비운다 — 오류도 로그도 없는 조용한 데이터 손실이다.
 * `.erdd/snapshots.json` 은 사용자가 손으로 열 수 있는 평범한 파일이라 그런 레코드가 실제로
 * 생길 수 있다(최상위 JSON 모양만 막던 방어를 원소 단위까지 내린다).
 *
 * **손으로 만든 모양 검사로는 부족하다** — `model` 키가 **없는** 것만 막으면 `{}` 는 그대로
 * 통과해 같은 유실이 난다. 그래서 `ProjectModelSchema` 로 판정한다.
 * - `{}` 는 걸린다 — `tables`·`columns` 등 일곱 컬렉션은 기본값이 없는 필수 키다.
 * - **정당하게 비어 있는 스냅샷은 통과한다** — 빈 프로젝트를 스냅샷해도 열 컬렉션 키가 전부 있는
 *   온전한 모델이 저장되기 때문이다.
 *
 * ⚠️ 반환값은 원본이 아니라 **파싱 결과**다. `words`·`terms`·`customFields` 는 `.default({})` 라
 * **누락 컬렉션 보충이 파싱 안에서 일어난다**(옛 스냅샷을 여는 데 필요하다) — 원본을 그대로
 * 넘기면 그 보충이 사라진다.
 */
export function snapshotModel(rec: SnapshotRecord): ProjectModel | null {
  const parsed = ProjectModelSchema.safeParse(rec.model)
  return parsed.success ? parsed.data : null
}

/** 모든 읽기-수정-쓰기가 지나는 체인. `FileStore` 의 것과 별개다 — 파일이 다르다. */
let chain: Promise<unknown> = Promise.resolve()

/**
 * 스냅샷 목록의 읽기-수정-쓰기를 한 줄로 세운다.
 *
 * 두 요청이 겹치면 한쪽이 읽은 목록 위에 다른 쪽이 덮어써 **스냅샷 하나가 조용히 사라진다.**
 * 로컬은 단일 사용자지만 탭 둘이나 빠른 연속 클릭으로 충분히 만들어진다(모델 쓰기를
 * `FileStore` 에서 직렬화한 것과 같은 이유다).
 *
 * `update` 가 던지면 파일은 그대로 두고 그 오류만 호출자에게 간다 — 체인은 이어진다.
 * 프로젝트 하나만 여는 서버라 체인을 cwd 별로 나누지 않는다.
 */
export function updateSnapshots(
  cwd: string,
  update: (items: SnapshotRecord[]) => SnapshotRecord[],
): Promise<void> {
  const run = async (): Promise<void> => {
    await writeSnapshots(cwd, update(await readSnapshots(cwd)))
  }
  const next = chain.then(run, run)
  chain = next.then(() => undefined, () => undefined)
  return next
}
