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

  it('200인데 result도 error도 없으면 NETWORK로 실패한다', async () => {
    stubFetch(() => new Response(JSON.stringify({ hello: 'world' }), { status: 200 }))
    await expect(createClient('https://x', 't').query('auth.me', {}))
      .rejects.toMatchObject({ code: 'NETWORK' })
  })

  it('result는 있고 data가 없는 정상 응답은 통과시킨다', async () => {
    stubFetch(() => new Response(JSON.stringify({ result: {} }), { status: 200 }))
    await expect(createClient('https://x', 't').query('auth.me', {})).resolves.toBeUndefined()
  })

  it('입력 검증 실패(BAD_REQUEST)는 VALIDATION이다', async () => {
    stubFetch(() => new Response(
      JSON.stringify({ error: { message: 'projectId는 uuid여야 합니다', data: { code: 'BAD_REQUEST' } } }),
      { status: 400 },
    ))
    await expect(createClient('https://x', 't').query('model.get', { projectId: 'nope' }))
      .rejects.toMatchObject({ code: 'VALIDATION', message: 'projectId는 uuid여야 합니다' })
  })

  it('mutate는 POST로 body에 input을 싣는다', async () => {
    const spy = stubFetch(() => new Response(JSON.stringify({ result: { data: { seq: 7 } } }), { status: 200 }))
    const c = createClient('https://erdd.example.com/', 'erdd_pat_x')
    expect(await c.mutate('model.push', { projectId: 'p', expectedSeq: 3, ops: [] })).toEqual({ seq: 7 })
    expect(String(spy.mock.calls[0]![0])).toBe('https://erdd.example.com/trpc/model.push')
    const init = spy.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json')
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer erdd_pat_x')
    expect(JSON.parse(String(init.body))).toEqual({ projectId: 'p', expectedSeq: 3, ops: [] })
  })

  it('서버의 CONFLICT를 CliError CONFLICT로 옮긴다', async () => {
    stubFetch(() => new Response(
      JSON.stringify({ error: { message: '서버가 앞서 있습니다', data: { code: 'CONFLICT' } } }),
      { status: 409 },
    ))
    await expect(createClient('https://x', 't').mutate('model.push', {}))
      .rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('토큰이 없으면 mutate도 서버를 부르지 않고 UNAUTHORIZED다', async () => {
    const spy = stubFetch(() => new Response('{}', { status: 200 }))
    await expect(createClient('https://x', null).mutate('model.push', {}))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(spy).not.toHaveBeenCalled()
  })
})
