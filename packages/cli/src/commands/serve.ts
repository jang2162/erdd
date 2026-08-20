import { readConfig } from '../config.js'
import { CliError, note } from '../output.js'
import { run, type CommandCtx } from './context.js'

const DEFAULT_PORT = 4300

export function serve(ctx: CommandCtx): Promise<number> {
  return run(ctx, async () => {
    // config 가 없으면 여기서 NO_CONFIG 로 끝난다.
    await readConfig(ctx.cwd)
    const port = ctx.port ?? DEFAULT_PORT

    // 동적 import — serve 가 아닌 명령의 부팅에 Fastify 가 얹히지 않게 한다.
    const { startLocalServer } = await import('../local/server.js')

    let server
    try {
      server = await startLocalServer({ cwd: ctx.cwd, port })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        // 자동으로 다음 포트를 잡지 않는다 — 에이전트가 고정 포트를 가정한 채 남의 서버에
        // 붙는 것을 막는다.
        throw new CliError('VALIDATION', `포트 ${port}이 이미 사용 중입니다. --port로 다른 포트를 지정하세요`)
      }
      throw err
    }

    note(`${server.url} 에서 실행 중 (프로젝트: ${ctx.cwd})`)
    note('중지하려면 Ctrl+C')
    if (ctx.open !== false) await openBrowser(server.url)

    // 신호를 받을 때까지 돈다. 종료 전에 대기 중인 쓰기를 flush 한다.
    await new Promise<void>((resolve) => {
      const stop = () => { void server.close().then(resolve, resolve) }
      process.once('SIGINT', stop)
      process.once('SIGTERM', stop)
    })
    return 0
  })
}

/** 실패해도 서버는 계속 돈다 — 브라우저를 못 여는 것은 치명적이지 않다. */
export async function openBrowser(url: string): Promise<void> {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
      : 'xdg-open'
  try {
    const { spawn } = await import('node:child_process')
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true })
    // spawn() 자체의 동기 예외는 위 catch가 잡지만, 실행 파일이 PATH에 없는 경우(ENOENT 등)는
    // 비동기 'error' 이벤트로 온다 — 리스너가 없으면 리스너 없는 EventEmitter 특성상 uncaught
    // exception이 되어 서버 프로세스 전체가 죽는다. try/catch는 이 경로를 잡지 못한다.
    child.on('error', () => { note(`브라우저를 열지 못했습니다. 직접 ${url} 을 여세요`) })
    child.unref()
  } catch {
    note(`브라우저를 열지 못했습니다. 직접 ${url} 을 여세요`)
  }
}
