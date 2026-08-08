import { isTRPCClientError } from '@trpc/client'
import type { AppRouter } from '@erdd/server/src/router.js'

/**
 * 일회용 링크 화면(초대 수락 · 비밀번호 재설정)이 더 진행할 수 없는 사유. 화면은 폼을 지우고
 * 이것을 보여준다.
 */
export type TerminalLinkFailure = {
  /**
   * 다음 행동이 갈리므로 사유의 갈래도 갈린다.
   * - `dead` — 링크가 죽었다(없음·기한 지남·이미 사용됨). 다음 행동은 새 링크를 받는 것이다.
   * - `registered` — 그 이메일에 **이미 계정이 있다**. 새 링크는 **존재할 수 없다** —
   *   `invitation.create`가 같은 이메일을 CONFLICT로 거절하기 때문이다(실측 2026-08-08:
   *   같은 이메일로 관리자 초대와 조직 초대가 동시에 살아 있을 때 하나를 수락하면, 남은 링크의
   *   `accept`는 409 "이미 가입한 이메일입니다"인데 관리자가 새 링크를 만들려 해도 409
   *   "이미 가입한 사용자입니다 — 멤버 추가를 쓰세요"로 막힌다). 그래서 이 갈래에 "관리자에게
   *   문의해 새 링크를 받으세요"를 내면 **불가능한 다음 행동을 안내하는 것이 된다** —
   *   다음 행동은 로그인이다.
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
 */
export function terminalLinkFailure(error: unknown): TerminalLinkFailure | null {
  if (!isTRPCClientError<AppRouter>(error)) return null
  if (error.data?.linkDead !== true) return null
  return {
    kind: error.data.code === 'CONFLICT' ? 'registered' : 'dead',
    reason: error.message,
  }
}
