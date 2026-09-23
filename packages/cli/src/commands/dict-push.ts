import {
  MAX_OPS_PER_MUTATION, RESOURCE_KIND_LABEL, planPromote,
  type ProjectModel, type PromoteEntry, type ResourceKind,
} from '@erdd/core'
import { readBase, readConfig } from '../config.js'
import { CliError, emit, note } from '../output.js'
import { diffTrees, readTree } from '../tree.js'
import { clientFor, run, type CommandCtx } from './context.js'
import { fetchItems, guardFeature, listLibraries, requireDictConnection, resolveLibrary } from './dict-shared.js'
import { syncDown } from './sync-down.js'

export type DictPushCtx = CommandCtx & {
  library?: string
  kinds?: ResourceKind[]
  names?: string[]
  includeNameMatch: boolean
  message?: string
}

type PromoteResult = {
  seq: number; inserted: number; updated: number
  skipped: { entityId: string; reason: 'missing' | 'plan-changed' }[]
}

const STATUS_MARK = { new: '+', update: '~', 'name-match': '=' } as const

/**
 * 승격 대상은 **서버 프로젝트의 엔티티**다. 로컬에서 고친 값이 서버에 없으면 보던 값이 아니라
 * 보관함의 옛 값이 라이브러리에 올라간다 — 그래서 로컬 변경이 없을 것을 요구한다.
 * 자동 push 를 하지 않는 이유: push 의 삭제 확인·충돌 중단이 끌려와 두 명령의 실패 모드가 섞인다.
 */
async function requireClean(cwd: string): Promise<void> {
  const base = await readBase(cwd)
  if (base === null) throw new CliError('VALIDATION', '기준 시점이 없습니다. 먼저 erdd pull을 실행하세요')
  const d = diffTrees(base, await readTree(cwd))
  if (d.added.length + d.modified.length + d.deleted.length > 0) {
    throw new CliError('VALIDATION', 'push 하지 않은 로컬 변경이 있습니다. erdd push 로 보관함을 먼저 갱신하세요')
  }
}

export function dictPush(ctx: DictPushCtx): Promise<number> {
  return run(ctx, async () => {
    if (ctx.library === undefined) throw new CliError('USAGE', '--library <이름|id> 가 필요합니다')
    const config = await readConfig(ctx.cwd)
    const connection = requireDictConnection(config)
    await requireClean(ctx.cwd)
    const client = await clientFor(ctx)
    const lib = resolveLibrary(await listLibraries(client, connection.projectId), ctx.library)
    const { model } = await client.query<{ model: ProjectModel; seq: number }>('model.get', { projectId: connection.projectId })
    // 서버가 다시 계산할 계획과 같아야 한다 — 서버 순서 그대로(`fetchItems` 참조).
    const plan = planPromote(model, lib.id, await fetchItems(client, lib.id, { order: 'server' }))

    const nameMatches = plan.entries.filter((e) => e.status === 'name-match')
    const selected = plan.entries.filter((e: PromoteEntry) =>
      (e.status !== 'name-match' || ctx.includeNameMatch)
      && (ctx.kinds === undefined || ctx.kinds.includes(e.kind))
      && (ctx.names === undefined || ctx.names.includes(e.name)))

    if (selected.length === 0) {
      emit(ctx.json, '올릴 항목이 없습니다', { libraryId: lib.id, selected: 0 })
      return 0
    }
    if (selected.length > MAX_OPS_PER_MUTATION) {
      throw new CliError('VALIDATION', `항목이 ${selected.length}건으로 한 번에 올릴 수 있는 ${MAX_OPS_PER_MUTATION}건을 넘습니다 — --kind·--name 으로 나누세요`)
    }

    const count = (s: PromoteEntry['status']) => selected.filter((e) => e.status === s).length
    note(`신규 추가 ${count('new')} · 원본 갱신 ${count('update')} · 동명 발견 ${ctx.includeNameMatch ? count('name-match') : `${nameMatches.length}(제외 — --include-name-match)`}`)
    for (const e of selected) note(`  ${STATUS_MARK[e.status]} ${RESOURCE_KIND_LABEL[e.kind]} ${e.name}`)
    if (!ctx.yes) {
      if (ctx.confirm === undefined) {
        throw new CliError('CANCELLED', '확인이 필요한 변경입니다 — 비대화형(--json)에서는 --yes를 함께 주세요')
      }
      if (!await ctx.confirm('계속할까요?')) throw new CliError('CANCELLED', '사용자가 취소했습니다')
    }

    if (!lib.canWrite) {
      const r = await guardFeature(() => client.mutate<{ id: string; requested: number; dropped: string[] }>(
        'promotion.create',
        { projectId: connection.projectId, libraryId: lib.id, entityIds: selected.map((e) => e.entityId), note: ctx.message ?? '' },
      ))
      emit(ctx.json, `승격 요청을 만들었습니다 (${r.requested}건). 조직 관리자가 웹에서 승인하면 반영됩니다`, { mode: 'request', ...r })
      return 0
    }

    const r = await guardFeature(() => client.mutate<PromoteResult>('resource.promote', {
      projectId: connection.projectId, libraryId: lib.id,
      entries: selected.map((e) => ({
        entityId: e.entityId, expectedStatus: e.status,
        expectedTargetItemId: e.targetItemId, expectedTargetVersion: e.targetVersion,
      })),
    }))
    const skippedLines = r.skipped.map((s) => {
      const e = selected.find((x) => x.entityId === s.entityId)
      return `  건너뜀 ${e === undefined ? s.entityId : `${RESOURCE_KIND_LABEL[e.kind]} ${e.name}`} (${s.reason === 'missing' ? '대상이 사라짐' : '그 사이 계획이 바뀜'})`
    })
    if (r.inserted + r.updated === 0) {
      emit(ctx.json, ['승격된 항목이 없습니다 — 전부 건너뛰었습니다', ...skippedLines].join('\n'), { mode: 'promote', ...r })
      return 1
    }
    // 서버가 엔티티 origin 을 바꿨다 — 받아 온다. requireClean 을 지났으므로 덮을 로컬 변경이 없다.
    await syncDown(ctx.cwd, connection, client)
    emit(ctx.json, [`승격했습니다 — 신규 ${r.inserted} · 갱신 ${r.updated}`, ...skippedLines].join('\n'), { mode: 'promote', ...r })
    return 0
  })
}
