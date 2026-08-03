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

/** 괄호 깊이 0의 쉼표로만 나눈다. 문자열 리터럴·따옴표 식별자 안은 건너뛴다. */
function splitTopLevel(body: string): string[] {
  const out: string[] = []
  let cur = ''
  let depth = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      cur += c; i++
      while (i < body.length) {
        if (body[i] === close && body[i + 1] === close) { cur += close + close; i += 2; continue }
        cur += body[i]!
        if (body[i] === close) break
        i++
      }
      continue
    }
    if (c === '(') depth++
    if (c === ')') depth--
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  if (cur.trim() !== '') out.push(cur.trim())
  return out
}

/** '(A, B)' 같은 괄호 목록을 식별자 배열로. */
function identifierList(inner: string): string[] {
  return splitTopLevel(inner).map((s) => unquoteIdentifier(s.replace(/\s+(ASC|DESC)$/i, '').trim()))
}

/** 문자열의 첫 최상위 괄호 쌍의 내용과 그 뒤 꼬리를 돌려준다. */
function firstParenGroup(text: string): { inner: string; tail: string } | null {
  const start = text.indexOf('(')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const c = text[i]!
    if (c === "'" || c === '"' || c === '`' || c === '[') {
      const close = c === '[' ? ']' : c
      i++
      while (i < text.length && text[i] !== close) i++
      continue
    }
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return { inner: text.slice(start + 1, i), tail: text.slice(i + 1) }
    }
  }
  return null
}

const AUTO_INCREMENT_PATTERNS = [
  /\bAUTO_INCREMENT\b/i,                   // mysql
  /\bIDENTITY\b/i,                         // mssql, oracle
  /\bGENERATED\s+(BY\s+DEFAULT|ALWAYS)\s+AS\s+IDENTITY\b/i,
]
const SERIAL_TYPES = /^(SERIAL|BIGSERIAL|SMALLSERIAL)$/i

/**
 * 문자열 리터럴('…', '' 이스케이프 포함)의 내용을 같은 길이의 자리표시 문자로 덮는다.
 * 키워드 스캔이 코멘트·기본값 안의 단어를 구조 키워드로 오인하지 않게 하는 장치다.
 * 길이를 보존하므로 마스킹본에서 찾은 인덱스를 원본에 그대로 쓸 수 있다.
 *
 * 자리표시 문자는 일부러 공백이 아닌 것(`#`)을 쓴다. DEFAULT 값 자체가 통째로 문자열
 * 리터럴일 때(예: `DEFAULT '01' NOT NULL`) 마스킹된 값을 공백으로 채우면 그 앞뒤의
 * 진짜 공백과 구분이 안 돼 하나의 연속된 공백 구간으로 합쳐진다. 그러면 종결 키워드를
 * 찾는 `\s+`류 정규식이 탐욕적으로 그 구간을 통째로 삼키거나(값 손실), 반대로 값 뒤의
 * 실제 키워드 일부(`NOT`)까지 값으로 삼켜버리는(`'01' NOT`처럼) 오류가 난다. 자리표시를
 * 공백이 아닌 문자로 두면 원래(마스킹 전) 따옴표 문자가 비공백이라 경계가 또렷했던
 * 동작이 그대로 재현된다.
 */
function maskStringLiterals(text: string): string {
  const FILL = '#'
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (c !== "'") { out += c; continue }
    out += FILL
    i++
    while (i < text.length) {
      if (text[i] === "'" && text[i + 1] === "'") { out += FILL + FILL; i += 2; continue }
      if (text[i] === "'") { out += FILL; break }
      out += FILL
      i++
    }
  }
  return out
}

function parseColumnDef(def: string): ParsedColumn | null {
  const nameMatch = /^\s*("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|[A-Za-z_][\w$]*)\s*(.*)$/s
    .exec(def)
  if (!nameMatch) return null
  const name = unquoteIdentifier(nameMatch[1]!)
  const rest = nameMatch[2]!.trim()
  if (rest === '') return null

  // 타입 = 첫 토큰(공백 허용 조합 포함) + 선택적 괄호
  const typeMatch = /^((?:DOUBLE\s+PRECISION|CHARACTER\s+VARYING|TIMESTAMP\s+WITH(?:OUT)?\s+TIME\s+ZONE|[A-Za-z_][\w$]*)\s*(?:\([^)]*\))?)/i
    .exec(rest)
  if (!typeMatch) return null
  const rawType = typeMatch[1]!.replace(/\s+/g, ' ').trim()
  const attrs = rest.slice(typeMatch[0].length)

  // 구조 키워드(NOT NULL·PRIMARY KEY·자동증가 등) 판정은 문자열 리터럴 내용에 속으면
  // 안 되므로 리터럴 내용을 공백으로 덮은 마스킹본에서 찾는다. comment 내용 자체가
  // 필요한 commentMatch만 예외적으로 원본 attrs를 그대로 쓴다.
  const attrsScan = maskStringLiterals(attrs)

  // 'GENERATED BY DEFAULT AS IDENTITY'의 DEFAULT가 기본값 절로 오인되지 않게 먼저 걷어낸다.
  // (MSSQL의 IDENTITY(1,1)에는 DEFAULT가 없어 영향이 없다.)
  const attrsForDefault = attrs.replace(
    /\bGENERATED\s+(?:BY\s+DEFAULT|ALWAYS)\s+AS\s+IDENTITY\b(?:\s*\([^)]*\))?/gi, ' ',
  )
  // DEFAULT 절의 시작·끝 위치는 마스킹본에서 찾는다(문자열 안의 DEFAULT·종결 키워드에
  // 속지 않기 위해). attrsForDefault와 길이가 같은 마스킹본이라 인덱스를 원본에 그대로 쓸 수 있다.
  const maskedForDefault = maskStringLiterals(attrsForDefault)
  const dIdx = maskedForDefault.search(/\bDEFAULT\s/i)
  let defaultValue: string | null = null
  if (dIdx >= 0) {
    const end = /^DEFAULT\s+.+?(?=\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|COMMENT|COLLATE|CHECK)\b|$)/is
      .exec(maskedForDefault.slice(dIdx))
    if (end) defaultValue = attrsForDefault.slice(dIdx, dIdx + end[0].length).replace(/^DEFAULT\s+/i, '').trim()
  }
  const commentMatch = /\bCOMMENT\s+'((?:[^']|'')*)'/is.exec(attrs)

  return {
    name,
    rawType,
    notNull: /\bNOT\s+NULL\b/i.test(attrsScan) || /\bPRIMARY\s+KEY\b/i.test(attrsScan),
    defaultValue,
    autoIncrement: AUTO_INCREMENT_PATTERNS.some((p) => p.test(attrsScan)) || SERIAL_TYPES.test(rawType),
    inlinePk: /\bPRIMARY\s+KEY\b/i.test(attrsScan),
    comment: commentMatch ? commentMatch[1]!.replace(/''/g, "'") : null,
  }
}

const CREATE_TABLE_RE = /^CREATE\s+(?:GLOBAL\s+TEMPORARY\s+|TEMPORARY\s+|TEMP\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(.+?)\s*(?=\()/is

function parseCreateTable(
  stmt: RawStatement, out: ParsedDdl,
): boolean {
  const head = CREATE_TABLE_RE.exec(stmt.text)
  if (!head) return false
  const group = firstParenGroup(stmt.text)
  if (!group) return false
  const table = unquoteIdentifier(head[1]!.trim())
  const columns: ParsedColumn[] = []

  for (const item of splitTopLevel(group.inner)) {
    const named = /^CONSTRAINT\s+("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|[A-Za-z_][\w$]*)\s+(.*)$/is
      .exec(item)
    const constraintName = named ? unquoteIdentifier(named[1]!) : null
    const body = named ? named[2]!.trim() : item

    if (/^PRIMARY\s+KEY\b/i.test(body)) {
      const g = firstParenGroup(body)
      if (g) out.constraints.push({ kind: 'pk', table, columns: identifierList(g.inner) })
      continue
    }
    if (/^UNIQUE\b/i.test(body)) {
      const g = firstParenGroup(body)
      if (g) out.constraints.push({ kind: 'unique', table, name: constraintName, columns: identifierList(g.inner) })
      continue
    }
    if (/^FOREIGN\s+KEY\b/i.test(body)) {
      const cols = firstParenGroup(body)
      if (!cols) continue
      const ref = /REFERENCES\s+(.+?)\s*(\(|$)/is.exec(cols.tail)
      const refCols = firstParenGroup(cols.tail)
      if (!ref) continue
      out.constraints.push({
        kind: 'fk', table, name: constraintName,
        columns: identifierList(cols.inner),
        refTable: unquoteIdentifier(ref[1]!.trim()),
        refColumns: refCols ? identifierList(refCols.inner) : [],
      })
      continue
    }
    if (/^CHECK\b/i.test(body)) {
      out.skipped.push({ keyword: 'CHECK', line: stmt.line, excerpt: item.replace(/\s+/g, ' ').slice(0, 80) })
      continue
    }

    const col = parseColumnDef(item)
    if (!col) {
      out.skipped.push({ keyword: '?', line: stmt.line, excerpt: item.replace(/\s+/g, ' ').slice(0, 80) })
      continue
    }
    columns.push(col)
    if (col.inlinePk) out.constraints.push({ kind: 'pk', table, columns: [col.name] })

    // 인라인 REFERENCES
    // 컬럼 정의 한 줄에 REFERENCES는 많아야 하나다. 따옴표 식별자 때문에
    // 물리명 길이로 자르면 어긋나므로 줄 전체에서 찾는다. 위치는 문자열 리터럴을
    // 마스킹한 사본에서 찾아 리터럴 안의 'REFERENCES ...' 텍스트를 진짜 절로 오인하지
    // 않게 하고, 실제 값은 원본 item에서 그 위치부터 잘라낸다.
    const itemScan = maskStringLiterals(item)
    const refIdx = itemScan.search(/\bREFERENCES\s/i)
    if (refIdx >= 0) {
      const m = /^REFERENCES\s+(.+?)\s*\(([^)]*)\)/is.exec(item.slice(refIdx))
      if (m) {
        out.constraints.push({
          kind: 'fk', table, name: null, columns: [col.name],
          refTable: unquoteIdentifier(m[1]!.trim()),
          refColumns: identifierList(m[2]!),
        })
      }
    }
  }

  out.tables.push({ name: table, columns })
  return true
}

const ALTER_ADD_RE = /^ALTER\s+TABLE\s+(?:ONLY\s+)?(.+?)\s+ADD\s+(?:CONSTRAINT\s+("(?:[^"]|"")*"|`(?:[^`]|``)*`|\[(?:[^\]]|\]\])*\]|[A-Za-z_][\w$]*)\s+)?(.*)$/is

function parseAlterTable(stmt: RawStatement, out: ParsedDdl): boolean {
  const m = ALTER_ADD_RE.exec(stmt.text)
  if (!m) return false
  const table = unquoteIdentifier(m[1]!.trim())
  const name = m[2] ? unquoteIdentifier(m[2]) : null
  const body = m[3]!.trim()

  if (/^PRIMARY\s+KEY\b/i.test(body)) {
    const g = firstParenGroup(body)
    if (!g) return false
    out.constraints.push({ kind: 'pk', table, columns: identifierList(g.inner) })
    return true
  }
  if (/^UNIQUE\b/i.test(body)) {
    const g = firstParenGroup(body)
    if (!g) return false
    out.constraints.push({ kind: 'unique', table, name, columns: identifierList(g.inner) })
    return true
  }
  if (/^FOREIGN\s+KEY\b/i.test(body)) {
    const cols = firstParenGroup(body)
    if (!cols) return false
    const ref = /REFERENCES\s+(.+?)\s*(\(|$)/is.exec(cols.tail)
    const refCols = firstParenGroup(cols.tail)
    if (!ref) return false
    out.constraints.push({
      kind: 'fk', table, name,
      columns: identifierList(cols.inner),
      refTable: unquoteIdentifier(ref[1]!.trim()),
      refColumns: refCols ? identifierList(refCols.inner) : [],
    })
    return true
  }
  return false   // CHECK·그 밖의 ADD는 skipped로 간다
}

const CREATE_INDEX_RE = /^CREATE\s+(UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?(.+?)\s+ON\s+(.+?)\s*(?=\()/is

function parseCreateIndex(stmt: RawStatement, out: ParsedDdl): boolean {
  const m = CREATE_INDEX_RE.exec(stmt.text)
  if (!m) return false
  // m[0]은 lookahead로 끝나므로 여기서부터가 컬럼 목록의 여는 괄호다.
  const group = firstParenGroup(stmt.text.slice(m[0].length))
  if (!group) return false
  out.indexes.push({
    table: unquoteIdentifier(m[3]!.trim()),
    name: unquoteIdentifier(m[2]!.trim()),
    columns: identifierList(group.inner),
    unique: m[1] !== undefined,
  })
  return true
}

const COMMENT_ON_RE = /^COMMENT\s+ON\s+(TABLE|COLUMN)\s+(.+?)\s+IS\s+'((?:[^']|'')*)'/is

function parseCommentOn(stmt: RawStatement, out: ParsedDdl): boolean {
  const m = COMMENT_ON_RE.exec(stmt.text)
  if (!m) return false
  const text = m[3]!.replace(/''/g, "'")
  const target = m[2]!.trim()
  if (m[1]!.toUpperCase() === 'TABLE') {
    out.comments.push({ table: unquoteIdentifier(target), column: null, text })
    return true
  }
  // COLUMN은 마지막 조각이 컬럼, 그 앞이 테이블이다.
  const parts = splitQualified(target)
  if (parts.length < 2) return false
  out.comments.push({
    table: parts[parts.length - 2]!, column: parts[parts.length - 1]!, text,
  })
  return true
}

/** 'a.b.c'를 따옴표를 존중하며 조각으로 나눈다(unquoteIdentifier의 다중 조각판). */
function splitQualified(raw: string): string[] {
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
        cur += raw[i]!; i++
      }
      continue
    }
    if (c === '.') { parts.push(cur.trim()); cur = ''; continue }
    cur += c
  }
  parts.push(cur.trim())
  return parts.filter((p) => p !== '')
}

export function parseDdl(ddl: string): ParsedDdl {
  const result: ParsedDdl = { tables: [], constraints: [], indexes: [], comments: [], skipped: [] }
  for (const stmt of splitStatements(ddl)) {
    if (parseCreateTable(stmt, result)) continue
    if (parseAlterTable(stmt, result)) continue
    if (parseCreateIndex(stmt, result)) continue
    if (parseCommentOn(stmt, result)) continue
    result.skipped.push({
      keyword: statementKeyword(stmt.text),
      line: stmt.line,
      excerpt: stmt.text.replace(/\s+/g, ' ').slice(0, 80),
    })
  }
  return result
}
