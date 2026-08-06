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
 * 만료·1회용 판정을 한 곳에 모은다. 초대와 재설정이 각자 판정하면 한쪽만 고쳐질 수 있고,
 * 그 순간 죽은 링크가 살아난다.
 *
 * 순서가 중요하다 — 사용됨을 먼저 본다. 사용된 뒤 만료까지 된 토큰은 "이미 사용"이 더 정확한 안내다.
 */
export function assertLive(row: { expiresAt: Date; usedAt: Date | null }): void {
  if (row.usedAt !== null) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: '이미 사용된 링크입니다' })
  }
  if (row.expiresAt.getTime() <= Date.now()) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: '기한이 지난 링크입니다' })
  }
}
