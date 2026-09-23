import { deepEqual } from '../equal.js'
import { NEW_ID_PREFIX, isNewId } from '../file-format.js'
import type { ProjectModel } from '../model.js'
import { diffProjection } from './diff.js'
import { formatChangeset } from './format.js'
import { parseChangeset } from './parse.js'
import { projectSchema, type ProjectionSettings } from './projection.js'
import { replay, type ChangesetRecord } from './replay.js'
import {
  CHANGESET_FORMAT, compareCodeUnits,
  type ChangeIssue, type SchemaProjection, type Statement,
} from './types.js'

export const CHANGESET_EXT = '.erddc'

export type ChangesetSource = { file: string; text: string }
export type ChangeRecordSummary = {
  file: string; name: string; created: string; baseline: boolean; statementCount: number; text: string
}
export type ChangesPlan = {
  /** 재생 순서(오래된 것부터). */
  records: ChangeRecordSummary[]
  warnings: ChangeIssue[]
  error: ChangeIssue | null
  /** 오류가 있으면 null — 기준선을 모르는 채 차이를 내면 거짓 기록이다. */
  pending: Statement[] | null
  target: SchemaProjection | null
}
export type PlanInput = { sources: readonly ChangesetSource[]; model: ProjectModel; settings: ProjectionSettings }

/**
 * 변경 기록 상태: 기록 전부를 파싱·재생해 기준선을 얻고, 현재 모델의 투영과 비교한다.
 * 첫 오류에서 멈춘다(guide 「기록을 만들 수 없는 경우」).
 */
export function planChanges(input: PlanInput): ChangesPlan {
  const records: ChangeRecordSummary[] = []
  const parsed: ChangesetRecord[] = []
  const stop = (error: ChangeIssue, warnings: ChangeIssue[] = []): ChangesPlan =>
    ({ records, warnings, error, pending: null, target: null })

  for (const src of [...input.sources].sort((a, b) => compareCodeUnits(a.file, b.file))) {
    const r = parseChangeset(src.text)
    if (!r.ok) return stop({ file: src.file, line: r.line, message: r.message })
    parsed.push({ file: src.file, changeset: r.changeset })
    const h = r.changeset.header
    records.push({
      file: src.file, name: h.name, created: h.created, baseline: h.baseline,
      statementCount: r.changeset.statements.length, text: src.text,
    })
  }
  const replayed = replay(parsed)
  if (replayed.error !== null) return stop(replayed.error, replayed.warnings)

  const missing = firstMissingId(input.model)
  if (missing !== null) {
    return stop({ file: null, line: null, message: `id 가 없는 항목이 있습니다(${missing}) — erdd serve 로 열어 id 를 채운 뒤 다시 하세요` }, replayed.warnings)
  }
  const target = projectSchema(input.model, input.settings)
  const diff = diffProjection(replayed.projection, target)
  if (!diff.ok) return stop({ file: null, line: null, message: diff.message }, replayed.warnings)
  return { records, warnings: replayed.warnings, error: null, pending: diff.statements, target }
}

/** 파일에서 id 없이 새로 만든 항목은 `new:<경로>#<종류>[<순번>]` 임시 id 를 받는다 — 그 위치를 알린다. */
function firstMissingId(model: ProjectModel): string | null {
  for (const coll of [model.tables, model.columns, model.relationships, model.indexes]) {
    for (const id of Object.keys(coll)) if (isNewId(id)) return id.slice(NEW_ID_PREFIX.length)
  }
  return null
}

export type ComposeOptions = { name: string; created: string; baseline: boolean }
export type ComposeFailureReason = 'name' | 'invalid' | 'empty' | 'baseline'
export type ComposeResult =
  | { ok: true; text: string; statementCount: number }
  | { ok: false; reason: ComposeFailureReason; message: string }

/** 자기검증에서 새 기록이 기존 기록 전부 뒤에 재생되게 하는 파일명. */
const LAST_FILE = '￿'
const SELF_CHECK_MESSAGE =
  '내부 오류 — 기록을 재생한 결과가 현재 모델과 달라 기록을 만들지 않았습니다. 이 메시지와 함께 알려 주세요'

/**
 * 미기록 변경으로 새 기록 텍스트를 만든다. **쓰기 전에** 기존 기록 + 새 기록을 재생해 현재 투영과
 * 같은지 확인한다(guide 「생성 시 자기검증」) — 직렬화·파서·재생 버그가 저장소에 거짓 기록으로
 * 들어가는 것을 막는 유일한 안전망이다.
 */
export function composeChangeset(plan: ChangesPlan, input: PlanInput, opts: ComposeOptions): ComposeResult {
  const name = opts.name.trim()
  if (name === '') return { ok: false, reason: 'name', message: '변경 기록의 이름을 입력하세요' }
  if (plan.error !== null || plan.pending === null || plan.target === null) {
    return { ok: false, reason: 'invalid', message: plan.error?.message ?? '변경 기록 상태를 계산하지 못했습니다' }
  }
  if (plan.pending.length === 0) return { ok: false, reason: 'empty', message: '기록할 변경이 없습니다' }
  if (opts.baseline && input.sources.length > 0) {
    return { ok: false, reason: 'baseline', message: '--baseline 은 첫 변경 기록에만 쓸 수 있습니다 — 이미 기록이 있습니다' }
  }
  const text = formatChangeset({
    header: { format: CHANGESET_FORMAT, name, created: opts.created, baseline: opts.baseline },
    statements: plan.pending,
  })

  const again = parseChangeset(text)
  if (!again.ok) return { ok: false, reason: 'invalid', message: SELF_CHECK_MESSAGE }
  const records: ChangesetRecord[] = []
  for (const src of input.sources) {
    const r = parseChangeset(src.text)
    if (r.ok) records.push({ file: src.file, changeset: r.changeset })
  }
  records.push({ file: LAST_FILE, changeset: again.changeset })
  const check = replay(records)
  if (check.error !== null || !deepEqual(check.projection, plan.target)) {
    return { ok: false, reason: 'invalid', message: SELF_CHECK_MESSAGE }
  }
  return { ok: true, text, statementCount: plan.pending.length }
}

// ── 파일 이름 — guide 「파일 이름과 재생 순서」 ──

const STAMP = /^(\d{14})_.*\.erddc$/

function timeToStamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}
function stampToTime(s: string): number {
  return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14))
}

/**
 * 새 기록의 시각 = max(지금, 마지막 기록 + 1초). 새 기록이 **언제나 마지막에 재생**되게 한다 —
 * 시계가 어긋난 브랜치의 기록이 미래 시각을 들고 와도 그 앞에 끼어들지 않는다.
 */
export function changesetStamp(now: Date, existingFiles: readonly string[]): string {
  let t = Math.floor(now.getTime() / 1000) * 1000
  for (const f of existingFiles) {
    const m = STAMP.exec(f.slice(f.lastIndexOf('/') + 1))
    if (m === null) continue
    const prev = stampToTime(m[1]!)
    if (!Number.isNaN(prev) && prev >= t) t = prev + 1000
  }
  return timeToStamp(t)
}

export function stampToIso(stamp: string): string {
  return new Date(stampToTime(stamp)).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export function changesetFileName(stamp: string, name: string): string {
  const slug = name.normalize('NFC').trim()
    .replace(/\s+/g, '-')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 60)
    .replace(/^[-.]+|[-.]+$/g, '')
  return `${stamp}_${slug === '' ? 'changes' : slug}${CHANGESET_EXT}`
}

export function formatChangeIssue(issue: ChangeIssue): string {
  const where = [issue.file, issue.line === null ? null : `${issue.line}행`].filter((x) => x !== null).join(' ')
  return where === '' ? issue.message : `${where}: ${issue.message}`
}
