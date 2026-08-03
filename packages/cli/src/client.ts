import { CliError, type CliErrorCode } from './output.js'

export type ApiClient = { query<T>(path: string, input: unknown): Promise<T> }

const CODE_MAP: Record<string, CliErrorCode> = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
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
      return rec.result?.data as T
    },
  }
}
