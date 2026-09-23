import {
  MAX_OPS_PER_MUTATION, RESOURCE_KIND_LABEL, planPromote,
  type FileTree, type ProjectModel, type PromoteEntry, type ResourceKind,
} from '@erdd/core'
import { readBase, readConfig, readSync } from '../config.js'
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
  if (!await isClean(cwd, base)) {
    throw new CliError('VALIDATION', 'push 하지 않은 로컬 변경이 있습니다. erdd push 로 보관함을 먼저 갱신하세요')
  }
}

async function isClean(cwd: string, base: FileTree | null): Promise<boolean> {
  if (base === null) return false
  const d = diffTrees(base, await readTree(cwd))
  return d.added.length + d.modified.length + d.deleted.length === 0
}

/** 바뀐 필드 — 갱신·동명 행에서 무엇이 올라가는지 보이게 한다(신규는 비어 있다). */
const fieldsOf = (e: PromoteEntry) => (e.changedFields.length > 0 ? `  (${e.changedFields.join(', ')})` : '')

export function dictPush(ctx: DictPushCtx): Promise<number> {
  return run(ctx, async () => {
    if (ctx.library === undefined) throw new CliError('USAGE', '--library <이름|id> 가 필요합니다')
    const config = await readConfig(ctx.cwd)
    const connection = requireDictConnection(config)
    await requireClean(ctx.cwd)
    const client = await clientFor(ctx)
    const lib = resolveLibrary(await listLibraries(client, connection.projectId), ctx.library)
    // 서버도 거절하지만(promotion.create) CLI 가 이미 아는 사실이다 — 계획을 보이고 확인받은 뒤에
    // 거절하면 헛 확인이 된다.
    if (lib.scope === 'global' && !lib.canWrite) {
      throw new CliError('VALIDATION', '전역 라이브러리로는 승격을 요청할 수 없습니다 — 서비스 관리자만 전역 라이브러리에 올릴 수 있습니다')
    }
    const { model, seq } = await client.query<{ model: ProjectModel; seq: number }>('model.get', { projectId: connection.projectId })
    // 로컬이 깨끗해도 서버가 마지막 pull 이후 앞서 나갔으면 올라가는 것은 보던 값이 아니라 남의 새
    // 값이다. 로컬이 깨끗하므로 pull 은 무해하다 — 받은 뒤 다시 보게 한다.
    if (seq !== (await readSync(ctx.cwd))?.revisionSeq) {
      throw new CliError('VALIDATION', '서버가 마지막 pull 이후 앞서 나갔습니다 — erdd pull 로 받은 뒤 다시 실행하세요')
    }
    // 서버가 다시 계산할 계획과 같아야 한다 — 서버 순서 그대로(`fetchItems` 참조).
    const plan = planPromote(model, lib.id, await fetchItems(client, lib.id, { order: 'server' }))

    const filtered = plan.entries.filter((e: PromoteEntry) =>
      (ctx.kinds === undefined || ctx.kinds.includes(e.kind))
      && (ctx.names === undefined || ctx.names.includes(e.name)))
    // 원본이 마지막 dict pull 이후 앞선 항목은 `--name` 으로 콕 집어도 뺀다 — 올리면 남이 고친 값이
    // 이 프로젝트의 옛 값으로 되돌아가고, 서버의 expectedTargetVersion 은 계획 이후의 변경만 막는다.
    // 덮어쓰려면 dict pull 로 충돌을 정리한다(--conflicts ours 가 origin 을 올려 다음 push 에서 update 가 된다).
    const behind = filtered.filter((e) => e.sourceBehind)
    const eligible = filtered.filter((e) => !e.sourceBehind)
    const nameMatches = eligible.filter((e) => e.status === 'name-match')
    const selected = eligible.filter((e) => e.status !== 'name-match' || ctx.includeNameMatch)
    const behindJson = behind.map((e) => ({ kind: e.kind, name: e.name, entityId: e.entityId }))
    const noteBehind = () => {
      if (behind.length === 0) return
      note(`라이브러리 원본이 마지막 dict pull 이후 바뀐 항목 ${behind.length}건은 제외했습니다 — erdd dict pull 로 먼저 받으세요`)
      for (const e of behind) note(`  ${STATUS_MARK[e.status]} ${RESOURCE_KIND_LABEL[e.kind]} ${e.name}${fieldsOf(e)}`)
    }

    if (selected.length === 0) {
      // 오타·제외된 동명을 「할 일 없음」과 구분해 알린다 — 종료 코드는 0 그대로다.
      const unmatched = (ctx.names ?? []).filter((n) => !plan.entries.some((e) => e.name === n))
      if (unmatched.length > 0) note(`--name 에 맞는 항목이 없습니다: ${unmatched.join(', ')}`)
      if (nameMatches.length > 0) note(`동명 발견 ${nameMatches.length}건은 제외했습니다 — 올리려면 --include-name-match`)
      noteBehind()
      emit(ctx.json, '올릴 항목이 없습니다', { libraryId: lib.id, selected: 0, behind: behindJson })
      return 0
    }
    if (selected.length > MAX_OPS_PER_MUTATION) {
      throw new CliError('VALIDATION', `항목이 ${selected.length}건으로 한 번에 올릴 수 있는 ${MAX_OPS_PER_MUTATION}건을 넘습니다 — --kind·--name 으로 나누세요`)
    }

    const count = (s: PromoteEntry['status']) => selected.filter((e) => e.status === s).length
    note(`신규 추가 ${count('new')} · 원본 갱신 ${count('update')} · 동명 발견 ${ctx.includeNameMatch ? count('name-match') : `${nameMatches.length}(제외 — --include-name-match)`}`)
    for (const e of selected) note(`  ${STATUS_MARK[e.status]} ${RESOURCE_KIND_LABEL[e.kind]} ${e.name}${fieldsOf(e)}`)
    noteBehind()
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
      emit(ctx.json, [
        `승격 요청을 만들었습니다 (${r.requested}건). 조직 관리자가 웹에서 승인하면 반영됩니다`,
        // 계획을 계산한 뒤 요청 사이에 엔티티가 지워지면 서버가 걸러 낸다 — 조용히 줄지 않게.
        ...(r.dropped.length > 0 ? [`(${r.dropped.length}건은 그 사이 사라져 빠졌습니다)`] : []),
      ].join('\n'), { mode: 'request', ...r, behind: behindJson })
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
      emit(ctx.json, ['승격된 항목이 없습니다 — 전부 건너뛰었습니다', ...skippedLines].join('\n'), { mode: 'promote', ok: false, ...r, behind: behindJson })
      return 1
    }
    const done = `승격했습니다 — 신규 ${r.inserted} · 갱신 ${r.updated}`
    // 여기부터는 서버가 이미 커밋한 뒤다 — 실패해도 재시도하지 않고 「승격은 됐다」를 분명히 구분해
    // 알린다(push.ts 와 같은 규약 — 승격 실패로 보이면 사람도 에이전트도 다시 올리려 든다).
    try {
      // 확인 프롬프트는 무기한 기다린다 — 그 사이 사용자가 파일을 고쳤으면 syncDown 이 조용히 덮는다.
      // 앞의 requireClean 은 호출 시점 기준이라 한 번 더 본다.
      if (!await isClean(ctx.cwd, await readBase(ctx.cwd))) {
        throw new CliError('VALIDATION', '확인하는 사이 로컬 파일이 바뀌어 덮어쓰지 않았습니다')
      }
      // 서버가 엔티티 origin 을 바꿨다 — 받아 온다.
      await syncDown(ctx.cwd, connection, client)
    } catch (err) {
      const detail = (err as Error).message
      emit(ctx.json,
        [`${done}. 파일 갱신에 실패했습니다 — erdd pull을 실행하세요 (${detail})`, ...skippedLines].join('\n'),
        { mode: 'promote', ok: false, committed: true, syncError: detail, ...r, behind: behindJson })
      return 1
    }
    emit(ctx.json, [done, ...skippedLines].join('\n'), { mode: 'promote', ok: true, ...r, behind: behindJson })
    return 0
  })
}
