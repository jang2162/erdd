import { uuidv7 } from 'uuidv7'
import {
  ORIGINS_FILE, RESOURCE_KIND_LABEL, applyResyncPlan, modelToFiles, planAdoption, planResync,
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
  /**
   * 이름 중복이고 연결할 대상도 있지만 내용이 달라 연결하지 않는 항목(`fields` 는 다른 payload 키).
   * `--adopt --conflicts ours` 여야 연결된다 — 로컬 값 유지에 명시적으로 동의한 경우다.
   */
  adoptDiffers: (Named & { fields: string[] })[]
  /** 이름 중복인데 연결할 수 없는 항목 — 같은 이름 항목을 다른 원본이 차지했거나(이미 연결·선착에 밀림) 커스텀 항목의 target 이 다르다. */
  unlinkable: Named[]
  conflicts: (Named & { fields: string[]; decision: ResyncDecision })[]
  kept: number
  /** 이 라이브러리에서 왔으나 원본이 사라진 로컬 항목 수 — 지우지 않고 남겨 둔다. */
  detached: number
}

/**
 * 웹 「가져오기」의 기본 선택과 같다 — 설계 3.2. 이름 중복 항목은 일단 모두 `adopt` 로 두고
 * core `planAdoption` 으로 배정한다. 배정되지 않았거나 `--adopt` 가 없으면 `defer` 로 내린다 —
 * 남은 adopt 는 `applyResyncPlan` 이 같은 대상에 배정하므로 보고가 실제 적용과 갈라지지 않는다.
 *
 * **내용이 같은 항목만 연결한다**(`--conflicts ours` 는 예외). 내용이 다른 채 연결하면 다음
 * `dict push` 가 그 항목을 원본 갱신으로 기본 선택해, 사용자가 본 적 없는 라이브러리 값을 로컬
 * 값으로 덮는다(shared-resources 「승격」의 「보고 나서 덮어쓴다」). `ours` 는 로컬 값 유지에 명시적으로
 * 동의한 것이라 그 결과가 의도다. `theirs` 는 이 갈래에서 연결하지 않는다.
 */
function decide(model: ProjectModel, plan: ResyncPlan, ctx: DictPullCtx): {
  decisions: Record<string, ResyncDecision>
  linkable: ReadonlyMap<string, string>
  differs: ReadonlyMap<string, string[]>
} {
  const decisions: Record<string, ResyncDecision> = {}
  for (const e of plan.entries) {
    if (e.status === 'added') decisions[e.sourceId] = e.nameClash ? 'adopt' : 'apply'
    else if (e.status === 'auto-update') decisions[e.sourceId] = 'apply'
    else decisions[e.sourceId] = ctx.conflicts === 'theirs' ? 'apply' : ctx.conflicts === 'ours' ? 'keep' : 'defer'
  }
  const { assigned: linkable, differs } =
    planAdoption(model, plan, decisions, { sameContentOnly: ctx.conflicts !== 'ours' })
  for (const e of plan.entries) {
    if (decisions[e.sourceId] === 'adopt' && !(ctx.adopt && linkable.has(e.sourceId))) decisions[e.sourceId] = 'defer'
  }
  return { decisions, linkable, differs }
}

function report(
  lib: LibraryRow, plan: ResyncPlan, decisions: Record<string, ResyncDecision>,
  linkable: ReadonlyMap<string, string>, differs: ReadonlyMap<string, string[]>,
): LibraryReport {
  const named = (e: ResyncEntry): Named => ({ kind: RESOURCE_KIND_LABEL[e.kind], name: e.name })
  const clashDeferred = plan.entries.filter((e) => e.status === 'added' && e.nameClash && decisions[e.sourceId] === 'defer')
  return {
    id: lib.id, name: lib.name, scope: lib.scope, missing: false,
    added: plan.entries.filter((e) => e.status === 'added' && decisions[e.sourceId] === 'apply').length,
    autoUpdated: plan.entries.filter((e) => e.status === 'auto-update').length,
    adopted: plan.entries.filter((e) => decisions[e.sourceId] === 'adopt').length,
    nameClashSkipped: clashDeferred.filter((e) => linkable.has(e.sourceId)).map(named),
    adoptDiffers: clashDeferred.filter((e) => differs.has(e.sourceId))
      .map((e) => ({ ...named(e), fields: differs.get(e.sourceId)! })),
    unlinkable: clashDeferred.filter((e) => !linkable.has(e.sourceId) && !differs.has(e.sourceId)).map(named),
    conflicts: plan.entries.filter((e) => e.status === 'conflict')
      .map((e) => ({ ...named(e), fields: e.changedFields, decision: decisions[e.sourceId]! })),
    kept: plan.keptSynced,
    detached: plan.keptDetached,
  }
}

function pick(tree: FileTree, files: readonly string[]): FileTree {
  return Object.fromEntries(files.filter((p) => p in tree).map((p) => [p, tree[p]]))
}

/** 사전 파일만 — 테이블·그룹 파일은 재동기화와 무관하다(`DICTIONARY_FILES` 참조). */
const CONTENT_FILES = DICTIONARY_FILES.filter((p) => p !== ORIGINS_FILE)

/**
 * 사전 내용 파일을 먼저, `ORIGINS_FILE` 을 **마지막**에 쓴다. 파일 여럿의 쓰기는 원자적이지 않다 —
 * 출처를 먼저 쓰고 내용 전에 끊기면 출처는 새 버전·내용은 옛 값이 되어 다음 pull 이 「버전이 같다」로
 * **조용히** 넘기고, 로컬은 영원히 「프로젝트가 고친 항목」으로 남는다. 출처가 마지막이면 끊겨도
 * 옛 출처 대비 내용이 달라 다음 pull 이 충돌로 **시끄럽게** 알린다(`pull` 의 쓰기 순서와 같은 방향).
 */
async function writeDictionaryFiles(
  cwd: string, base: FileTree, next: FileTree,
): Promise<{ written: string[]; deleted: string[] }> {
  const content = await writeTreeChanges(cwd, pick(base, CONTENT_FILES), pick(next, CONTENT_FILES))
  const origins = await writeTreeChanges(cwd, pick(base, [ORIGINS_FILE]), pick(next, [ORIGINS_FILE]))
  // 보고는 쓰기 순서와 무관하게 정렬해 둔다 — 출력이 흔들리지 않게.
  return {
    written: [...content.written, ...origins.written].sort(),
    deleted: [...content.deleted, ...origins.deleted].sort(),
  }
}

function render(reports: LibraryReport[], files: { written: string[]; deleted: string[] }, dryRun: boolean): string {
  const lines: string[] = []
  for (const r of reports) {
    if (r.missing) { lines.push(`${r.name} — 찾을 수 없어 건너뛰었습니다`); continue }
    lines.push(`${r.name} (${r.scope === 'global' ? '전역' : '조직'})`)
    lines.push(`  추가 ${r.added} · 자동 갱신 ${r.autoUpdated} · 연결 ${r.adopted} · 유지 ${r.kept}`)
    if (r.conflicts.length > 0) {
      // 한 실행의 충돌은 모두 같은 결정이다(--conflicts 하나가 정한다).
      const decision = r.conflicts[0]!.decision
      const what = decision === 'apply' ? '원본 반영' : decision === 'keep' ? '로컬 유지'
        : '보류(--conflicts theirs|ours 로 정리)'
      lines.push(`  충돌 ${r.conflicts.length} — ${what}:`)
      for (const c of r.conflicts) lines.push(`    ${c.kind} ${c.name}  (${c.fields.join(', ')})`)
    }
    if (r.nameClashSkipped.length > 0) {
      lines.push(`  이름 중복 ${r.nameClashSkipped.length} — 건너뜀 (--adopt 로 연결)`)
    }
    if (r.adoptDiffers.length > 0) {
      lines.push(`  이름 중복 ${r.adoptDiffers.length} — 내용이 달라 연결하지 않음 (--adopt --conflicts ours 로 로컬 값을 유지한 채 연결)`)
      for (const d of r.adoptDiffers) lines.push(`    ${d.kind} ${d.name}  (${d.fields.join(', ')})`)
    }
    if (r.unlinkable.length > 0) {
      lines.push(`  이름 중복 ${r.unlinkable.length} — 연결할 수 없음 (같은 이름 항목을 다른 원본이 차지했거나 커스텀 항목의 적용 대상이 다릅니다)`)
    }
    if (r.detached > 0) lines.push(`  원본에서 사라짐 ${r.detached} (로컬에 남겨 둠)`)
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
          nameClashSkipped: [], adoptDiffers: [], unlinkable: [], conflicts: [], kept: 0, detached: 0,
        })
        continue
      }
      const plan = planResync(model, lib.id, await fetchItems(client, lib.id))
      const { decisions, linkable, differs } = decide(model, plan, ctx)
      reports.push(report(lib, plan, decisions, linkable, differs))
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
      files = await writeDictionaryFiles(ctx.cwd, tree, modelToFiles(model).tree)
      if (JSON.stringify(subscriptions) !== JSON.stringify(config.dictionaries)) {
        await writeConfig(ctx.cwd, { ...config, dictionaries: subscriptions })
      }
    }
    emit(ctx.json, render(reports, files, ctx.dryRun), { libraries: reports, ...files, dryRun: ctx.dryRun })
    return 0
  })
}
