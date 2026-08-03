import { describe, expect, it } from 'vitest'
import { generateToken, hashToken, tokensEqual, TOKEN_PREFIX } from './token.js'

describe('access token', () => {
  it('평문은 접두사 + base64url 32바이트다', () => {
    const t = generateToken()
    expect(t.startsWith(TOKEN_PREFIX)).toBe(true)
    const body = t.slice(TOKEN_PREFIX.length)
    expect(body).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('두 번 생성하면 다르다', () => {
    expect(generateToken()).not.toBe(generateToken())
  })

  it('해시는 64자 16진수이고 결정적이다', () => {
    const t = generateToken()
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(t)).toBe(hashToken(t))
  })

  it('tokensEqual은 같은 값에만 true다', () => {
    const a = hashToken(generateToken())
    const b = hashToken(generateToken())
    expect(tokensEqual(a, a)).toBe(true)
    expect(tokensEqual(a, b)).toBe(false)
    expect(tokensEqual(a, 'short')).toBe(false)
  })
})
