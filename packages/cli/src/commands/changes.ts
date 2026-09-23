import { LOCAL_CHANGES_LOCAL_ONLY_MESSAGE, filesToModel, formatChangeIssue, type LocalChangesStatus } from '@erdd/core'
import { readConfig } from '../config.js'
import { UNSAVED_NOTICE, hasDraft } from '../local/draft.js'
import { CHANGES_DIR, loadChangesPlan, toLocalStatus, writeChange } from '../local/changes.js'
import { CliError, emit, note } from '../output.js'
import { readTree } from '../tree.js'
import { run, type CommandCtx } from './context.js'

export type ChangesCtx = CommandCtx & {
  sub: 'status' | 'new'
  name?: string
  baseline: boolean
  check: boolean
}

const UNSAVED_REFUSAL = '저장하지 않은 편집이 있습니다. 먼저 erdd serve 화면에서 저장한 뒤 변경 기록을 만드세요'

function humanStatus(s: LocalChangesStatus): string {
  const lines = [`변경 기록 ${s.records.length}건 (${CHANGES_DIR}/)`]
  for (const w of s.warnings) lines.push(`⚠️ 기록 간 경합 — ${formatChangeIssue(w)}`)
  if (s.error !== null) {
    lines.push(`오류: ${formatChangeIssue(s.error)}`)
  } else if (s.pending === null || s.pending.count === 0) {
    lines.push('미기록 변경 없음')
  } else {
    lines.push(
      `미기록 변경 ${s.pending.count}문장 — erdd changes new <이름> 으로 기록합니다`,
      '',
      ...s.pending.text.split('\n').map((l) => (l === '' ? '' : `  ${l}`)),
    )
  }
  if (s.unsaved) lines.push(UNSAVED_NOTICE)
  return lines.join('\n')
}

/**
 * `erdd changes` — 변경 기록 상태·생성(guide 「변경 기록 — `.erddc` 문법과 재생 규칙」).
 * 로컬 모드 전용이다. 보는 모델은 **디스크의 `erdd/`** 다(미저장 편집은 포함하지 않는다).
 */
export function changes(ctx: ChangesCtx): Promise<number> {
  return run(ctx, async () => {
    const config = await readConfig(ctx.cwd)
    if (config.serverUrl !== null || config.projectId !== null) throw new CliError('VALIDATION', LOCAL_CHANGES_LOCAL_ONLY_MESSAGE, { reason: 'local-only' })
    const unsaved = await hasDraft(ctx.cwd)
    const files = filesToModel(await readTree(ctx.cwd))
    if (!files.ok) {
      // validate·export 와 같은 봉투다 — 같은 파일 오류를 명령마다 다른 모양으로 말하지 않는다.
      emit(
        ctx.json,
        [`파싱 오류 ${files.issues.length}건`, ...files.issues.map((i) => `  ${i.path}: ${i.message}`)].join('\n'),
        { ok: false, parseErrors: files.issues, integrityIssues: [], warnings: [] },
      )
      return 1
    }
    const cctx = { cwd: ctx.cwd, model: files.model, config }

    if (ctx.sub === 'new') {
      if (unsaved) throw new CliError('VALIDATION', UNSAVED_REFUSAL, { reason: 'unsaved' })
      const r = await writeChange(cctx, { name: ctx.name ?? '', baseline: ctx.baseline })
      if (!r.ok) throw new CliError('VALIDATION', r.message, { reason: r.reason })
      emit(ctx.json, `기록했습니다: ${r.file} (문장 ${r.statementCount}개)`, r)
      return 0
    }

    const { plan } = await loadChangesPlan(cctx)
    const s = toLocalStatus(plan, unsaved)
    emit(ctx.json, humanStatus(s), s)
    if (s.error !== null) return 1
    if (ctx.check && s.pending !== null && s.pending.count > 0) {
      note('미기록 변경이 있습니다 — erdd changes new <이름> 으로 기록하세요')
      return 1
    }
    return 0
  })
}
