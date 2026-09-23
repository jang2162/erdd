import { readConfig } from '../config.js'
import { emit } from '../output.js'
import { clientFor, run, type CommandCtx } from './context.js'
import { listLibraries, requireDictConnection } from './dict-shared.js'

export function dictList(ctx: CommandCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    const { projectId } = requireDictConnection(config)
    const rows = await listLibraries(await clientFor(ctx), projectId)
    const subscribed = new Set(config.dictionaries.map((d) => d.id))
    const human = rows.length === 0
      ? '이 프로젝트에서 보이는 라이브러리가 없습니다'
      : rows.map((r) => [
        subscribed.has(r.id) ? '*' : ' ',
        r.name,
        `— ${r.scope === 'global' ? '전역' : '조직'} · 항목 ${r.itemCount}${r.canWrite ? ' · 쓰기 가능' : ''} · ${r.id}`,
      ].join(' ')).join('\n')
    emit(ctx.json, human, rows.map((r) => ({ ...r, subscribed: subscribed.has(r.id) })))
    return 0
  })
}
