import type { Dialect } from './dialect.js'

export type ParsedColumn = {
  name: string
  rawType: string              // 원문 그대로. 예: 'NUMBER(10)', 'VARCHAR2(100)'
  notNull: boolean
  defaultValue: string | null
  autoIncrement: boolean
  inlinePk: boolean
  comment: string | null       // MySQL 인라인 COMMENT
}
export type ParsedTable = { name: string; columns: ParsedColumn[] }
export type ParsedConstraint =
  | { kind: 'pk'; table: string; columns: string[] }
  | { kind: 'unique'; table: string; name: string | null; columns: string[] }
  | { kind: 'fk'; table: string; name: string | null; columns: string[]
      refTable: string; refColumns: string[] }
export type ParsedIndex = { table: string; name: string; columns: string[]; unique: boolean }
export type ParsedComment = { table: string; column: string | null; text: string }
export type SkippedStatement = { keyword: string; line: number; excerpt: string }

export type ParsedDdl = {
  tables: ParsedTable[]
  constraints: ParsedConstraint[]
  indexes: ParsedIndex[]
  comments: ParsedComment[]
  skipped: SkippedStatement[]
}

/** 주석을 걷어낸 한 문장과 원문에서의 시작 줄 번호(1-based). */
export type RawStatement = { text: string; line: number }

/**
 * 주석을 제거하고 문장을 나눈다. 문자열 리터럴('…', 이스케이프 '')과 따옴표 식별자
 * ("…", `…`, […]) 안에서는 어떤 구분자·주석 기호도 해석하지 않는다.
 * 줄 번호는 원문 기준이므로 주석을 지워도 어긋나지 않는다.
 */
export function splitStatements(ddl: string): RawStatement[] {
  // CRLF·CR을 LF로 통일한다. 줄 수가 바뀌지 않으므로 줄 번호는 그대로 유지되고,
  // '/' 구분자 판정처럼 줄 끝을 보는 로직이 \r에 걸리지 않는다.
  const src = ddl.replace(/\r\n?/g, '\n')
  const out: RawStatement[] = []
  let buf = ''
  let line = 1
  let startLine = 1
  let started = false

  const flush = () => {
    const text = buf.trim()
    if (text !== '') out.push({ text, line: startLine })
    buf = ''
    started = false
  }

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    const next = src[i + 1]

    if (c === '\n') { line += 1; buf += c; continue }

    // 줄 주석
    if (c === '-' && next === '-') {
      while (i < src.length && src[i] !== '\n') i++
      i--
      continue
    }
    // 블록 주석
    if (c === '/' && next === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') line += 1
        i++
      }
      i += 1
      continue
    }
    // 문자열 리터럴 — '' 이스케이프 포함
    if (c === "'") {
      if (!started) { startLine = line; started = true }
      buf += c
      i++
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") { buf += "''"; i += 2; continue }
        if (src[i] === "'") { buf += "'"; break }
        if (src[i] === '\n') line += 1
        buf += src[i]!
        i++
      }
      continue
    }
    // 따옴표 식별자 — 내용은 그대로 실어 보낸다(해제는 unquoteIdentifier가 한다)
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      if (!started) { startLine = line; started = true }
      buf += c
      i++
      while (i < src.length) {
        if (src[i] === close && src[i + 1] === close) { buf += close + close; i += 2; continue }
        if (src[i] === close) { buf += close; break }
        if (src[i] === '\n') line += 1
        buf += src[i]!
        i++
      }
      continue
    }
    // 구분자
    if (c === ';') { flush(); continue }
    // Oracle 스크립트의 / — 줄에 그것만 있을 때만 구분자다
    if (c === '/' && /(^|\n)[ \t]*$/.test(buf.slice(-40)) && /^[ \t]*(\n|$)/.test(src.slice(i + 1))) {
      flush(); continue
    }

    if (!started && c.trim() !== '') { startLine = line; started = true }
    buf += c
  }
  flush()
  return out
}

/** 스키마 접두사를 떼고 따옴표를 벗긴다. 따옴표 안의 점은 구분자가 아니다. */
export function unquoteIdentifier(raw: string): string {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!
    if (c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      i++
      while (i < raw.length) {
        if (raw[i] === close && raw[i + 1] === close) { cur += close; i += 2; continue }
        if (raw[i] === close) break
        cur += raw[i]!
        i++
      }
      continue
    }
    if (c === '.') { parts.push(cur); cur = ''; continue }
    cur += c
  }
  parts.push(cur)
  return parts[parts.length - 1]!.trim()
}

const SIGNATURES: Array<{ dialect: Dialect; pattern: RegExp; weight: number }> = [
  { dialect: 'mysql', pattern: /\bAUTO_INCREMENT\b/i, weight: 3 },
  { dialect: 'mysql', pattern: /`/, weight: 2 },
  { dialect: 'mysql', pattern: /\bENGINE\s*=/i, weight: 2 },
  { dialect: 'mysql', pattern: /\b(LONGTEXT|LONGBLOB|TINYINT)\b/i, weight: 2 },
  { dialect: 'oracle', pattern: /\bVARCHAR2\b/i, weight: 3 },
  { dialect: 'oracle', pattern: /\bNUMBER\s*\(/i, weight: 2 },
  { dialect: 'oracle', pattern: /\b(CLOB|NCLOB|BINARY_DOUBLE|BINARY_FLOAT)\b/i, weight: 2 },
  { dialect: 'mssql', pattern: /\bIDENTITY\s*\(/i, weight: 3 },
  { dialect: 'mssql', pattern: /\[[A-Za-z_]/, weight: 2 },
  { dialect: 'mssql', pattern: /\b(NVARCHAR|UNIQUEIDENTIFIER|DATETIME2|DATETIMEOFFSET)\b/i, weight: 2 },
  { dialect: 'postgresql', pattern: /\b(BIGSERIAL|SMALLSERIAL|SERIAL)\b/i, weight: 3 },
  { dialect: 'postgresql', pattern: /\b(JSONB|TIMESTAMPTZ|BYTEA)\b/i, weight: 3 },
]

/** 특징 토큰 점수제. 1등이 없거나 동점이면 null(사용자가 고른다). */
export function detectDialect(ddl: string): Dialect | null {
  const score: Record<Dialect, number> = { postgresql: 0, mysql: 0, oracle: 0, mssql: 0 }
  for (const s of SIGNATURES) if (s.pattern.test(ddl)) score[s.dialect] += s.weight
  const ranked = (Object.entries(score) as Array<[Dialect, number]>)
    .sort((a, b) => b[1] - a[1])
  const [top, second] = ranked
  if (!top || top[1] === 0) return null
  if (second && second[1] === top[1]) return null
  return top[0]
}

/** 문장 앞머리에서 skipped에 남길 키워드를 뽑는다. */
function statementKeyword(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim().toUpperCase()
  const two = /^(CREATE\s+(?:TABLE|INDEX|UNIQUE\s+INDEX|SEQUENCE|VIEW|TRIGGER|PROCEDURE|FUNCTION)|ALTER\s+TABLE|COMMENT\s+ON)\b/
    .exec(t)
  if (two) return two[1]!.replace(/\s+/g, ' ')
  return (/^[A-Z_]+/.exec(t)?.[0]) ?? '?'
}

export function parseDdl(ddl: string): ParsedDdl {
  const result: ParsedDdl = { tables: [], constraints: [], indexes: [], comments: [], skipped: [] }
  for (const stmt of splitStatements(ddl)) {
    // Task 4·5가 여기에 분기를 채운다.
    result.skipped.push({
      keyword: statementKeyword(stmt.text),
      line: stmt.line,
      excerpt: stmt.text.replace(/\s+/g, ' ').slice(0, 80),
    })
  }
  return result
}
