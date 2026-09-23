import { appRouter } from '../router.js'

export type ProcedureType = 'query' | 'mutation' | 'subscription'

/**
 * 라우터에 실제로 등록된 프로시저 전부를 `[점 표기 경로, 종류]`로 준다.
 * tRPC 11의 `_def.procedures`는 점 표기 경로를 키로 갖는 평평한 레코드다.
 *
 * 문자열 상수를 손으로 적어 호출해 보는 방식은 **오타가 통과한다** — 없는 경로를 부르면
 * 404가 나고, "없어야 한다"는 단언은 그대로 만족된다. 표면을 열거해 전수 비교해야 추가·삭제·
 * 오타가 모두 깨진다.
 */
export function procedureEntries(): Array<[string, ProcedureType]> {
  const procedures = (appRouter as unknown as {
    _def: { procedures: Record<string, { _def: { type: ProcedureType } }> }
  })._def.procedures
  return Object.entries(procedures).map(([path, p]) => [path, p._def.type])
}

/**
 * 세션 없이 부를 수 있는 프로시저 전부(설계 3.5). 앞의 넷은 이 사이클 이전부터 공개였고,
 * 뒤의 셋이 설계 3.5가 허용한 셋이다. **여기 없는 공개 프로시저는 규칙 위반이다.**
 */
export const PUBLIC_PATHS = [
  'health.ping',
  'logicalType.parse',
  'auth.login',
  'auth.logout',
  'invitation.peek',
  'invitation.accept',
  'auth.resetPassword',
]
