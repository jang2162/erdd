import { libraryItemsOf } from '@erdd/core'
import { readConfig } from '../config.js'
import { emit } from '../output.js'
import { clientFor, run, type CommandCtx } from './context.js'
import { readDistributionFile } from './dict-file.js'
import { listLibraries, requireDictConnection } from './dict-shared.js'

export function dictList(ctx: CommandCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    const connected = config.serverUrl !== null && config.projectId !== null
    const fileSubs = config.dictionaries.filter((d) => d.file !== undefined)
    if (!connected && fileSubs.length === 0) requireDictConnection(config)   // 기존 문구로 멈춘다
    const rows = connected ? await listLibraries(await clientFor(ctx), config.projectId!) : []
    const subscribed = new Set(config.dictionaries.filter((d) => d.file === undefined).map((d) => d.id))
    const lines = rows.map((r) => [
      subscribed.has(r.id) ? '*' : ' ', r.name,
      `— ${r.scope === 'global' ? '전역' : '조직'} · 항목 ${r.itemCount}${r.canWrite ? ' · 쓰기 가능' : ''} · ${r.id}`,
    ].join(' '))
    const fileRows = []
    for (const d of fileSubs) {
      try {
        const doc = await readDistributionFile(ctx.cwd, d.file!)
        const count = libraryItemsOf(doc).length
        lines.push(`* ${doc.library.name} — 파일 · 항목 ${count} · 읽기 전용 · ${d.file}`)
        fileRows.push({ id: d.id, name: doc.library.name, source: 'file', file: d.file, itemCount: count, subscribed: true, error: null })
      } catch (err) {
        lines.push(`* ${d.name} — 파일 · 읽지 못함(${(err as Error).message.split('\n')[0]}) · ${d.file}`)
        fileRows.push({ id: d.id, name: d.name, source: 'file', file: d.file, itemCount: null, subscribed: true, error: (err as Error).message })
      }
    }
    const human = lines.length === 0 ? '이 프로젝트에서 보이는 라이브러리가 없습니다' : lines.join('\n')
    emit(ctx.json, human, [
      ...rows.map((r) => ({ ...r, source: 'server', subscribed: subscribed.has(r.id) })), ...fileRows,
    ])
    return 0
  })
}
