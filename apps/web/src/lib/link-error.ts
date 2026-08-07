import { isTRPCClientError } from '@trpc/client'
import type { AppRouter } from '@erdd/server/src/router.js'

/**
 * 일회용 링크 화면(초대 수락 · 비밀번호 재설정)이 "다시 제출해도 결과가 달라지지 않는다"고 보는
 * 오류 코드. 서버가 실제로 내는 것만 담는다(2026-08-07 `apps/server` 확인):
 *
 * | 코드 | 사유 | 어디서 |
 * |---|---|---|
 * | `BAD_REQUEST` | 없는·기한이 지난·이미 사용된 토큰 | `invitation.peek`·`accept`, `auth.resetPassword` |
 * | `CONFLICT` | 이미 가입한 이메일 | `invitation.accept` |
 *
 * **허용 목록인 것이 의도다 — 모르는 오류는 비종료성으로 본다.** 오분류의 대가가 한쪽으로만 크다.
 * 일시적 오류(네트워크 단절, 5xx)를 종료성으로 보면 **살아 있는 토큰이 죽은 것으로 표시되고**
 * 폼과 입력이 통째로 사라진다 — 사용자는 헛되이 새 링크를 요청하고 회복 경로는 새로고침뿐이다.
 * 더 나쁘게는, 수락이 서버에서 커밋된 뒤 응답만 유실되면 계정은 만들어졌는데 화면은 "링크가
 * 죽었다"고 말한다. 반대 방향의 오분류는 사용자가 한 번 더 눌러 같은 사유를 다시 보는 것뿐이다.
 *
 * 그래서 네트워크 단절(`TRPCClientError`지만 `data`가 없다)과 5xx(`INTERNAL_SERVER_ERROR`),
 * `PRECONDITION_FAILED`(DB 미구성) 는 전부 비종료성이다.
 */
const TERMINAL_CODES: ReadonlySet<string> = new Set(['BAD_REQUEST', 'CONFLICT'])

/** 비종료성 오류일 때 화면에 띄우는 문구. 폼은 그대로 두고 이것만 덧붙인다. */
export const TRANSIENT_FAILURE_MESSAGE = '지금은 처리하지 못했습니다. 잠시 후 다시 시도하세요.'

/**
 * 종료성 오류면 화면에 띄울 사유를, 아니면 `null`을 준다.
 * `null`을 받은 화면은 **폼을 지우지 않는다**.
 */
export function terminalLinkReason(error: unknown): string | null {
  if (!isTRPCClientError<AppRouter>(error)) return null
  return TERMINAL_CODES.has(error.data?.code ?? '') ? error.message : null
}
