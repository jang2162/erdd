import { readBase, readConfig, readSync } from '../config.js'
import { emit } from '../output.js'
import { diffTrees, readTree } from '../tree.js'
import { run, type CommandCtx } from './context.js'

export function status(ctx: CommandCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    const sync = await readSync(ctx.cwd)
    const base = await readBase(ctx.cwd)
    const changes = base === null
      ? { added: [], modified: [], deleted: [] }
      : diffTrees(base, await readTree(ctx.cwd))
    const total = changes.added.length + changes.modified.length + changes.deleted.length

    const human = [
      config.serverUrl === null ? '서버   (로컬 전용 — 연결 설정 없음)' : `서버   ${config.serverUrl}`,
      config.projectId === null ? '프로젝트 (로컬 전용)' : `프로젝트 ${config.projectId}`,
      sync === null ? '아직 pull하지 않았습니다' : `마지막 pull 리비전 ${sync.revisionSeq} (${sync.pulledAt})`,
      total === 0 ? '로컬 변경 없음' : `로컬 변경 ${total}건`,
      ...changes.added.map((f) => `  + ${f}`),
      ...changes.modified.map((f) => `  M ${f}`),
      ...changes.deleted.map((f) => `  - ${f}`),
    ].join('\n')

    emit(ctx.json, human, {
      serverUrl: config.serverUrl,
      projectId: config.projectId,
      revisionSeq: sync?.revisionSeq ?? null,
      pulledAt: sync?.pulledAt ?? null,
      changes,
    })
    return 0
  })
}
