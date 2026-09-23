import { gunzipSync, gzipSync } from 'node:zlib'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { ProjectModelSchema, type ProjectModel } from '@erdd/core'

/**
 * 스냅샷은 **커밋 대상**이다(`erdd/` 아래). 하나당 파일 하나라 새 스냅샷이 새 blob 하나만 더하고
 * 기존 blob 을 재사용한다 — 단일 파일이면 만들 때마다 전체가 새 blob 이 되어 저장소가 빠르게 부푼다.
 *
 * ⚠️ **`readTree`/`writeTree` 는 이 디렉터리를 보지 않는다** — `TOP_LEVEL_FILES`와
 * `erdd/tables/*.yaml` 만 훑기 때문이다. 그래서 모델 파싱에 섞이지 않고 `erdd pull` 의
 * `writeTree` 가 지우지도 않는다. 다만 `watchProject` 는 `erdd/` 를 재귀 감시하므로 스냅샷을 쓸
 * 때마다 감시가 깨어난다 — 읽어 봐야 `readTree` 결과가 그대로라 기준선이 움직이지 않아 아무것도
 * 브로드캐스트되지 않는다(무해).
 */
export const SNAPSHOTS_DIR = 'erdd/snapshots'
export const SNAPSHOTS_INDEX = `${SNAPSHOTS_DIR}/index.yaml`

/** 파일은 있는데 내용을 복원에 쓸 수 없다. 「없다」와 **반드시 구별해서** 알린다. */
export class SnapshotCorruptError extends Error {}

export type SnapshotRecord = {
  id: string
  name: string
  description: string
  revisionSeq: number
  model: ProjectModel
  /** 서버가 Date 를 주므로 로컬도 Date 로 되살려 넘긴다. 파일에는 ISO 문자열로 담는다. */
  createdAt: string
}

export type SnapshotMeta = Omit<SnapshotRecord, 'model'>

/**
 * 파일명은 **id 뿐이다.** 스냅샷 이름을 넣지 않는 이유 둘.
 * 1. `unsafeFileName`(core)이 이미 푼 문제 — 경로 구분자·`.`·`..`·빈 문자열 — 를 다시 만난다.
 * 2. 이 프로젝트의 스냅샷 이름은 **한국어**가 정상인데, macOS 는 파일명을 NFD 로 git 인덱스는
 *    NFC 로 들고 있어 같은 파일이 플랫폼마다 다른 이름으로 보인다.
 *
 * 시각 접두도 붙이지 않는다 — uuidv7 은 앞 48비트가 밀리초 타임스탬프라 **사전순 = 시간순**이다.
 * 사람이 읽을 이름은 파일명이 아니라 `index.yaml` 이 맡는다.
 */
const ID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const FILE_RE = /^([0-9a-fA-F-]{36})\.json\.gz$/

/**
 * ⚠️ **id 가 곧 파일 경로가 되므로 형식을 반드시 검사한다.** 라우터 입력은 `z.string()` 이고
 * (서버 라우터와 같은 타입이어야 해서 좁힐 수 없다) 이행 경로는 옛 파일의 값을 그대로 쓴다 —
 * `../../` 가 섞이면 `rm` 이 프로젝트 **밖** 파일을 지우고, `readSnapshot` 은 「없음(null) vs
 * 손상(throw)」으로 갈려 임의 경로의 **존재 여부 오라클**이 된다.
 */
const fileOf = (id: string): string | null =>
  (ID_RE.test(id) ? join(SNAPSHOTS_DIR, `${id}.json.gz`) : null)

/** 디렉터리에 실제로 있는 스냅샷 id. **이것이 진실이다.** */
async function idsOnDisk(cwd: string): Promise<string[]> {
  let names: string[] = []
  try {
    names = await readdir(join(cwd, SNAPSHOTS_DIR))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  return names
    .map((n) => FILE_RE.exec(n)?.[1])
    .filter((v): v is string => v !== undefined)
    .sort()
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * 인덱스의 라벨. **깨져 있으면 빈 라벨로 본다** — 목록이 통째로 죽는 것보다 이름을 잃는 편이 낫다
 * (`readLayout` 의 항목 단위 관대함과 같은 정신이다. 다만 여기서는 편집을 잠그지 않는다 —
 * 인덱스에는 사용자 콘텐츠가 아니라 **라벨**만 들어 있고, 원본은 `.gz` 안에 그대로 있다).
 */
type IndexRead = { ok: boolean; labels: Map<string, SnapshotMeta> }

async function readIndex(cwd: string): Promise<IndexRead> {
  const out = new Map<string, SnapshotMeta>()
  let raw: string
  try {
    raw = await readFile(join(cwd, SNAPSHOTS_INDEX), 'utf8')
  } catch (err) {
    // 파일이 **없는 것은 손상이 아니다** — 라벨이 0개일 뿐이다. 이 둘을 구별해야 쓰기 경로가
    // 「덮어써도 되는 상태」와 「덮어쓰면 사용자가 쓴 이름이 사라지는 상태」를 가른다.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, labels: out }
    throw err
  }
  let parsed: unknown
  try { parsed = parseYaml(raw) } catch { return { ok: false, labels: out } }
  if (!isRecord(parsed)) return { ok: false, labels: out }
  const items = parsed['snapshots']
  if (!Array.isArray(items)) return { ok: false, labels: out }
  for (const item of items) {
    if (!isRecord(item) || typeof item['id'] !== 'string' || item['id'] === '') continue
    out.set(item['id'], {
      id: item['id'],
      name: typeof item['name'] === 'string' ? item['name'] : '',
      description: typeof item['description'] === 'string' ? item['description'] : '',
      revisionSeq: typeof item['revisionSeq'] === 'number' ? item['revisionSeq'] : 0,
      createdAt: typeof item['createdAt'] === 'string' ? item['createdAt']
        : item['createdAt'] instanceof Date ? item['createdAt'].toISOString() : '',
    })
  }
  return { ok: true, labels: out }
}

/**
 * 인덱스를 갱신한다. **디스크에 실제로 있는 id 의 「진짜 라벨」만 쓴다.**
 *
 * 🔥 `listSnapshots` 의 결과를 그대로 쓰면 안 된다 — 그 함수는 라벨이 없는 id 에
 * `(이름 없음) …` 을 **만들어 낸다**(표시용 대체값이다). 그것을 파일에 쓰면 인덱스가 한 번
 * 읽히지 않은 순간(머지 충돌 마커가 남은 `index.yaml` — 커밋 대상이 되면서 생긴 정상 동선이다)
 * **모든 스냅샷의 이름·설명·시각이 영구 치환된다.** 표시용 대체는 `listSnapshots` 안에만 둔다.
 *
 * 인덱스를 읽지 못했으면 **덮어쓰지 않고 옮겨 둔다** — 사용자가 쓴 이름이 든 유일한 사본이다.
 */
async function updateIndex(
  cwd: string, mutate: (labels: Map<string, SnapshotMeta>) => void,
): Promise<void> {
  const read = await readIndex(cwd)
  if (!read.ok) {
    await rename(
      join(cwd, SNAPSHOTS_INDEX),
      join(cwd, `${SNAPSHOTS_DIR}/index.corrupt-${Date.now()}.yaml`),
    )
  }
  mutate(read.labels)
  const onDisk = new Set(await idsOnDisk(cwd))
  const metas = [...read.labels.values()]
    .filter((m) => onDisk.has(m.id))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  await mkdir(join(cwd, SNAPSHOTS_DIR), { recursive: true })
  await writeFile(join(cwd, SNAPSHOTS_INDEX), stringifyYaml({ snapshots: metas }), 'utf8')
}

/**
 * **디렉터리 스캔 ∩ 인덱스 라벨.** 라벨이 없으면 id 로 표시한다 — **보이지 않는 스냅샷은 없다.**
 *
 * 인덱스와 디렉터리는 갈릴 수 있다(머지 충돌을 잘못 풀거나 `.gz` 를 손으로 지우거나). 그래서
 * 어느 방향으로도 조용히 사라지지 않게 규칙을 못 박는다 — 라벨을 잃은 스냅샷도 복원·삭제할 수
 * 있고, 파일 없는 인덱스 항목이 「있다」고 거짓말하지 않는다.
 */
export async function listSnapshots(cwd: string): Promise<SnapshotMeta[]> {
  const ids = await idsOnDisk(cwd)
  const { labels } = await readIndex(cwd)
  // ⚠️ 여기서 만드는 `(이름 없음)` 은 **표시용 대체값이다.** 파일에 쓰지 마라(`updateIndex` 주석).
  const metas = ids.map((id) => labels.get(id) ?? {
    id, name: `(이름 없음) ${id.slice(0, 8)}`, description: '', revisionSeq: 0, createdAt: '',
  })
  // **최신이 위다** — 서버 모드의 `snapshot.list`(`orderBy(desc(createdAt))`)와 같은 순서여야
  // 같은 화면이 모드에 따라 뒤집히지 않는다. uuidv7 은 사전순이 곧 시간순이라 뒤집기만 하면 된다.
  return metas.reverse()
}

/**
 * 스냅샷 하나를 꺼낸다. 없으면 `null`, **못 쓰는 내용이면 던진다**(`SnapshotCorruptError`).
 *
 * 🔥 판정은 `ProjectModelSchema` 로 한다 — 손으로 만든 모양 검사(`model` 키 유무)로는 `{}` 가
 * 통과해 `{ ...createEmptyModel(), ...model }` 정규화에서 「유효한 빈 모델」이 되고, 무결성 검사에
 * 걸릴 것이 없어 통과한 뒤 **복원 후 저장이 사용자의 `erdd/` 를 통째로 비운다.** 이 방어는
 * 새 포맷에서 오히려 더 필요하다 — 스냅샷이 커밋 대상이 되면서 머지 충돌·부분 체크아웃처럼
 * 「손으로 열지 않아도 반쪽이 되는」 경로가 생겼고, `.gz` 는 눈으로 손상을 못 본다.
 *
 * ⚠️ 반환하는 `model` 은 원본이 아니라 **파싱 결과**다 — `words`·`terms`·`customFields` 는
 * `.default({})` 라 누락 컬렉션 보충이 파싱 안에서 일어난다(옛 스냅샷을 여는 데 필요하다).
 */
export async function readSnapshot(cwd: string, id: string): Promise<SnapshotRecord | null> {
  const rel = fileOf(id)
  if (rel === null) return null
  let raw: Buffer
  try {
    raw = await readFile(join(cwd, rel))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(gunzipSync(raw).toString('utf8'))
  } catch (err) {
    throw new SnapshotCorruptError((err as Error).message)
  }
  const rec = isRecord(parsed) ? parsed : {}
  const model = ProjectModelSchema.safeParse(rec['model'])
  if (!model.success) throw new SnapshotCorruptError('모델이 온전하지 않습니다')
  return {
    id,
    name: typeof rec['name'] === 'string' ? rec['name'] : '',
    description: typeof rec['description'] === 'string' ? rec['description'] : '',
    revisionSeq: typeof rec['revisionSeq'] === 'number' ? rec['revisionSeq'] : 0,
    createdAt: typeof rec['createdAt'] === 'string' ? rec['createdAt'] : '',
    model: model.data,
  }
}

/**
 * ⚠️ **`.gz` 를 먼저 쓰고 인덱스를 나중에 쓴다.** 중간에 죽으면 「라벨 없는 **복원 가능한**
 * 스냅샷」이 남는다 — 반대 순서면 「가리키는 파일이 없는 항목」이 남는다.
 *
 * 같은 내용이면 같은 바이트다(Node 는 gzip 헤더의 mtime 을 0 으로 쓴다 — 실측). 다만 OS 바이트는
 * 플랫폼차가 있으므로 「다른 머신에서 재생성하면 같은 blob」에 기대지 않는다 — 스냅샷은 한 번 쓰고
 * 다시 쓰지 않는 파일이라 기댈 자리도 없다.
 */
export async function writeSnapshot(cwd: string, rec: SnapshotRecord): Promise<void> {
  const rel = fileOf(rec.id)
  if (rel === null) throw new Error(`스냅샷 id 형식이 올바르지 않습니다: ${rec.id}`)
  return updateSnapshots(cwd, async () => {
    await mkdir(join(cwd, SNAPSHOTS_DIR), { recursive: true })
    await writeFile(join(cwd, rel), gzipSync(Buffer.from(JSON.stringify(rec), 'utf8')))
    const { model: _model, ...meta } = rec
    await updateIndex(cwd, (labels) => { labels.set(meta.id, meta) })
  })
}

/** 없던 것은 `false`. 파일을 먼저 지우고 인덱스를 정리한다. */
export async function deleteSnapshot(cwd: string, id: string): Promise<boolean> {
  const rel = fileOf(id)
  if (rel === null) return false
  let removed = false
  await updateSnapshots(cwd, async () => {
    try {
      await rm(join(cwd, rel))
      removed = true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      return
    }
    await updateIndex(cwd, (labels) => { labels.delete(id) })
  })
  return removed
}

/** 모든 읽기-수정-쓰기가 지나는 체인. `FileStore` 의 것과 별개다 — 파일이 다르다. */
let chain: Promise<unknown> = Promise.resolve()

/**
 * 인덱스의 읽기-수정-쓰기를 한 줄로 세운다.
 *
 * 두 요청이 겹치면 한쪽이 읽은 목록 위에 다른 쪽이 덮어써 **인덱스 항목 하나가 조용히 사라진다**
 * (`.gz` 는 남으므로 「라벨 없는 스냅샷」이 되어 목록에는 뜬다 — 그래도 이름을 잃는다).
 * 로컬은 단일 사용자지만 탭 둘이나 빠른 연속 클릭으로 충분히 만들어진다.
 *
 * `update` 가 던지면 그 오류만 호출자에게 가고 체인은 이어진다.
 */
function updateSnapshots(_cwd: string, update: () => Promise<void>): Promise<void> {
  const next = chain.then(update, update)
  chain = next.then(() => undefined, () => undefined)
  return next
}
