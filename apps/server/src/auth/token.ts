import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const TOKEN_PREFIX = 'erdd_pat_'
export const INVITE_PREFIX = 'erdd_inv_'
export const RESET_PREFIX = 'erdd_rst_'

export function generateToken(prefix: string = TOKEN_PREFIX): string {
  return prefix + randomBytes(32).toString('base64url')
}

/**
 * 비밀번호(scrypt)와 달리 단순 SHA-256을 쓴다. scrypt는 저엔트로피 비밀번호의
 * 무차별 대입을 늦추려는 것인데 256비트 랜덤 토큰에는 그 공격 표면이 없고,
 * 대신 모든 API 요청마다 scrypt를 도는 비용을 피해야 한다.
 */
export function hashToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex')
}

export function tokensEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
