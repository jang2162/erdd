import { readBase, readConfig, requireConnection } from '../config.js'
import { CliError, emit, note } from '../output.js'
import { diffTrees, readTree } from '../tree.js'
import { clientFor, run, type CommandCtx } from './context.js'
import { syncDown } from './sync-down.js'

export function pull(ctx: CommandCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    const connection = requireConnection(config)
    const client = await clientFor(ctx)

    // 로컬 변경 확인 — base가 없으면 최초 pull이므로 묻지 않는다.
    const base = await readBase(ctx.cwd)
    if (base !== null && !ctx.yes) {
      const changes = diffTrees(base, await readTree(ctx.cwd))
      const touched = [...changes.added, ...changes.modified, ...changes.deleted]
      if (touched.length > 0) {
        note(`로컬 변경 ${touched.length}건이 덮어쓰기 됩니다:`)
        for (const f of touched) note(`  ${f}`)
        const ok = ctx.confirm === undefined ? false : await ctx.confirm('계속할까요?')
        if (!ok) throw new CliError('CANCELLED', '사용자가 취소했습니다')
      }
    }

    const r = await syncDown(ctx.cwd, connection, client)
    emit(
      ctx.json,
      `${r.projectName}: 테이블 ${Object.keys(r.model.tables).length}개를 받았습니다 (리비전 ${r.seq})`,
      {
        revisionSeq: r.seq, written: r.written.length, deleted: r.deleted.length,
        tables: Object.keys(r.model.tables).length, warnings: r.issues,
      },
    )
    return 0
  })
}
