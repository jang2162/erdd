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
export const LOCAL_EVENTS_PATH = '/local/events'
export const LOCAL_SAVE_PATH = '/local/save'
export const LOCAL_DISCARD_PATH = '/local/discard'
export const LOCAL_KEEP_PATH = '/local/keep'

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
 * 모르는 것을 던지지 않고 `null` 로 돌려주는 것이 요점이다 — 설치본의 웹 번들은 CLI 버전과 따로
 * 움직이므로(패키지 동봉본 vs 저장소 빌드), 새 이벤트가 옛 웹에 도착하는 일이 정상 동선이다.
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
