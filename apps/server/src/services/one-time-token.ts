import { TRPCError } from '@trpc/server'
import { INVITE_PREFIX, RESET_PREFIX, generateToken, hashToken } from '../auth/token.js'

export type TokenKind = 'invitation' | 'reset'

const PREFIX: Record<TokenKind, string> = {
  invitation: INVITE_PREFIX,
  reset: RESET_PREFIX,
}

/** 만료: 초대는 사람이 며칠 뒤 열어도 되게 넉넉히, 재설정은 짧게. */
const TTL_MS: Record<TokenKind, number> = {
  invitation: 7 * 24 * 60 * 60 * 1000,
  reset: 24 * 60 * 60 * 1000,
}

/** 평문은 호출자가 한 번 쓰고 버린다 — DB에는 hash만 저장한다. */
export function issueToken(kind: TokenKind): { plain: string; hash: string } {
  const plain = generateToken(PREFIX[kind])
  return { plain, hash: hashToken(plain) }
}

export function tokenExpiry(kind: TokenKind): Date {
  return new Date(Date.now() + TTL_MS[kind])
}

/**
 * 일회용 링크가 **죽었다**(= 다시 제출해도 결과가 같다)는 것을 응답에 실어 보내는 오류.
 * 링크 화면이 폼을 지우는 판정의 유일한 근거다(설계 §6.1).
 *
 * **오류 코드만으로는 이것을 알 수 없다.** `BAD_REQUEST`는 zod 입력 검증 실패도 쓰는 코드이고,
 * 그것은 링크가 아니라 입력이 틀렸다는 뜻이다 — 실측(2026-08-08): `auth.resetPassword`에
 * 7자 비밀번호를 보내면 `BAD_REQUEST` + zod issue JSON 배열 문자열이 오는데, **같은 토큰으로
 * 곧바로 다시 보내면 200이다.** 토큰은 살아 있었다. `invitation.accept`도 같다.
 * 코드만 보고 종료성을 판정하면 살아 있는 링크가 죽은 것으로 표시되고 폼·입력이 통째로
 * 사라지며, 사용자에게는 zod JSON이 사유로 노출된다.
 *
 * 그래서 종료성은 **서버가 명시한다.** 이 오류로 던진 것만 `data.linkDead: true`를 달고 나가고
 * (`trpc.ts`의 errorFormatter), 나머지는 전부 비종료성으로 떨어진다. 표식을 종료성 쪽에 다는
 * 것이 의도다 — 새 미들웨어가 새 `BAD_REQUEST`를 내든 zod 메시지 형식이 바뀌든 기본값이 안전한
 * 쪽(비종료성)이고, 오분류의 대가는 한쪽으로만 크기 때문이다(§6.1).
 */
export class LinkDeadError extends TRPCError {
  constructor(opts: { code: 'BAD_REQUEST' | 'CONFLICT'; message: string }) {
    super(opts)
  }
}

/**
 * 만료·1회용 판정을 한 곳에 모은다. 초대와 재설정이 각자 판정하면 한쪽만 고쳐질 수 있고,
 * 그 순간 죽은 링크가 살아난다.
 *
 * 순서가 중요하다 — 사용됨을 먼저 본다. 사용된 뒤 만료까지 된 토큰은 "이미 사용"이 더 정확한 안내다.
 */
export function assertLive(row: { expiresAt: Date; usedAt: Date | null }): void {
  if (row.usedAt !== null) {
    throw new LinkDeadError({ code: 'BAD_REQUEST', message: '이미 사용된 링크입니다' })
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new LinkDeadError({ code: 'BAD_REQUEST', message: '기한이 지난 링크입니다' })
  }
}
