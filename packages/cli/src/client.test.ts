import { describe, expect, it, vi, afterEach } from 'vitest'
import { createClient } from './client.js'

afterEach(() => vi.unstubAllGlobals())

function stubFetch(impl: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn((u: string | URL, i?: RequestInit) => Promise.resolve(impl(String(u), i)))
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('client', () => {
  it('GET /trpc/<path>?input=<인코딩된 JSON>으로 부르고 data를 꺼낸다', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({ result: { data: { ok: 1 } } }), { status: 200 }))
    const c = createClient('https://erdd.example.com', 'erdd_pat_x')
    expect(await c.query('model.get', { projectId: 'p1' })).toEqual({ ok: 1 })
    const url = String(spy.mock.calls[0]![0])
    expect(url).toBe('https://erdd.example.com/trpc/model.get?input=' + encodeURIComponent('{"projectId":"p1"}'))
  })

  it('토큰이 있으면 Authorization 헤더를 붙인다', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({ result: { data: null } }), { status: 200 }))
    await createClient('https://x', 'erdd_pat_x').query('auth.me', {})
    const init = spy.mock.calls[0]![1] as RequestInit
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer erdd_pat_x')
  })

  it('토큰이 없으면 UNAUTHORIZED로 즉시 실패한다', async () => {
    const spy = stubFetch(() => new Response('{}', { status: 200 }))
    await expect(createClient('https://x', null).query('auth.me', {}))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('서버 오류 코드를 CliError 코드로 옮긴다', async () => {
    stubFetch(() => new Response(
      JSON.stringify({ error: { message: '권한이 없습니다', data: { code: 'FORBIDDEN' } } }),
      { status: 403 },
    ))
    await expect(createClient('https://x', 't').query('model.get', {}))
      .rejects.toMatchObject({ code: 'FORBIDDEN', message: '권한이 없습니다' })
  })

  it('네트워크 실패는 NETWORK다', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('connect ECONNREFUSED'))))
    await expect(createClient('https://x', 't').query('auth.me', {}))
      .rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('serverUrl 끝의 슬래시를 중복시키지 않는다', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({ result: { data: 1 } }), { status: 200 }))
    await createClient('https://x/', 't').query('auth.me', {})
    expect(String(spy.mock.calls[0]![0])).toContain('https://x/trpc/auth.me')
  })
})
