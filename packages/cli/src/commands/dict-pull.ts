import { uuidv7 } from 'uuidv7'
import {
  RESOURCE_KIND_LABEL, adoptAssignments, applyResyncPlan, modelToFiles, planResync,
  type FileTree, type ProjectModel, type ResyncDecision, type ResyncEntry, type ResyncPlan,
} from '@erdd/core'
import { readConfig, writeConfig, type DictionaryRef } from '../config.js'
import { CliError, emit, note } from '../output.js'
import { writeTreeChanges } from '../tree.js'
import { clientFor, run, type CommandCtx } from './context.js'
import {
  DICTIONARY_FILES, fetchItems, listLibraries, readLocalModel, requireDictConnection, resolveLibrary,
  type LibraryRow,
} from './dict-shared.js'

export type DictPullCtx = CommandCtx & {
  library?: string
  adopt: boolean
  conflicts?: 'theirs' | 'ours'
  dryRun: boolean
}

type Named = { kind: string; name: string }

type LibraryReport = {
  id: string
  name: string
  scope: LibraryRow['scope'] | null
  missing: boolean
  added: number
  autoUpdated: number
  adopted: number
  /** 이름 중복인데 `--adopt` 면 연결되는 항목 — 기본으로 건너뛴다. */
  nameClashSkipped: Named[]
  /** 이름 중복인데 연결할 수 없는 항목 — 같은 이름 항목에 이미 출처가 있거나(선착에 밀림 포함) 커스텀 항목의 target 이 다르다. */
  unlinkable: Named[]
  conflicts: (Named & { fields: string[]; decision: ResyncDecision })[]
  kept: number
}

/**
 * 웹 「가져오기」의 기본 선택과 같다 — 설계 3.2. 이름 중복 항목은 일단 모두 `adopt` 로 두고
 * core `adoptAssignments` 로 배정한다 — 적용(`applyResyncPlan`)과 같은 함수라 보고가 실제와
 * 갈라지지 않는다. 배정되지 않았거나 `--adopt` 가 없으면 `defer` 로 내린다.
 */
function decide(model: ProjectModel, plan: ResyncPlan, ctx: DictPullCtx): {
  decisions: Record<string, ResyncDecision>
  linkable: ReadonlyMap<string, string>
} {
  const decisions: Record<string, ResyncDecision> = {}
  for (const e of plan.entries) {
    if (e.status === 'added') decisions[e.sourceId] = e.nameClash ? 'adopt' : 'apply'
    else if (e.status === 'auto-update') decisions[e.sourceId] = 'apply'
    else decisions[e.sourceId] = ctx.conflicts === 'theirs' ? 'apply' : ctx.conflicts === 'ours' ? 'keep' : 'defer'
  }
  const linkable = adoptAssignments(model, plan, decisions)
  for (const e of plan.entries) {
    if (decisions[e.sourceId] === 'adopt' && !(ctx.adopt && linkable.has(e.sourceId))) decisions[e.sourceId] = 'defer'
  }
  return { decisions, linkable }
}

function report(
  lib: LibraryRow, plan: ResyncPlan, decisions: Record<string, ResyncDecision>, linkable: ReadonlyMap<string, string>,
): LibraryReport {
  const named = (e: ResyncEntry): Named => ({ kind: RESOURCE_KIND_LABEL[e.kind], name: e.name })
  const clashDeferred = plan.entries.filter((e) => e.status === 'added' && e.nameClash && decisions[e.sourceId] === 'defer')
  return {
    id: lib.id, name: lib.name, scope: lib.scope, missing: false,
    added: plan.entries.filter((e) => e.status === 'added' && decisions[e.sourceId] === 'apply').length,
    autoUpdated: plan.entries.filter((e) => e.status === 'auto-update').length,
    adopted: plan.entries.filter((e) => decisions[e.sourceId] === 'adopt').length,
    nameClashSkipped: clashDeferred.filter((e) => linkable.has(e.sourceId)).map(named),
    unlinkable: clashDeferred.filter((e) => !linkable.has(e.sourceId)).map(named),
    conflicts: plan.entries.filter((e) => e.status === 'conflict')
      .map((e) => ({ ...named(e), fields: e.changedFields, decision: decisions[e.sourceId]! })),
    kept: plan.keptSynced,
  }
}

/** 사전 파일만 — 테이블·그룹 파일은 재동기화와 무관하다(`DICTIONARY_FILES` 참조). */
function pick(tree: FileTree): FileTree {
  return Object.fromEntries(DICTIONARY_FILES.filter((p) => p in tree).map((p) => [p, tree[p]]))
}

function render(reports: LibraryReport[], files: { written: string[]; deleted: string[] }, dryRun: boolean): string {
  const lines: string[] = []
  for (const r of reports) {
    if (r.missing) { lines.push(`${r.name} — 찾을 수 없어 건너뛰었습니다`); continue }
    lines.push(`${r.name} (${r.scope === 'global' ? '전역' : '조직'})`)
    lines.push(`  추가 ${r.added} · 자동 갱신 ${r.autoUpdated} · 연결 ${r.adopted} · 유지 ${r.kept}`)
    if (r.conflicts.length > 0) {
      const deferred = r.conflicts.some((c) => c.decision === 'defer')
      lines.push(`  충돌 ${r.conflicts.length}${deferred ? ' — 보류(--conflicts theirs|ours 로 정리)' : ''}:`)
      for (const c of r.conflicts) lines.push(`    ${c.kind} ${c.name}  (${c.fields.join(', ')})`)
    }
    if (r.nameClashSkipped.length > 0) {
      lines.push(`  이름 중복 ${r.nameClashSkipped.length} — 건너뜀 (--adopt 로 연결)`)
    }
    if (r.unlinkable.length > 0) {
      lines.push(`  이름 중복 ${r.unlinkable.length} — 연결할 수 없음 (같은 이름 항목에 이미 출처가 있거나 대상이 다릅니다)`)
    }
  }
  const changed = [...files.written, ...files.deleted]
  lines.push(dryRun ? '미리보기입니다 — 파일을 쓰지 않았습니다'
    : changed.length === 0 ? '바뀐 파일이 없습니다' : `반영했습니다 — ${changed.join(', ')}`)
  return lines.join('\n')
}

export function dictPull(ctx: DictPullCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    const { projectId } = requireDictConnection(config)
    const client = await clientFor(ctx)
    const { tree, model: initial } = await readLocalModel(ctx.cwd)
    const libraries = await listLibraries(client, projectId)

    let subscriptions: DictionaryRef[] = config.dictionaries
    let targets: DictionaryRef[]
    if (ctx.library !== undefined) {
      const lib = resolveLibrary(libraries, ctx.library)
      if (!subscriptions.some((s) => s.id === lib.id)) subscriptions = [...subscriptions, { id: lib.id, name: lib.name }]
      targets = [{ id: lib.id, name: lib.name }]
    } else {
      if (subscriptions.length === 0) {
        throw new CliError('USAGE', '구독한 라이브러리가 없습니다 — --library <이름|id> 로 지정하세요 (목록: erdd dict list)')
      }
      targets = subscriptions
    }

    let model = initial
    const reports: LibraryReport[] = []
    for (const target of targets) {
      const lib = libraries.find((l) => l.id === target.id)
      if (lib === undefined) {
        note(`경고: 라이브러리 ${target.name}(${target.id})을(를) 찾을 수 없어 건너뜁니다 — 삭제됐거나 권한이 없습니다`)
        reports.push({
          id: target.id, name: target.name, scope: null, missing: true, added: 0, autoUpdated: 0, adopted: 0,
          nameClashSkipped: [], unlinkable: [], conflicts: [], kept: 0,
        })
        continue
      }
      const plan = planResync(model, lib.id, await fetchItems(client, lib.id))
      const { decisions, linkable } = decide(model, plan, ctx)
      reports.push(report(lib, plan, decisions, linkable))
      model = applyResyncPlan(model, plan, decisions, uuidv7)
    }

    // 표시 이름은 서버를 따른다(개명 추종). 사라진 구독은 그대로 둔다 — 권한이 일시적으로 없을 수 있다.
    subscriptions = subscriptions.map((s) => {
      const lib = libraries.find((l) => l.id === s.id)
      return lib === undefined ? s : { id: s.id, name: lib.name }
    })

    let files = { written: [] as string[], deleted: [] as string[] }
    if (!ctx.dryRun) {
      // base 는 디스크에서 읽은 원본이다 — id 없는 로컬 항목에 준 새 id 는 next 쪽에만 있어 그 파일이 기록된다.
      files = await writeTreeChanges(ctx.cwd, pick(tree), pick(modelToFiles(model).tree))
      if (JSON.stringify(subscriptions) !== JSON.stringify(config.dictionaries)) {
        await writeConfig(ctx.cwd, { ...config, dictionaries: subscriptions })
      }
    }
    emit(ctx.json, render(reports, files, ctx.dryRun), { libraries: reports, ...files, dryRun: ctx.dryRun })
    return 0
  })
}
