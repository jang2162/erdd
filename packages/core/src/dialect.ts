import {
  canonicalOf, isUnsignedCapable, parseLogicalType,
  type LogicalType, type LogicalTypeKind, type UnsignedCapableKind,
} from './logical-type.js'

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
  if (isUnsignedCapable(type)) {
    const sql = FIXED[type.kind][dialect]
    // **mysql 만 접미를 낸다.** 나머지 셋에는 부호 없음 타입이 없어 `columnLine` 이
    // `CHECK (col >= 0)` 로 의미를 나른다(설계 §4.5).
    return type.unsigned && dialect === 'mysql' ? `${sql} UNSIGNED` : sql
  }
  return FIXED[type.kind][dialect]
}

export type FromDialectResult =
  | {
      ok: true; type: LogicalType; canonical: string; alternatives: LogicalTypeKind[]
      /** 원문에 `UNSIGNED` 가 있었지만 허용 집합 밖이라 떨어뜨렸다(설계 §4.6 의 경고 재료). */
      unsignedDropped: boolean
    }
  | { ok: false; raw: string }

type SqlTypeParts = {
  name: string; p1: number | null; p2: number | null; isMax: boolean
  /** 이름 뒤 접미에 `UNSIGNED` 가 있었는가. `ZEROFILL` 은 삼키기만 하고 버린다. */
  unsigned: boolean
}

/**
 * 'NVARCHAR(MAX)'·'NUMBER(10,2)'·'double precision'·'int(10) unsigned'를 이름·파라미터·접미로 가른다.
 *
 * ⚠️ **접미를 이름에서 떼어내는 것이 이 함수의 핵심 계약이다.** 그래야 방언별 전용 분기가 계속
 * 맞는다 — `tinyint unsigned` 는 이름이 `TINYINT` 로 남아야 `fromMysql` 의 `TINYINT` 분기를 타
 * `SMALLINT` 가 된다. 이름에 접미가 붙은 채로 넘기면 그 컬럼이 통째로 미지 타입이 된다.
 *
 * `ZEROFILL` 은 표시 전용이고 8.0.17 부터 deprecated 라 **삼키기만 하고 버린다.** MySQL 에서
 * `ZEROFILL` 이 `UNSIGNED` 를 함의하는 규칙은 **따르지 않는다**(설계 §10.5).
 */
function splitSqlType(sqlType: string): SqlTypeParts | null {
  const m = /^([A-Za-z][A-Za-z0-9_ ]*?)\s*(?:\(\s*(\d+|MAX)\s*(?:,\s*(\d+)\s*)?\))?((?:\s+(?:UNSIGNED|ZEROFILL))*)\s*$/i
    .exec(sqlType.trim())
  if (!m) return null
  const isMax = (m[2] ?? '').toUpperCase() === 'MAX'
  return {
    name: m[1]!.toUpperCase().replace(/\s+/g, ' '),
    p1: m[2] === undefined || isMax ? null : Number(m[2]),
    p2: m[3] === undefined ? null : Number(m[3]),
    isMax,
    unsigned: /\bUNSIGNED\b/i.test(m[4] ?? ''),
  }
}

// ⚠️ **`as LogicalType` 캐스트를 두지 마라** — 캐스트가 있으면 `unsigned` 필수화가 여기서
// 무력화되어 강제되는 자리가 하나도 남지 않는다(설계 §4.3).
const fixed = (
  kind: Exclude<LogicalTypeKind, 'CHAR' | 'VARCHAR' | 'DECIMAL'>,
  alternatives: LogicalTypeKind[] = [],
): FromDialectResult => {
  const type: LogicalType = kind === 'SMALLINT' || kind === 'INT' || kind === 'BIGINT'
    ? { kind, unsigned: false } : { kind }
  return { ok: true, type, canonical: canonicalOf(type), alternatives, unsignedDropped: false }
}

const sized = (
  kind: 'CHAR' | 'VARCHAR', length: number, alternatives: LogicalTypeKind[] = [],
): FromDialectResult => ({
  ok: true, type: { kind, length }, canonical: `${kind}(${length})`,
  alternatives, unsignedDropped: false,
})

const decimal = (precision: number, scale: number): FromDialectResult => ({
  ok: true, type: { kind: 'DECIMAL', precision, scale },
  canonical: `DECIMAL(${precision},${scale})`, alternatives: [], unsignedDropped: false,
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
    // MySQL 5.7 의 `mysqldump`·`SHOW CREATE TABLE` 이 내는 표시폭(`int(11)`·`bigint(20)`)은
    // 8.0.17 부터 deprecated 인 표시 전용 값이라 **무시한다**(설계 §9 ①). 공통 경로의
    // `parseLogicalType` 은 모델 표기용이라 괄호를 거절하므로 여기서 받아야 한다.
    case 'SMALLINT': return fixed('SMALLINT')
    case 'INT': case 'INTEGER': return fixed('INT')
    case 'BIGINT': return fixed('BIGINT')
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
/**
 * 부호 없음 접미를 base 결과에 얹는다. **방언별 분기를 새로 만들지 않는다** — 네 방언 공통
 * 경로라 postgresql 프로젝트로 `INT UNSIGNED` 가 든 DDL 이 들어와도 똑같이 해석된다(설계 §4.6).
 * 프로젝트는 방언을 여럿 가질 수 있으므로 읽는 시점의 방언 하나로 모델 값을 깎지 않는다.
 */
function applyUnsigned(base: FromDialectResult, unsigned: boolean): FromDialectResult {
  if (!base.ok || !unsigned) return base
  if (!isUnsignedCapable(base.type)) return { ...base, unsignedDropped: true }
  const type: LogicalType = { kind: base.type.kind, unsigned: true }
  return { ...base, type, canonical: canonicalOf(type) }
}

/** 접미를 뗀 방언 원문. 공통 경로의 `parseLogicalType` 이 엄격하므로 재조립해 넘긴다. */
function baseText(t: SqlTypeParts): string {
  if (t.isMax) return `${t.name}(MAX)`
  if (t.p1 === null) return t.name
  return t.p2 === null ? `${t.name}(${t.p1})` : `${t.name}(${t.p1},${t.p2})`
}

export function fromDialectType(sqlType: string, dialect: Dialect): FromDialectResult {
  const raw = sqlType.trim()
  const parts = splitSqlType(raw)
  if (parts) {
    const special =
      dialect === 'oracle' ? fromOracle(parts)
      : dialect === 'mysql' ? fromMysql(parts)
      : dialect === 'mssql' ? fromMssql(parts)
      : fromPostgres(parts)
    if (special) return applyUnsigned(special, parts.unsigned)
  }
  // 공통 경로: VARCHAR2·INTEGER·NUMERIC·BOOL 같은 별칭은 parseLogicalType이 이미 안다.
  const parsed = parseLogicalType(parts ? baseText(parts) : raw)
  if (!parsed.ok) return { ok: false, raw }
  return applyUnsigned(
    { ok: true, type: parsed.type, canonical: parsed.canonical, alternatives: [], unsignedDropped: false },
    parts?.unsigned ?? false,
  )
}

// Oracle에서 손실/변환 경고가 필요한 조합.
const ORACLE_WARN: Partial<Record<LogicalTypeKind, string>> = {
  TIME: 'Oracle에는 TIME이 없어 TIMESTAMP로 변환됩니다',
  DATETIME: 'Oracle DATE는 초 단위까지만 지원합니다(밀리초 필요 시 도메인에서 TIMESTAMP)',
  JSON: 'Oracle에서는 CLOB으로 변환됩니다(21c+ JSON 타입은 도메인 오버라이드)',
}

// 부호 없음이 mysql 밖으로 나갈 때 표현되지 않는 상한(설계 §4.5 의 표). oracle 의 NUMBER(n)
// 은 10진 자릿수라 SMALLINT·INT 는 상한이 넉넉하고 BIGINT 만 걸린다.
const UNSIGNED_LIMIT: Record<UnsignedCapableKind, string> = {
  SMALLINT: '65,535', INT: '4,294,967,295', BIGINT: '18,446,744,073,709,551,615',
}
const UNSIGNED_TARGET: Record<Dialect, Partial<Record<UnsignedCapableKind, string>>> = {
  mysql: {},
  postgresql: {
    SMALLINT: 'smallint(32,767)', INT: 'integer(2,147,483,647)',
    BIGINT: 'bigint(9,223,372,036,854,775,807)',
  },
  mssql: {
    SMALLINT: 'SMALLINT(32,767)', INT: 'INT(2,147,483,647)',
    BIGINT: 'BIGINT(9,223,372,036,854,775,807)',
  },
  oracle: { BIGINT: 'NUMBER(19)(9,999,999,999,999,999,999)' },
}

/** 부호 없음 상한이 대상 방언 타입을 넘는 조합의 경고. 넘지 않으면 undefined. */
export function unsignedWarning(kind: UnsignedCapableKind, dialect: Dialect): string | undefined {
  const target = UNSIGNED_TARGET[dialect][kind]
  if (target === undefined) return undefined
  return `${dialect}에는 부호 없음이 없어 CHECK (컬럼 >= 0)로 대신합니다`
    + ` — 상한 ${UNSIGNED_LIMIT[kind]}가 ${target}를 넘습니다`
}

export function resolveColumnType(rawType: string, dialect: Dialect): { sql: string; warning?: string } {
  const parsed = parseLogicalType(rawType)
  if (!parsed.ok) return { sql: parsed.raw }
  const sql = toDialectType(parsed.type, dialect)
  if (isUnsignedCapable(parsed.type) && parsed.type.unsigned) {
    const warning = unsignedWarning(parsed.type.kind, dialect)
    if (warning) return { sql, warning }
  }
  if (dialect === 'oracle') {
    const warning = ORACLE_WARN[parsed.type.kind]
    if (warning) return { sql, warning }
  }
  return { sql }
}
