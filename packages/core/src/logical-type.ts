/**
 * 방언 중립 논리 타입 17종과 그 표기(canonical).
 *
 * **부호 없음(`UNSIGNED`)은 논리 타입의 1급 속성이다**(설계 D1). 정수 3종
 * (`SMALLINT`·`INT`·`BIGINT`)만 열고, 표기는 대문자 접미 `<KIND> UNSIGNED` 하나다
 * (`INT UNSIGNED`). 이 문자열이 `erdd/tables/*.yaml` 과 서버 `columns.type` 에 그대로 박히므로
 * 표기를 바꾸는 비용이 곧 데이터 이행 비용이다.
 *
 * ⚠️ **`parseLogicalType`(여기)과 `splitSqlType`(`dialect.ts`)의 역할을 섞지 마라.**
 * - `parseLogicalType` 은 **모델 표기용이라 엄격하다** — `INT UNSIGNED` 는 받고
 *   `int(10) unsigned`·`tinyint unsigned` 는 거절한다.
 * - `splitSqlType` 은 **방언 원문용이라 관대하다** — 표시폭·`ZEROFILL` 까지 받아 넘긴다.
 * 섞으면 GUI 타입 칸에 `tinyint unsigned` 를 쳐도 통과해 모델에 방언 이름이 들어간다.
 */
export type LogicalTypeKind =
  | 'CHAR' | 'VARCHAR' | 'TEXT' | 'SMALLINT' | 'INT' | 'BIGINT' | 'DECIMAL'
  | 'FLOAT' | 'DOUBLE' | 'BOOLEAN' | 'DATE' | 'TIME' | 'DATETIME' | 'TIMESTAMPTZ'
  | 'BLOB' | 'JSON' | 'UUID'

/** 부호 없음을 붙일 수 있는 정수 3종(설계 §4.2). MySQL 8.0.17 이 나머지를 deprecated 했다. */
export type UnsignedCapableKind = 'SMALLINT' | 'INT' | 'BIGINT'

export type LogicalType =
  | { kind: 'CHAR'; length: number }
  | { kind: 'VARCHAR'; length: number }
  | { kind: 'DECIMAL'; precision: number; scale: number }
  // ⚠️ `unsigned` 는 옵셔널이 아니라 필수다 — 옵셔널이면 「안 적으면 signed」가 되어 구성처마다
  // 판단이 갈린다. 필수면 타입 검사가 모든 구성처에 결정을 강제한다. 그 강제가 살아 있으려면
  // **`as LogicalType` 캐스트를 두지 마라**(캐스트가 있으면 필드가 빠져도 컴파일이 통과한다).
  | { kind: UnsignedCapableKind; unsigned: boolean }
  | { kind: Exclude<LogicalTypeKind, 'CHAR' | 'VARCHAR' | 'DECIMAL' | UnsignedCapableKind> }

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

/** 논리 타입의 표기 문자열. 부호 없음은 접미로 붙는다. */
export function canonicalOf(type: LogicalType): string {
  if (type.kind === 'CHAR' || type.kind === 'VARCHAR') return `${type.kind}(${type.length})`
  if (type.kind === 'DECIMAL') return `DECIMAL(${type.precision},${type.scale})`
  if (isUnsignedCapable(type)) return type.unsigned ? `${type.kind} UNSIGNED` : type.kind
  return type.kind
}

/** 정수 3종인가. 좁힌 타입을 함께 돌려주므로 호출부가 `unsigned` 를 캐스트 없이 읽는다. */
export function isUnsignedCapable(
  type: LogicalType,
): type is { kind: UnsignedCapableKind; unsigned: boolean } {
  return type.kind === 'SMALLINT' || type.kind === 'INT' || type.kind === 'BIGINT'
}

export function parseLogicalType(input: string): ParseResult {
  const raw = input.trim()
  const m = /^([A-Za-z][A-Za-z0-9_ ]*?)\s*(?:\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\))?$/.exec(raw)
  if (!m) return { ok: false, raw }
  // 접미를 이름에서 **먼저** 떼어낸다 — 그래야 별칭 해석(`integer unsigned`)이 그 뒤에 온다.
  const normalized = m[1]!.toUpperCase().replace(/\s+/g, ' ')
  const unsigned = normalized.endsWith(' UNSIGNED')
  const name = unsigned ? normalized.slice(0, -' UNSIGNED'.length) : normalized
  const kind = (ALIASES[name] ?? (KINDS.has(name as LogicalTypeKind) ? (name as LogicalTypeKind) : undefined))
  if (!kind) return { ok: false, raw }
  const p1 = m[2] === undefined ? undefined : Number(m[2])
  const p2 = m[3] === undefined ? undefined : Number(m[3])

  if (kind === 'DECIMAL') {
    if (p1 === undefined || unsigned) return { ok: false, raw }
    const scale = p2 ?? 0
    return { ok: true, type: { kind: 'DECIMAL', precision: p1, scale }, canonical: `DECIMAL(${p1},${scale})` }
  }
  if (kind === 'CHAR' || kind === 'VARCHAR') {
    if (p1 === undefined || p2 !== undefined || unsigned) return { ok: false, raw }
    return { ok: true, type: { kind, length: p1 }, canonical: `${kind}(${p1})` }
  }
  // 파라미터 없는 타입: 괄호가 오면 실패.
  if (p1 !== undefined) return { ok: false, raw }
  if (kind === 'SMALLINT' || kind === 'INT' || kind === 'BIGINT') {
    return { ok: true, type: { kind, unsigned }, canonical: unsigned ? `${kind} UNSIGNED` : kind }
  }
  // 허용 집합 밖(DECIMAL·FLOAT·BOOLEAN…)에는 접미를 붙이지 않는다(설계 §4.2).
  if (unsigned) return { ok: false, raw }
  return { ok: true, type: { kind }, canonical: kind }
}
