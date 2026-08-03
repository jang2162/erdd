import { describe, expect, it, vi, afterEach } from 'vitest'
import { main } from './main.js'

afterEach(() => vi.restoreAllMocks())

describe('main', () => {
  it('알 수 없는 명령은 2로 끝난다', async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['nope'], '/tmp')).toBe(2)
  })

  it('명령이 없으면 사용법을 stderr로 내고 2로 끝난다', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main([], '/tmp')).toBe(2)
    expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('사용법')
    expect(out).not.toHaveBeenCalled()
  })

  it('--help는 0으로 끝난다', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['--help'], '/tmp')).toBe(0)
  })

  it('config가 없는 곳에서 status는 1이고 NO_CONFIG를 낸다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['status', '--json'], '/tmp/erdd-does-not-exist')).toBe(1)
    expect(JSON.parse(out.join('')).error.code).toBe('NO_CONFIG')
  })
})
