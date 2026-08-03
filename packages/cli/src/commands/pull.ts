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
    // 네 쓰기는 원자적이지 않다. 중간에 중단되면(Ctrl+C 등) base가 트리보다 오래된 상태로
    // 남고, 다음 status가 사용자가 손대지 않은 파일을 "로컬 변경"으로 오탐한다.
    // 순서를 뒤집으면(base 먼저) base가 트리보다 새로워져 status가 "변경 없음"이라 말하며
    // 반쯤 낡은 트리를 숨긴다 — 그쪽이 더 나쁘다. 시끄럽게 틀리는 쪽을 의도적으로 고른다.
    // pull --yes 재실행으로 수렴한다. 진짜 원자성(임시 디렉터리 + rename)은 후속 과제.
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
