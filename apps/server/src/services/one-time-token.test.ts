import { describe, expect, it } from 'vitest'
import { hashToken } from '../auth/token.js'
import { assertLive, issueToken, tokenExpiry } from './one-time-token.js'

const DAY_MS = 24 * 60 * 60 * 1000

describe('one-time-token', () => {
  it('종류별 접두가 다르고 평문과 해시가 함께 나온다', () => {
    const inv = issueToken('invitation')
    const rst = issueToken('reset')
    expect(inv.plain.startsWith('erdd_inv_')).toBe(true)
    expect(rst.plain.startsWith('erdd_rst_')).toBe(true)
    // 저장하는 것은 해시뿐이므로, 나중에 평문으로 그 행을 찾으려면 hash가 정확히
    // hashToken(plain)이어야 한다. 이게 어긋나면 발급된 링크가 전부 조회에 실패한다.
    expect(inv.hash).toBe(hashToken(inv.plain))
    expect(rst.hash).toBe(hashToken(rst.plain))
    // 매번 다른 평문 → 다른 해시. token_hash가 UNIQUE라 같으면 두 번째 발급이 23505로 터진다.
    const again = issueToken('invitation')
    expect(again.plain).not.toBe(inv.plain)
    expect(again.hash).not.toBe(inv.hash)
  })

  it('만료는 초대 7일 · 재설정 24시간이다', () => {
    const now = Date.now()
    const inv = tokenExpiry('invitation').getTime() - now
    const rst = tokenExpiry('reset').getTime() - now
    // tokenExpiry는 now를 찍은 뒤 Date.now()를 다시 부르므로 차이는 TTL 이상이다.
    // 위쪽만 5초로 죈다 — 시 단위로 반올림하면 TTL을 5분 늘려도 통과해 버린다.
    expect(inv).toBeGreaterThanOrEqual(7 * DAY_MS)
    expect(inv).toBeLessThan(7 * DAY_MS + 5_000)
    expect(rst).toBeGreaterThanOrEqual(DAY_MS)
    expect(rst).toBeLessThan(DAY_MS + 5_000)
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

  it('사용된 뒤 기한까지 지난 토큰은 "이미 사용"으로 안내한다', () => {
    // 두 조건이 동시에 참인 유일한 입력이다 — 검사 순서가 뒤집히면 여기서만 갈린다.
    expect(() => assertLive({ expiresAt: new Date(Date.now() - 1), usedAt: new Date() }))
      .toThrow('사용')
  })
})
