import { describe, expect, it } from 'vitest'
import { assertLive, issueToken, tokenExpiry } from './one-time-token.js'

describe('one-time-token', () => {
  it('종류별 접두가 다르고 평문과 해시가 함께 나온다', () => {
    const inv = issueToken('invitation')
    const rst = issueToken('reset')
    expect(inv.plain.startsWith('erdd_inv_')).toBe(true)
    expect(rst.plain.startsWith('erdd_rst_')).toBe(true)
    // 해시는 평문과 달라야 하고, 같은 평문은 같은 해시가 나와야 조회가 성립한다.
    expect(inv.hash).not.toBe(inv.plain)
    expect(issueToken('invitation').plain).not.toBe(inv.plain)
  })

  it('만료는 초대 7일 · 재설정 24시간이다', () => {
    const now = Date.now()
    const inv = tokenExpiry('invitation').getTime() - now
    const rst = tokenExpiry('reset').getTime() - now
    // 초 단위 오차를 허용한다(호출 시각 차이).
    expect(Math.round(inv / 3_600_000)).toBe(24 * 7)
    expect(Math.round(rst / 3_600_000)).toBe(24)
  })

  it('살아 있는 토큰은 통과한다', () => {
    expect(() => assertLive({ expiresAt: new Date(Date.now() + 60_000), usedAt: null })).not.toThrow()
  })

  it('만료된 토큰과 사용된 토큰을 구분해 거부한다', () => {
    // 사유가 갈려야 화면이 다른 문구를 낼 수 있다. 둘 다 같은 코드로 뭉뚱그리면
    // "이미 쓴 링크"와 "기한이 지난 링크"를 사용자가 구별하지 못한다.
    // toThrow에 문자열을 주면 메시지 부분 일치를 본다 — try/catch로 쓰면 예외가
    // 안 났을 때 catch가 실행되지 않아 단언이 통째로 건너뛰어진다(조용한 통과).
    expect(() => assertLive({ expiresAt: new Date(Date.now() - 1), usedAt: null }))
      .toThrow('기한')
    expect(() => assertLive({ expiresAt: new Date(Date.now() + 60_000), usedAt: new Date() }))
      .toThrow('사용')
  })

  it('사용된 토큰은 만료 전이어도 거부된다', () => {
    expect(() => assertLive({ expiresAt: new Date(Date.now() + 86_400_000), usedAt: new Date() }))
      .toThrow()
  })
})
