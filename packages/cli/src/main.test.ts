import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

  it('--json이면 사용법 오류도 stdout에 JSON 봉투로 낸다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['bogus', '--json'], '/tmp')).toBe(2)
    expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
    out.length = 0
    expect(await main(['--json'], '/tmp')).toBe(2)
    expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
  })

  it('명령 뒤의 --help도 사용법으로 처리한다', async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['pull', '--help'], '/tmp/erdd-none')).toBe(0)
    expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('사용법')
  })

  it('값 없는 플래그의 다음 플래그를 값으로 삼키지 않는다', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    // --server에 값이 없다. --token을 값으로 삼키면 서버 URL이 "--token"이 되어
    // NETWORK 오류로 번지고, 삼키지 않으면 대화형 입력이 없어 USAGE로 끝난다.
    const code = await main(['init', '--json', '--server', '--token', 'erdd_pat_x'], '/tmp/erdd-none')
    expect(code).toBe(2)
    expect(JSON.parse(out.join('')).error.code).toBe('USAGE')
  })

  it('도움말에 새 명령이 모두 나온다', async () => {
    const err: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((c) => { err.push(String(c)); return true })
    expect(await main(['--help'], '/tmp')).toBe(0)
    for (const c of ['push', 'diff', 'skill install']) expect(err.join('')).toContain(c)
  })

  it('push·diff가 사용법 오류로 떨어지지 않고 명령으로 배선돼 있다', async () => {
    // config가 없는 곳이면 NO_CONFIG(1)여야 한다 — USAGE(2)면 switch에 배선되지 않은 것이다.
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true })
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    for (const cmd of ['push', 'diff']) {
      out.length = 0
      expect(await main([cmd, '--json'], '/tmp/erdd-does-not-exist')).toBe(1)
      expect(JSON.parse(out.join('')).error.code).toBe('NO_CONFIG')
    }
  })

  it('skill install이 배선돼 있고 -m이 push의 요약으로 전달된다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-main-'))
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    expect(await main(['skill', 'install'], dir)).toBe(0)
    expect(await readFile(join(dir, '.claude/skills/erdd/SKILL.md'), 'utf8')).toContain('name: erdd')
    // -m은 config가 없어 NO_CONFIG로 끝나지만, 플래그 파싱이 깨지면 USAGE(2)가 된다.
    expect(await main(['push', '-m', '요약', '--json'], '/tmp/erdd-does-not-exist')).toBe(1)
  })
})
