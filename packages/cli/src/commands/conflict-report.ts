import type { ConflictReason, MergeConflict } from '@erdd/core'

const REASON_LABEL: Record<ConflictReason, string> = {
  field: '',                                   // 필드 단위는 필드 이름을 그대로 쓴다
  'both-added': '',                            // 〃
  'local-delete': '로컬에서 삭제, 서버에서 수정',
  'server-delete': '로컬에서 수정, 서버에서 삭제',
}

/** 엔티티 통째 충돌에서 값이 없다는 것은 "그쪽이 지웠다"는 뜻이다. */
function show(c: MergeConflict, v: string | null): string {
  if (v !== null) return v
  return c.field === '*' ? '(삭제됨)' : '(없음)'
}

function heading(c: MergeConflict): string {
  if (c.field !== '*') return c.field
  const suffix = c.changedFields.length > 0 ? ` (${c.changedFields.join(', ')})` : ''
  return `${REASON_LABEL[c.reason]}${suffix}`
}

export function renderConflicts(conflicts: readonly MergeConflict[]): string {
  const byPath = new Map<string, MergeConflict[]>()
  for (const c of conflicts) byPath.set(c.path, [...(byPath.get(c.path) ?? []), c])

  const lines: string[] = [`충돌 ${conflicts.length}건 — push를 중단했습니다.`]
  for (const path of [...byPath.keys()].sort()) {
    lines.push('', path)
    const group = [...byPath.get(path)!].sort((a, b) =>
      a.label === b.label ? a.field.localeCompare(b.field) : a.label.localeCompare(b.label))
    for (const c of group) {
      lines.push(`  ${c.label} · ${heading(c)}`)
      lines.push(`    기준  ${show(c, c.base)}`)
      lines.push(`    로컬  ${show(c, c.local)}`)
      lines.push(`    서버  ${show(c, c.server)}`)
    }
  }
  lines.push('', 'erdd pull로 서버 변경을 받은 뒤 다시 정리해 push하세요.')
  return lines.join('\n')
}
