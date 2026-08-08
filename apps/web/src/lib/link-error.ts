import { isTRPCClientError } from '@trpc/client'
import type { AppRouter } from '@erdd/server/src/router.js'

/**
 * 일회용 링크 화면(초대 수락 · 비밀번호 재설정)이 더 진행할 수 없는 사유. 화면은 폼을 지우고
 * 이것을 보여준다.
 */
export type TerminalLinkFailure = {
  /**
   * 다음 행동이 갈리므로 사유의 갈래도 갈린다. 판정은 **서버가 명시한 `data.linkReissuable`**이다.
   * - `dead` — 링크가 죽었지만 **다시 받을 수 있다**(없음·기한 지남·취소됨, 그리고 재설정은
   *   이미 사용됨까지). 다음 행동은 관리자에게 새 링크를 요청하는 것이다.
   * - `registered` — 그 이메일에 **이미 계정이 있어 새 링크가 존재할 수 없다**. 초대의
   *   "이미 사용됨"(수락이 계정 생성과 `usedAt`을 한 트랜잭션으로 하므로 계정이 확정된다)과
   *   "이미 가입한 이메일"(accept 409)이 여기 온다. 실측 2026-08-09: 그 이메일로
   *   `admin.users.invite`도 `invitation.create`도 409다 — 새 링크를 만들 수 없다.
   *   그래서 이 갈래에 "관리자에게 문의해 새 링크를 받으세요"를 내면 **불가능한 다음 행동을
   *   안내하는 것이 된다.** 다음 행동은 로그인이다.
   */
  kind: 'dead' | 'registered'
  /** 화면에 그대로 띄울 서버 문구. */
  reason: string
}

/** 비종료성 오류일 때 화면에 띄우는 문구. 폼은 그대로 두고 이것만 덧붙인다. */
export const TRANSIENT_FAILURE_MESSAGE = '지금은 처리하지 못했습니다. 잠시 후 다시 시도하세요.'

/**
 * 종료성 오류면 사유와 갈래를, 아니면 `null`을 준다.
 * `null`을 받은 화면은 **폼을 지우지 않는다**.
 *
 * 판정 근거는 **서버가 명시한 `data.linkDead`뿐이다**(`services/one-time-token.ts`의
 * `LinkDeadError` + `trpc.ts`의 errorFormatter). 오류 **코드로는 갈릴 수 없다** — zod 입력 검증
 * 실패도 `BAD_REQUEST`로 오는데 그것은 링크가 아니라 입력이 틀렸다는 뜻이다(실측 2026-08-08:
 * `auth.resetPassword`에 7자 비밀번호를 보내면 `BAD_REQUEST` + zod issue JSON 배열 문자열이
 * 오는데 같은 토큰으로 곧바로 다시 보내면 200이다 — 토큰은 살아 있었다). 코드로 판정하던 때는
 * 그 경우에 **살아 있는 링크가 죽은 것으로 표시되고** 폼·입력이 사라지며 zod JSON이 사유로
 * 노출됐다.
 *
 * **허용 목록이고 모르는 오류는 비종료성으로 떨어진다**(설계 §6.1). 오분류의 대가가 한쪽으로만
 * 크기 때문이다. 일시적 오류(네트워크 단절, 5xx, `PRECONDITION_FAILED`)를 종료성으로 보면 살아
 * 있는 토큰이 죽은 것으로 표시되고 폼과 입력이 통째로 사라진다 — 사용자는 헛되이 새 링크를
 * 요청하고 회복 경로는 새로고침뿐이다. 더 나쁘게는, 수락이 서버에서 커밋된 뒤 응답만 유실되면
 * 계정은 만들어졌는데 화면은 "링크가 죽었다"고 말한다. 반대 방향의 오분류는 사용자가 한 번 더
 * 눌러 같은 사유를 다시 보는 것뿐이다. 표식을 종료성 쪽에 달았으므로 **새 오류는 자동으로
 * 안전한 쪽으로 떨어진다.**
 *
 * 갈래(`kind`)도 서버가 말한다(`data.linkReissuable`). **오류 코드로도 message 문자열로도
 * 갈릴 수 없다** — 소비된 초대와 만료된 초대는 둘 다 `BAD_REQUEST` + `linkDead: true`로 오고
 * message만 다르다(실측 2026-08-09). 여기서도 기본값은 안전한 쪽이다: `linkReissuable`이
 * 명시적으로 `false`가 아니면 `dead`(= "관리자에게 문의")로 떨어진다. "새 링크를 받을 수
 * 없습니다"가 더 센 주장이므로 그쪽만 표식을 요구한다.
 */
export function terminalLinkFailure(error: unknown): TerminalLinkFailure | null {
  if (!isTRPCClientError<AppRouter>(error)) return null
  if (error.data?.linkDead !== true) return null
  return {
    kind: error.data.linkReissuable === false ? 'registered' : 'dead',
    reason: error.message,
  }
}
