import { modelToFiles, type Dialect, type NamingRules, type ProjectModel } from '@erdd/core'
import { readBase, readConfig, writeBase, writeConfig, writeSync } from '../config.js'
import { CliError, emit, note } from '../output.js'
import { diffTrees, readTree, writeTree } from '../tree.js'
import { clientFor, run, type CommandCtx } from './context.js'

export function pull(ctx: CommandCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    const client = await clientFor(ctx)

    const project = await client.query<{
      name: string; dialects: Dialect[]; namingRules: NamingRules
    }>('project.get', { projectId: config.projectId })
    const { model, seq } = await client.query<{ model: ProjectModel; seq: number }>(
      'model.get', { projectId: config.projectId },
    )

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

    const { tree, issues } = modelToFiles(model)
    const { written, deleted } = await writeTree(ctx.cwd, tree)
    await writeBase(ctx.cwd, tree)
    await writeSync(ctx.cwd, { revisionSeq: seq, pulledAt: new Date().toISOString() })
    // 서버가 진실 원천이다 — 방언·명명 규칙을 매 pull마다 갱신한다.
    await writeConfig(ctx.cwd, {
      ...config, dialects: project.dialects, namingRules: project.namingRules,
    })

    emit(
      ctx.json,
      `${project.name}: 테이블 ${Object.keys(model.tables).length}개를 받았습니다 (리비전 ${seq})`,
      {
        revisionSeq: seq, written: written.length, deleted: deleted.length,
        tables: Object.keys(model.tables).length, warnings: issues,
      },
    )
    return 0
  })
}
