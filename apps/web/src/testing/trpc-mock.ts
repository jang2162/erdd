import { vi } from 'vitest'

type Handler = (input: unknown) => { data?: unknown; error?: { code: number; message: string } }

/**
 * tRPC httpBatchLink 요청을 경로별로 스텁한다.
 * handlers: { 'auth.me': () => ({ data: {...} }), 'auth.login': (input) => ({ error: { code: -32001, message: '...' } }) }
 * tRPC 오류 코드: UNAUTHORIZED=-32001 (JSON-RPC 매핑). 성공은 { result: { data } }, 실패는 { error }.
 */
export function mockTrpcFetch(handlers: Record<string, Handler>) {
  const fetchMock = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(url), 'http://localhost')
    const paths = u.pathname.replace(/^\/trpc\//, '').split(',')
    const isBatch = u.searchParams.has('batch')
    const inputs: Record<string, unknown> = (() => {
      const raw = init?.body ? String(init.body) : u.searchParams.get('input')
      if (!raw) return {}
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return isBatch ? parsed : { 0: parsed }
    })()
    const results = paths.map((path, i) => {
      const handler = handlers[path]
      if (!handler) return { error: { code: -32004, message: `no handler: ${path}`, data: { httpStatus: 404 } } }
      const out = handler(inputs[String(i)])
      if (out.error) {
        return { error: { code: out.error.code, message: out.error.message, data: { httpStatus: out.error.code === -32001 ? 401 : 400, code: 'ERROR' } } }
      }
      return { result: { data: out.data } }
    })
    const body = isBatch ? results : results[0]
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
