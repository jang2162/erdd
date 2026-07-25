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
    return dialect === 'mssql' ? `NCHAR(${type.length})` : `CHAR(${type.length})`
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
