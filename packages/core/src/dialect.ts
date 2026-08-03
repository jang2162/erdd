import { parseLogicalType, type LogicalType, type LogicalTypeKind } from './logical-type.js'

export const DIALECTS = ['postgresql', 'mysql', 'oracle', 'mssql'] as const
export type Dialect = (typeof DIALECTS)[number]

// 파라미터 없는 kind의 방언별 고정 타입. 파라미터 타입(CHAR/VARCHAR/DECIMAL)은 아래 함수에서 조합.
const FIXED: Record<Exclude<LogicalTypeKind, 'CHAR' | 'VARCHAR' | 'DECIMAL'>, Record<Dialect, string>> = {
  TEXT: { postgresql: 'text', mysql: 'LONGTEXT', oracle: 'CLOB', mssql: 'NVARCHAR(MAX)' },
  SMALLINT: { postgresql: 'smallint', mysql: 'SMALLINT', oracle: 'NUMBER(5)', mssql: 'SMALLINT' },
  INT: { postgresql: 'integer', mysql: 'INT', oracle: 'NUMBER(10)', mssql: 'INT' },
  BIGINT: { postgresql: 'bigint', mysql: 'BIGINT', oracle: 'NUMBER(19)', mssql: 'BIGINT' },
  FLOAT: { postgresql: 'real', mysql: 'FLOAT', oracle: 'BINARY_FLOAT', mssql: 'REAL' },
  DOUBLE: { postgresql: 'double precision', mysql: 'DOUBLE', oracle: 'BINARY_DOUBLE', mssql: 'FLOAT' },
  BOOLEAN: { postgresql: 'boolean', mysql: 'TINYINT(1)', oracle: 'NUMBER(1)', mssql: 'BIT' },
  DATE: { postgresql: 'date', mysql: 'DATE', oracle: 'DATE', mssql: 'DATE' },
  TIME: { postgresql: 'time', mysql: 'TIME', oracle: 'TIMESTAMP', mssql: 'TIME' },
  DATETIME: { postgresql: 'timestamp', mysql: 'DATETIME', oracle: 'DATE', mssql: 'DATETIME2' },
  TIMESTAMPTZ: { postgresql: 'timestamptz', mysql: 'TIMESTAMP', oracle: 'TIMESTAMP WITH TIME ZONE', mssql: 'DATETIMEOFFSET' },
  BLOB: { postgresql: 'bytea', mysql: 'LONGBLOB', oracle: 'BLOB', mssql: 'VARBINARY(MAX)' },
  JSON: { postgresql: 'jsonb', mysql: 'JSON', oracle: 'CLOB', mssql: 'NVARCHAR(MAX)' },
  UUID: { postgresql: 'uuid', mysql: 'CHAR(36)', oracle: 'RAW(16)', mssql: 'UNIQUEIDENTIFIER' },
}

export function toDialectType(type: LogicalType, dialect: Dialect): string {
  if (type.kind === 'CHAR') {
    const n = type.length
    return dialect === 'postgresql' ? `char(${n})`
      : dialect === 'mssql' ? `NCHAR(${n})`
      : `CHAR(${n})` // mysql, oracle
  }
  if (type.kind === 'VARCHAR') {
    const n = type.length
    return dialect === 'postgresql' ? `varchar(${n})`
      : dialect === 'mysql' ? `VARCHAR(${n})`
      : dialect === 'oracle' ? `VARCHAR2(${n})`
      : `NVARCHAR(${n})`
  }
  if (type.kind === 'DECIMAL') {
    const ps = `${type.precision},${type.scale}`
    return dialect === 'postgresql' ? `numeric(${ps})`
      : dialect === 'oracle' ? `NUMBER(${ps})`
      : `DECIMAL(${ps})`
  }
  return FIXED[type.kind][dialect]
}

export type FromDialectResult =
  | { ok: true; type: LogicalType; canonical: string; alternatives: LogicalTypeKind[] }
  | { ok: false; raw: string }

type SqlTypeParts = { name: string; p1: number | null; p2: number | null; isMax: boolean }

/** 'NVARCHAR(MAX)'·'NUMBER(10,2)'·'double precision'을 이름과 파라미터로 가른다. */
function splitSqlType(sqlType: string): SqlTypeParts | null {
  const m = /^([A-Za-z][A-Za-z0-9_ ]*?)\s*(?:\(\s*(\d+|MAX)\s*(?:,\s*(\d+)\s*)?\))?$/i
    .exec(sqlType.trim())
  if (!m) return null
  const isMax = (m[2] ?? '').toUpperCase() === 'MAX'
  return {
    name: m[1]!.toUpperCase().replace(/\s+/g, ' '),
    p1: m[2] === undefined || isMax ? null : Number(m[2]),
    p2: m[3] === undefined ? null : Number(m[3]),
    isMax,
  }
}

const fixed = (
  kind: Exclude<LogicalTypeKind, 'CHAR' | 'VARCHAR' | 'DECIMAL'>,
  alternatives: LogicalTypeKind[] = [],
): FromDialectResult => ({ ok: true, type: { kind } as LogicalType, canonical: kind, alternatives })

const sized = (
  kind: 'CHAR' | 'VARCHAR', length: number, alternatives: LogicalTypeKind[] = [],
): FromDialectResult => ({ ok: true, type: { kind, length }, canonical: `${kind}(${length})`, alternatives })

const decimal = (precision: number, scale: number): FromDialectResult => ({
  ok: true, type: { kind: 'DECIMAL', precision, scale },
  canonical: `DECIMAL(${precision},${scale})`, alternatives: [],
})

// 방언별 특수 규칙. null을 돌려주면 아래의 parseLogicalType 공통 경로로 넘어간다.
function fromOracle(t: SqlTypeParts): FromDialectResult | null {
  switch (t.name) {
    case 'NUMBER': {
      if (t.p1 === null) return null                       // 무정밀도 NUMBER → 원문 보존
      if (t.p2 !== null) return decimal(t.p1, t.p2)         // scale이 있으면 정수 후보가 아니다
      if (t.p1 === 1) return fixed('BOOLEAN', ['DECIMAL'])
      if (t.p1 === 5) return fixed('SMALLINT', ['DECIMAL'])
      if (t.p1 === 10) return fixed('INT', ['DECIMAL'])
      if (t.p1 === 19) return fixed('BIGINT', ['DECIMAL'])
      return decimal(t.p1, 0)
    }
    // Oracle DATE는 시각을 포함한다 → DATETIME이 더 정확하다.
    case 'DATE': return fixed('DATETIME', ['DATE'])
    // 우리 매핑에서는 TIME만 TIMESTAMP로 나가지만, 실무 Oracle DDL의 TIMESTAMP는
    // 거의 항상 일시다. 실무 정확성을 택하고 TIME의 왕복을 포기한다(설계 §2).
    case 'TIMESTAMP': return fixed('DATETIME', ['TIME'])
    case 'TIMESTAMP WITH TIME ZONE': return fixed('TIMESTAMPTZ')
    case 'CLOB': case 'NCLOB': return fixed('TEXT', ['JSON'])
    case 'BINARY_FLOAT': return fixed('FLOAT')
    case 'BINARY_DOUBLE': return fixed('DOUBLE')
    case 'RAW': return t.p1 === 16 ? fixed('UUID', ['BLOB']) : fixed('BLOB')
    default: return null
  }
}

function fromMysql(t: SqlTypeParts): FromDialectResult | null {
  switch (t.name) {
    case 'TINYINT': return t.p1 === 1 ? fixed('BOOLEAN', ['SMALLINT']) : fixed('SMALLINT')
    case 'CHAR': return t.p1 === 36 ? sized('CHAR', 36, ['UUID']) : null
    case 'LONGTEXT': case 'MEDIUMTEXT': case 'TINYTEXT': return fixed('TEXT')
    case 'LONGBLOB': case 'MEDIUMBLOB': case 'TINYBLOB': return fixed('BLOB')
    case 'TIMESTAMP': return fixed('TIMESTAMPTZ', ['DATETIME'])
    default: return null
  }
}

function fromMssql(t: SqlTypeParts): FromDialectResult | null {
  switch (t.name) {
    case 'NVARCHAR': case 'VARCHAR':
      return t.isMax ? fixed('TEXT', ['JSON']) : (t.p1 === null ? null : sized('VARCHAR', t.p1))
    case 'NCHAR': return t.p1 === null ? null : sized('CHAR', t.p1)
    case 'VARBINARY': case 'IMAGE': return fixed('BLOB')
    case 'BIT': return fixed('BOOLEAN')
    case 'DATETIME': case 'DATETIME2': case 'SMALLDATETIME': return fixed('DATETIME')
    case 'DATETIMEOFFSET': return fixed('TIMESTAMPTZ')
    case 'UNIQUEIDENTIFIER': return fixed('UUID')
    case 'REAL': return fixed('FLOAT')
    // 우리 매핑에서 DOUBLE → mssql FLOAT, FLOAT → mssql REAL이다.
    case 'FLOAT': return fixed('DOUBLE', ['FLOAT'])
    case 'MONEY': case 'SMALLMONEY': return decimal(19, 4)
    default: return null
  }
}

function fromPostgres(t: SqlTypeParts): FromDialectResult | null {
  switch (t.name) {
    case 'JSONB': case 'JSON': return fixed('JSON')
    case 'BYTEA': return fixed('BLOB')
    case 'TIMESTAMPTZ': case 'TIMESTAMP WITH TIME ZONE': return fixed('TIMESTAMPTZ')
    case 'TIMESTAMP WITHOUT TIME ZONE': return fixed('DATETIME')
    case 'SERIAL': return fixed('INT')
    case 'BIGSERIAL': return fixed('BIGINT')
    case 'SMALLSERIAL': return fixed('SMALLINT')
    case 'REAL': return fixed('FLOAT')
    case 'CHARACTER VARYING': return t.p1 === null ? fixed('TEXT') : sized('VARCHAR', t.p1)
    default: return null
  }
}

/**
 * toDialectType의 역함수. alternatives가 비어 있지 않으면 모호하게 해석한 것이다.
 * ⚠️ toDialectType·FIXED를 고치면 이 함수도 함께 고쳐야 한다 — 그래서 같은 파일에 둔다.
 */
export function fromDialectType(sqlType: string, dialect: Dialect): FromDialectResult {
  const raw = sqlType.trim()
  const parts = splitSqlType(raw)
  if (parts) {
    const special =
      dialect === 'oracle' ? fromOracle(parts)
      : dialect === 'mysql' ? fromMysql(parts)
      : dialect === 'mssql' ? fromMssql(parts)
      : fromPostgres(parts)
    if (special) return special
  }
  // 공통 경로: VARCHAR2·INTEGER·NUMERIC·BOOL 같은 별칭은 parseLogicalType이 이미 안다.
  const parsed = parseLogicalType(raw)
  if (!parsed.ok) return { ok: false, raw }
  return { ok: true, type: parsed.type, canonical: parsed.canonical, alternatives: [] }
}

// Oracle에서 손실/변환 경고가 필요한 조합.
const ORACLE_WARN: Partial<Record<LogicalTypeKind, string>> = {
  TIME: 'Oracle에는 TIME이 없어 TIMESTAMP로 변환됩니다',
  DATETIME: 'Oracle DATE는 초 단위까지만 지원합니다(밀리초 필요 시 도메인에서 TIMESTAMP)',
  JSON: 'Oracle에서는 CLOB으로 변환됩니다(21c+ JSON 타입은 도메인 오버라이드)',
}

export function resolveColumnType(rawType: string, dialect: Dialect): { sql: string; warning?: string } {
  const parsed = parseLogicalType(rawType)
  if (!parsed.ok) return { sql: parsed.raw }
  const sql = toDialectType(parsed.type, dialect)
  if (dialect === 'oracle') {
    const warning = ORACLE_WARN[parsed.type.kind]
    if (warning) return { sql, warning }
  }
  return { sql }
}
