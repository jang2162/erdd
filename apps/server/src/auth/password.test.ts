import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from './password.js'

describe('password', () => {
  it('hashes with a random salt (two hashes differ) and verifies correctly', async () => {
    const a = await hashPassword('secret-123')
    const b = await hashPassword('secret-123')
    expect(a).not.toBe(b)
    expect(a.startsWith('scrypt:')).toBe(true)
    expect(await verifyPassword('secret-123', a)).toBe(true)
    expect(await verifyPassword('wrong', a)).toBe(false)
  })

  it('rejects malformed stored values without throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(await verifyPassword('x', 'scrypt:only-salt')).toBe(false)
  })
})
