import { describe, expect, it, vi, afterEach } from 'vitest'
import { CliError, emit, emitError, exitCodeFor } from './output.js'

afterEach(() => vi.restoreAllMocks())

describe('output', () => {
  it('USAGE만 종료 코드 2이고 나머지는 1이다', () => {
    expect(exitCodeFor('USAGE')).toBe(2)
    expect(exitCodeFor('UNAUTHORIZED')).toBe(1)
    expect(exitCodeFor('CANCELLED')).toBe(1)
  })

  it('json이면 stdout에 JSON만, 아니면 stdout에 사람용 문구만 낸다', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    emit(true, '사람용', { a: 1 })
    expect(out.mock.calls[0]![0]).toBe('{"a":1}\n')
    out.mockClear()
    emit(false, '사람용', { a: 1 })
    expect(out.mock.calls[0]![0]).toBe('사람용\n')
  })

  it('오류는 json일 때 error 봉투 하나만 낸다', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    emitError(true, new CliError('UNAUTHORIZED', '토큰이 유효하지 않습니다'))
    expect(JSON.parse(out.mock.calls[0]![0] as string)).toEqual({
      error: { code: 'UNAUTHORIZED', message: '토큰이 유효하지 않습니다' },
    })
    expect(err).not.toHaveBeenCalled()
  })

  it('오류는 json이 아닐 때 stderr로만 나간다', () => {
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    emitError(false, new CliError('NO_CONFIG', 'erdd.config.yaml이 없습니다'))
    expect(out).not.toHaveBeenCalled()
    expect(err.mock.calls[0]![0]).toContain('erdd.config.yaml이 없습니다')
  })
})
