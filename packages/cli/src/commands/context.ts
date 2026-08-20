import { createClient, type ApiClient } from '../client.js'
import { readConfig, requireConnection, resolveToken } from '../config.js'
import { CliError, emitError, exitCodeFor } from '../output.js'

export type CommandCtx = {
  cwd: string
  json: boolean
  yes: boolean
  strict: boolean
  /** 테스트가 주입한다. 없으면 config와 토큰으로 만든다. */
  client?: ApiClient
  confirm?: (question: string) => Promise<boolean>
}

export async function clientFor(ctx: CommandCtx): Promise<ApiClient> {
  if (ctx.client !== undefined) return ctx.client
  const config = await readConfig(ctx.cwd)
  const { serverUrl } = requireConnection(config)
  return createClient(serverUrl, await resolveToken(ctx.cwd))
}

export async function run(ctx: CommandCtx, body: () => Promise<number>): Promise<number> {
  try {
    return await body()
  } catch (err) {
    if (err instanceof CliError) {
      emitError(ctx.json, err)
      return exitCodeFor(err.code)
    }
    emitError(ctx.json, new CliError('NETWORK', (err as Error).message))
    return 1
  }
}
