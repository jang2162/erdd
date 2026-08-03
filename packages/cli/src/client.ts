import { CliError, type CliErrorCode } from './output.js'

export type ApiClient = { query<T>(path: string, input: unknown): Promise<T> }

const CODE_MAP: Record<string, CliErrorCode> = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  // zod 입력 검증 실패. allowlist 5개 중 3개가 uuid를 검증하므로 실제로 도달한다.
  BAD_REQUEST: 'VALIDATION',
}

export function createClient(serverUrl: string, token: string | null): ApiClient {
  const base = serverUrl.replace(/\/+$/, '')
  return {
    async query<T>(path: string, input: unknown): Promise<T> {
      if (token === null) {
        throw new CliError('UNAUTHORIZED', '토큰이 없습니다. ERDD_TOKEN을 설정하거나 erdd init을 실행하세요')
      }
      const url = `${base}/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`
      let res: Response
      try {
        res = await fetch(url, { headers: { authorization: `Bearer ${token}` } })
      } catch (err) {
        throw new CliError('NETWORK', `${base}에 연결하지 못했습니다: ${(err as Error).message}`)
      }
      let body: unknown
      try {
        body = await res.json()
      } catch {
        throw new CliError('NETWORK', `서버 응답을 해석하지 못했습니다 (HTTP ${res.status})`)
      }
      const rec = body as { result?: { data?: T }; error?: { message?: string; data?: { code?: string } } }
      if (rec.error !== undefined) {
        const serverCode = rec.error.data?.code ?? ''
        throw new CliError(CODE_MAP[serverCode] ?? 'NETWORK', rec.error.message ?? `서버 오류 (HTTP ${res.status})`)
      }
      if (!res.ok) throw new CliError('NETWORK', `서버 오류 (HTTP ${res.status})`)
      // 200인데 result 키가 아예 없으면 ERDD 서버가 아닌 무언가가 응답한 것이다.
      // 여기서 막지 않으면 호출자가 undefined를 역참조해 CliError 밖의 TypeError가 샌다.
      if (rec.result === undefined) {
        throw new CliError(
          'NETWORK',
          `서버 응답에 result가 없습니다 (HTTP ${res.status}) — serverUrl이 ERDD 서버를 가리키는지 확인하세요`,
        )
      }
      return rec.result.data as T
    },
  }
}
