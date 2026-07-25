export type LogicalTypeKind =
  | 'CHAR' | 'VARCHAR' | 'TEXT' | 'SMALLINT' | 'INT' | 'BIGINT' | 'DECIMAL'
  | 'FLOAT' | 'DOUBLE' | 'BOOLEAN' | 'DATE' | 'TIME' | 'DATETIME' | 'TIMESTAMPTZ'
  | 'BLOB' | 'JSON' | 'UUID'

export type LogicalType =
  | { kind: 'CHAR'; length: number }
  | { kind: 'VARCHAR'; length: number }
  | { kind: 'DECIMAL'; precision: number; scale: number }
  | { kind: Exclude<LogicalTypeKind, 'CHAR' | 'VARCHAR' | 'DECIMAL'> }

export type ParseResult =
  | { ok: true; type: LogicalType; canonical: string }
  | { ok: false; raw: string }

// 별칭 → 정규 kind. 키는 대문자·단일공백 정규화된 이름.
const ALIASES: Record<string, LogicalTypeKind> = {
  INTEGER: 'INT',
  VARCHAR2: 'VARCHAR',
  NUMERIC: 'DECIMAL',
  NUMBER: 'DECIMAL',
  TIMESTAMP: 'DATETIME',
  BOOL: 'BOOLEAN',
  'DOUBLE PRECISION': 'DOUBLE',
}
const KINDS = new Set<LogicalTypeKind>([
  'CHAR', 'VARCHAR', 'TEXT', 'SMALLINT', 'INT', 'BIGINT', 'DECIMAL',
  'FLOAT', 'DOUBLE', 'BOOLEAN', 'DATE', 'TIME', 'DATETIME', 'TIMESTAMPTZ',
  'BLOB', 'JSON', 'UUID',
])
const LENGTH_KINDS = new Set(['CHAR', 'VARCHAR'])

export function parseLogicalType(input: string): ParseResult {
  const raw = input.trim()
  const m = /^([A-Za-z][A-Za-z0-9_ ]*?)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?$/.exec(raw)
  if (!m) return { ok: false, raw }
  const name = m[1]!.toUpperCase().replace(/\s+/g, ' ')
  const kind = (ALIASES[name] ?? (KINDS.has(name as LogicalTypeKind) ? (name as LogicalTypeKind) : undefined))
  if (!kind) return { ok: false, raw }
  const p1 = m[2] === undefined ? undefined : Number(m[2])
  const p2 = m[3] === undefined ? undefined : Number(m[3])

  if (kind === 'DECIMAL') {
    if (p1 === undefined) return { ok: false, raw }
    const scale = p2 ?? 0
    return { ok: true, type: { kind: 'DECIMAL', precision: p1, scale }, canonical: `DECIMAL(${p1},${scale})` }
  }
  if (LENGTH_KINDS.has(kind)) {
    if (p1 === undefined || p2 !== undefined) return { ok: false, raw }
    return { ok: true, type: { kind, length: p1 } as LogicalType, canonical: `${kind}(${p1})` }
  }
  // 파라미터 없는 타입: 괄호가 오면 실패.
  if (p1 !== undefined) return { ok: false, raw }
  return { ok: true, type: { kind } as LogicalType, canonical: kind }
}
