import { vi } from 'vitest'

type Handler = (input: unknown) => {
  data?: unknown
  error?: {
    code: number
    message: string
    /**
     * 서버가 오류 응답에 항상 싣는 종료성 표식(`trpc.ts`의 errorFormatter). 일회용 링크 화면이
     * 폼을 지우는 판정의 **유일한** 근거이므로 목도 이것을 재현해야 한다 — 코드만 보내고
     * 종료성을 기대하는 목은 실제 서버와 다른 것을 시험하게 된다. 생략하면 `false`다:
     * zod 입력 검증 실패·5xx처럼 링크가 살아 있는 오류가 기본값이다.
     */
    linkDead?: true
  }
  /**
   * 응답 대신 **fetch 자체를 거절시킨다** — 네트워크 단절·프록시 끊김처럼 요청이 서버에 닿았는지도
   * 알 수 없는 경우다. 브라우저가 내는 것과 같은 `TypeError('Failed to fetch')`로 거절한다.
   * tRPC는 이것을 `data`가 없는 `TRPCClientError`로 감싸므로, 오류 코드로 종료성을 판정하는
   * 화면(초대 수락·비밀번호 재설정)에서 "죽은 링크"와 갈라진다.
   */
  offline?: true
}

/**
 * JSON-RPC 코드 → tRPC 오류 키·HTTP 상태. **서버의 `getErrorShape`가 실제로 내는 표와 같다**
 * (2026-08-07 `@trpc/server` 11.18.0으로 실행해 확인: BAD_REQUEST → -32600/400,
 * CONFLICT → -32009/409, INTERNAL_SERVER_ERROR → -32603/500).
 * `data.code`를 고정 문자열로 두면 코드로 갈라지는 화면을 이 목으로 검증할 수 없다.
 */
const ERROR_CODES: Record<number, readonly [key: string, httpStatus: number]> = {
  [-32600]: ['BAD_REQUEST', 400],
  [-32603]: ['INTERNAL_SERVER_ERROR', 500],
  [-32001]: ['UNAUTHORIZED', 401],
  [-32003]: ['FORBIDDEN', 403],
  [-32004]: ['NOT_FOUND', 404],
  [-32009]: ['CONFLICT', 409],
  [-32012]: ['PRECONDITION_FAILED', 412],
  [-32029]: ['TOO_MANY_REQUESTS', 429],
}

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
    const shape = (code: number, message: string, linkDead = false) => {
      const [key, httpStatus] = ERROR_CODES[code] ?? ['INTERNAL_SERVER_ERROR', 500]
      return { error: { code, message, data: { code: key, httpStatus, linkDead } } }
    }
    const results = paths.map((path, i) => {
      const handler = handlers[path]
      if (!handler) return shape(-32004, `no handler: ${path}`)
      const out = handler(inputs[String(i)])
      // 배치 전체를 거절시킨다 — 실제 네트워크 단절도 응답 하나만 골라 잃지 않는다.
      if (out.offline) throw new TypeError('Failed to fetch')
      if (out.error) return shape(out.error.code, out.error.message, out.error.linkDead ?? false)
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
