/**
 * 로컬 서버(`erdd serve`)와 웹 사이의 **tRPC 밖 채널** 정의.
 *
 * 저장·버리기·유지는 서버 라우터에 없는 로컬 전용 동작이라 tRPC 프로시저로 만들 수 없다 —
 * 만들면 `packages/cli/src/local/router.test.ts` 의 `LocalOnly` 잠금이 깨지고, 애초에 웹은
 * `AppRouter` **타입**으로 클라이언트를 만들어 그 이름을 부를 수조차 없다.
 * `GET /local/events`(SSE)가 이미 같은 형태라 그 선례를 따른다.
 *
 * ⚠️ **tRPC 밖으로 나가면 타입 계약이 사라지므로 정의를 여기 한자리에 둔다.** 예전에는 SSE
 * 페이로드 모양이 `server.ts` 와 `use-local-watch.ts` 에 **각각 인라인 리터럴로 두 벌** 적혀
 * 있었다 — 로컬 라우터의 계약 표류와 같은 종류의 위험이다. `realtime-protocol.ts` 와 같은
 * 형태이고 같은 이유로 IO 가 없다.
 */
import type { ChangeIssue } from './changeset/types.js'
import type { ChangeRecordSummary, ComposeFailureReason } from './changeset/plan.js'

export const LOCAL_EVENTS_PATH = '/local/events'
export const LOCAL_SAVE_PATH = '/local/save'
export const LOCAL_DISCARD_PATH = '/local/discard'
export const LOCAL_KEEP_PATH = '/local/keep'

/** 변경 기록 상태(POST — 로컬 전용 라우트는 전부 POST 다). */
export const LOCAL_CHANGES_PATH = '/local/changes'
/** 변경 기록 생성. 본문 JSON `{ name, baseline? }`. */
export const LOCAL_CHANGES_CREATE_PATH = '/local/changes/create'

/** 미저장 편집이 있을 때 서버 거절과 웹 안내가 같은 문구를 쓴다. */
export const LOCAL_CHANGES_UNSAVED_MESSAGE = '저장하지 않은 편집이 있습니다. 먼저 저장한 뒤 변경 기록을 만드세요'

export type LocalChangesStatus = {
  records: ChangeRecordSummary[]
  /** 오류가 있으면 null. `text` 는 문장만(머릿말 없이). */
  pending: { text: string; count: number } | null
  warnings: ChangeIssue[]
  error: ChangeIssue | null
  unsaved: boolean
}

export type LocalChangesCreateResult =
  | { ok: true; file: string; statementCount: number }
  | { ok: false; reason: 'unsaved' | 'blocked' | ComposeFailureReason; message: string }

export type LocalLoadFailure = { path: string; message: string }

/**
 * 서버 → 브라우저 단방향 알림.
 * - `reload`: 디스크가 바뀌었고 그것을 채택했다. 브라우저가 모델을 다시 가져온다
 * - `blocked`: 파일이 깨져 편집이 잠겼다
 * - `status`: 미저장 여부·외부 변경 여부. **모델을 나르지 않는다** — 드래그 중에 와도 화면이
 *   튀지 않는다
 */
export type LocalEvent =
  | { type: 'reload' }
  | { type: 'blocked'; failures: LocalLoadFailure[] }
  | { type: 'status'; dirty: boolean; external: boolean }

/** `written`·`deleted` 가 둘 다 비면 쓸 것이 없었다는 뜻이고 **그것도 성공이다.** */
export type LocalSaveResult =
  | { ok: true; seq: number; written: string[]; deleted: string[] }
  | { ok: false; reason: 'blocked' | 'external'; message: string }

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isFailure = (v: unknown): v is LocalLoadFailure =>
  isRecord(v) && typeof v['path'] === 'string' && typeof v['message'] === 'string'

/**
 * 반환 `null` = 형식 오류이거나 **모르는 `type`** 이다.
 *
 * 모르는 것을 던지지 않고 `null` 로 돌려주는 것이 요점이다 — 설치본의 웹 번들과 CLI 는 따로
 * 움직이므로(패키지 동봉본 vs 저장소 빌드) **버전이 어긋난 짝**이 정상 동선이다. 이 함수가
 * 지키는 것은 「지금 웹이 **나중** CLI 의 새 이벤트를 만나는」 방향이다(반대 방향, 즉 옛 웹은
 * 이 함수를 갖고 있지 않으므로 여기서 지킬 수 없다 — 다행히 옛 인라인 파서도 모르는 `type` 을
 * 무시했다).
 */
export function parseLocalEvent(raw: string): LocalEvent | null {
  let v: unknown
  try { v = JSON.parse(raw) } catch { return null }
  if (!isRecord(v)) return null
  if (v['type'] === 'reload') return { type: 'reload' }
  if (v['type'] === 'blocked') {
    const failures = v['failures']
    if (!Array.isArray(failures) || !failures.every(isFailure)) return null
    return { type: 'blocked', failures }
  }
  if (v['type'] === 'status') {
    const dirty = v['dirty']
    const external = v['external']
    if (typeof dirty !== 'boolean' || typeof external !== 'boolean') return null
    return { type: 'status', dirty, external }
  }
  return null
}
