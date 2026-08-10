import type {
  ParsedColumn, ParsedComment, ParsedConstraint, ParsedDdl, ParsedIndex, ParsedTable,
  SkippedStatement,
} from './ddl-parse.js'
import type { Dialect } from './dialect.js'
import { splitDbmlNote } from './dbml-note.js'

export type ParsedGroup = { name: string; color: string | null; tables: string[] }
export type ParsedCustomValue = {
  table: string; column: string | null; values: Record<string, string>
}
export type ParsedDbml = ParsedDdl & {
  groups: ParsedGroup[]
  customValues: ParsedCustomValue[]
  databaseType: string | null
}

/** Project { database_type } 원문 → 방언. 모르면 null. */
export function dialectFromDatabaseType(s: string): Dialect | null {
  const v = s.trim().toLowerCase()
  if (v.startsWith('postgres')) return 'postgresql'
  if (v === 'mysql' || v === 'mariadb') return 'mysql'
  if (v === 'oracle') return 'oracle'
  if (v === 'sql server' || v === 'mssql' || v === 'sqlserver') return 'mssql'
  return null
}

/** DBML 설정 값 → 모델의 defaultValue 원문. rawDefaultToDbml 의 역(설계 §4.2). */
export function dbmlDefaultToRaw(token: string): string {
  const t = token.trim()
  if (t.startsWith('`') && t.endsWith('`') && t.length >= 2) return t.slice(1, -1)
  if (/^'''/.test(t)) return `'${t.slice(3, -3)}'`
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
    return `'${t.slice(1, -1).replace(/\\'/g, "''")}'`
  }
  if (/^true$/i.test(t)) return 'TRUE'
  if (/^false$/i.test(t)) return 'FALSE'
  if (/^null$/i.test(t)) return 'NULL'
  return t
}

/**
 * 따옴표 구간(`'…'`·`'''…'''`·`"…"`·`` `…` ``)의 끝 **다음** 인덱스를 낸다.
 * 렉싱하는 모든 자리(주석 제거·항목 분리·설정 분리)가 이 하나를 공유해야
 * 문자열 안의 구분자를 어느 한 경로에서만 놓치는 일이 없다.
 */
function skipQuoted(s: string, i: number): number {
  const c = s[i]!
  const triple = c === "'" && s.startsWith("'''", i)
  const close = triple ? "'''" : c
  let j = i + (triple ? 3 : 1)
  while (j < s.length) {
    if (s[j] === '\\') { j += 2; continue }
    if (s.startsWith(close, j)) return j + close.length
    j++
  }
  return s.length
}

/**
 * 주석(`//`, `/* *\/`)을 공백으로 치환한다. 문자열·백틱·따옴표 식별자 안은 건드리지 않고,
 * 길이와 줄 수를 그대로 보존한다 — 줄 번호를 경고에 쓰기 때문이다.
 */
function stripComments(src: string): string {
  const s = src.replace(/\r\n?/g, '\n')
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]!
    if (c === "'" || c === '"' || c === '`') {
      const end = skipQuoted(s, i)
      out += s.slice(i, end)
      i = end
      continue
    }
    if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') { out += ' '; i++ }
      continue
    }
    if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2)
      const stop = end < 0 ? s.length : end + 2
      for (; i < stop; i++) out += s[i] === '\n' ? '\n' : ' '
      continue
    }
    out += c
    i++
  }
  return out
}

function unescapeDbml(s: string): string {
  return s.replace(/\\(['"\\ntr])/g, (_, c: string) =>
    c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c)
}

/** 문자열·따옴표 식별자를 벗긴다. 트리플 쿼트의 내용은 개행째 그대로 살린다. */
function unquote(raw: string): string {
  const t = raw.trim()
  if (t.startsWith("'''") && t.endsWith("'''") && t.length >= 6) return unescapeDbml(t.slice(3, -3))
  if (t.length >= 2 && (
    (t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))
  )) return unescapeDbml(t.slice(1, -1))
  if (t.length >= 2 && t.startsWith('`') && t.endsWith('`')) return t.slice(1, -1)
  return t
}

const IDENT_STOP = /^[^\s.,()[\]{}:'"`]+/

function readIdent(s: string, from: number): { name: string; end: number } | null {
  let i = from
  while (i < s.length && /\s/.test(s[i]!)) i++
  if (i >= s.length) return null
  const c = s[i]!
  if (c === '"' || c === '`') {
    const end = skipQuoted(s, i)
    return { name: unescapeDbml(s.slice(i + 1, Math.max(i + 1, end - 1))), end }
  }
  const m = IDENT_STOP.exec(s.slice(i))
  if (!m) return null
  return { name: m[0], end: i + m[0].length }
}

/** 문자열·괄호 안을 건너뛰며 최상위 구분자로 자른다. */
function splitTop(src: string, sep: string): string[] {
  const out: string[] = []
  let depth = 0
  let buf = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === "'" || c === '"' || c === '`') {
      const e = skipQuoted(src, i)
      buf += src.slice(i, e)
      i = e
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === sep && depth === 0) { out.push(buf); buf = ''; i++; continue }
    buf += c
    i++
  }
  out.push(buf)
  return out.map((x) => x.trim()).filter((x) => x !== '')
}

type Settings = Map<string, string | true>

/** `[a, b: 'c']` 의 안쪽을 설정 맵으로. 키는 소문자 + 공백 1개로 정규화한다. */
function parseSettings(src: string): Settings {
  const out: Settings = new Map()
  for (const item of splitTop(src, ',')) {
    const idx = topLevelIndexOf(item, ':')
    if (idx < 0) {
      out.set(normKey(item), true)
      continue
    }
    out.set(normKey(item.slice(0, idx)), item.slice(idx + 1).trim())
  }
  return out
}

function normKey(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** 문자열·괄호 밖에서 처음 나오는 문자의 인덱스. 없으면 -1. */
function topLevelIndexOf(src: string, ch: string): number {
  let depth = 0
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (c === "'" || c === '"' || c === '`') { i = skipQuoted(src, i); continue }
    // 찾는 문자가 괄호일 수 있으므로(예: `[`) 깊이 갱신보다 먼저 본다.
    if (c === ch && depth === 0) return i
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    i++
  }
  return -1
}

type Item = { text: string; line: number }

/** 블록 본문을 항목으로 나눈다. 중첩 블록(`indexes { … }`)은 한 항목으로 묶인다. */
function splitItems(body: string, startLine: number): Item[] {
  const out: Item[] = []
  let depth = 0
  let buf = ''
  let line = startLine
  let itemLine = startLine
  let i = 0
  const flush = () => {
    const text = buf.trim()
    if (text !== '') out.push({ text, line: itemLine })
    buf = ''
    itemLine = line
  }
  while (i < body.length) {
    const c = body[i]!
    if (c === "'" || c === '"' || c === '`') {
      const e = skipQuoted(body, i)
      const chunk = body.slice(i, e)
      if (buf.trim() === '') itemLine = line
      buf += chunk
      line += (chunk.match(/\n/g) ?? []).length
      i = e
      continue
    }
    if (c === '\n') {
      line++
      if (depth === 0) flush()
      else buf += c
      i++
      continue
    }
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    if (buf.trim() === '' && !/\s/.test(c)) itemLine = line
    buf += c
    i++
  }
  flush()
  return out
}

/** 문자열을 건너뛰며 짝이 맞는 닫는 중괄호를 찾는다. 없으면 -1. */
function matchBrace(s: string, open: number): number {
  let depth = 0
  let i = open
  while (i < s.length) {
    const c = s[i]!
    if (c === "'" || c === '"' || c === '`') { i = skipQuoted(s, i); continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return i }
    i++
  }
  return -1
}

type Out = {
  tables: ParsedTable[]
  constraints: ParsedConstraint[]
  indexes: ParsedIndex[]
  comments: ParsedComment[]
  skipped: SkippedStatement[]
  groups: ParsedGroup[]
  customValues: ParsedCustomValue[]
  databaseType: string | null
  headerColors: Map<string, string>
}

/** note 문자열을 설명(comments)과 커스텀 값(customValues)으로 나눠 담는다. */
function takeNote(out: Out, table: string, column: string | null, raw: string): void {
  const { logicalName, comment, custom } = splitDbmlNote(unquote(raw))
  const head = comment === null ? logicalName : `${logicalName} - ${comment}`
  if (head.trim() !== '') out.comments.push({ table, column, text: head.trim() })
  if (Object.keys(custom).length > 0) out.customValues.push({ table, column, values: custom })
}

type RefSide = { table: string; columns: string[] }

/** `테이블.컬럼` 또는 `테이블.(컬럼, 컬럼)`. */
function parseRefSide(text: string): RefSide | null {
  const id = readIdent(text, 0)
  if (id === null) return null
  let i = id.end
  while (i < text.length && /\s/.test(text[i]!)) i++
  if (text[i] !== '.') return null
  i++
  while (i < text.length && /\s/.test(text[i]!)) i++
  if (text[i] === '(') {
    const close = text.lastIndexOf(')')
    if (close < 0) return null
    const cols: string[] = []
    for (const part of splitTop(text.slice(i + 1, close), ',')) {
      const c = readIdent(part, 0)
      if (c === null) return null
      cols.push(c.name)
    }
    return { table: id.name, columns: cols }
  }
  const col = readIdent(text, i)
  if (col === null) return null
  return { table: id.name, columns: [col.name] }
}

/** 최상위(문자열·괄호 밖)에서 관계 연산자를 찾는다. 앞이 공백이어야 이름 속 `-` 와 갈리지 않는다. */
function findRefOperator(expr: string): { op: string; index: number } | null {
  let depth = 0
  let i = 0
  while (i < expr.length) {
    const c = expr[i]!
    if (c === "'" || c === '"' || c === '`') { i = skipQuoted(expr, i); continue }
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (depth === 0 && (c === '<' || c === '>' || c === '-')
             && (i === 0 || /\s/.test(expr[i - 1]!))) {
      if (c === '<' && expr[i + 1] === '>') return { op: '<>', index: i }
      return { op: c, index: i }
    }
    i++
  }
  return null
}

/**
 * `좌 <연산자> 우` 를 **항상 자식→부모 방향의 fk 제약**으로 정규화한다.
 * `>` 와 `-` 는 왼쪽이 자식, `<` 는 오른쪽이 자식이다(뒤집는다).
 * `-` 는 oneToOne 으로 표시만 하고 UNIQUE 를 만들지 않는다(설계 §4.3).
 */
function parseRefExpr(out: Out, expr: string, name: string | null, line: number): void {
  const found = findRefOperator(expr)
  if (found === null) return
  if (found.op === '<>') {
    out.skipped.push({
      keyword: 'Ref(<>)', line, excerpt: expr.replace(/\s+/g, ' ').trim().slice(0, 80),
    })
    return
  }
  const left = parseRefSide(expr.slice(0, found.index).trim())
  const right = parseRefSide(expr.slice(found.index + found.op.length).trim())
  if (left === null || right === null) return
  const [child, parent] = found.op === '<' ? [right, left] : [left, right]
  if (child.columns.length !== parent.columns.length) return
  out.constraints.push({
    kind: 'fk', table: child.table, name, columns: child.columns,
    refTable: parent.table, refColumns: parent.columns, oneToOne: found.op === '-',
  })
}

/** 컬럼 설정의 인라인 `ref: > 대상`. 왼쪽은 그 컬럼이므로 오른쪽만 파싱한다. */
function parseInlineRef(
  out: Out, table: string, column: string, value: string, line: number,
): void {
  parseRefExpr(out, `${quoteName(table)}.${quoteName(column)} ${value.trim()}`, null, line)
}

function quoteName(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** `indexes { … }` 블록. `[pk]` 는 PK 제약으로, 나머지는 인덱스로 낸다. */
function parseIndexesBlock(out: Out, table: string, item: Item): void {
  const open = item.text.indexOf('{')
  if (open < 0) return
  const close = matchBrace(item.text, open)
  const body = item.text.slice(open + 1, close < 0 ? item.text.length : close)
  let auto = 0
  for (const line of splitItems(body, item.line)) {
    const br = topLevelIndexOf(line.text, '[')
    const head = (br < 0 ? line.text : line.text.slice(0, br)).trim()
    const settings = br < 0
      ? new Map<string, string | true>()
      : parseSettings(line.text.slice(br + 1, Math.max(br + 1, line.text.lastIndexOf(']'))))

    // 백틱 표현식 인덱스는 컬럼으로 해소되지 않는다 — 인덱스를 만들지 않고 건너뛴다.
    if (head.includes('`')) {
      out.skipped.push({
        keyword: 'indexes(expression)', line: line.line,
        excerpt: line.text.replace(/\s+/g, ' ').trim().slice(0, 80),
      })
      continue
    }
    const columns: string[] = []
    if (head.startsWith('(')) {
      const end = head.lastIndexOf(')')
      for (const part of splitTop(head.slice(1, end < 0 ? head.length : end), ',')) {
        const c = readIdent(part, 0)
        if (c !== null) columns.push(c.name)
      }
    } else {
      const c = readIdent(head, 0)
      if (c !== null) columns.push(c.name)
    }
    if (columns.length === 0) continue

    if (settings.has('pk')) {
      out.constraints.push({ kind: 'pk', table, columns })
      continue
    }
    const nameSetting = settings.get('name')
    const name = typeof nameSetting === 'string' ? unquote(nameSetting) : `IX_${table}_${++auto}`
    out.indexes.push({ table, name, columns, unique: settings.has('unique') })
  }
}

/** `TableGroup 이름 [color: …] { 테이블… }`. 색은 뒤에서 headercolor 로 떨어질 수 있다. */
function parseTableGroupBlock(out: Out, header: string, body: string, bodyLine: number): void {
  const id = readIdent(header, 0)
  if (id === null) return
  const rest = header.slice(id.end)
  const br = topLevelIndexOf(rest, '[')
  let color: string | null = null
  if (br >= 0) {
    const settings = parseSettings(rest.slice(br + 1, Math.max(br + 1, rest.lastIndexOf(']'))))
    const c = settings.get('color')
    if (typeof c === 'string') color = c.trim()
  }
  const tables: string[] = []
  for (const item of splitItems(body, bodyLine)) {
    if (/^note\s*:/i.test(item.text)) continue
    const t = readIdent(item.text, 0)
    if (t !== null) tables.push(t.name)
  }
  out.groups.push({ name: id.name, color, tables })
}

function parseColumnItem(out: Out, table: string, item: Item): ParsedColumn | null {
  const id = readIdent(item.text, 0)
  if (id === null) return null
  const rest = item.text.slice(id.end)
  const br = topLevelIndexOf(rest, '[')
  const rawType = (br < 0 ? rest : rest.slice(0, br)).trim()
  if (rawType === '') return null
  const settings = br < 0
    ? new Map<string, string | true>()
    : parseSettings(rest.slice(br + 1, Math.max(br + 1, rest.lastIndexOf(']'))))

  const col: ParsedColumn = {
    name: id.name, rawType, notNull: false, defaultValue: null,
    autoIncrement: false, inlinePk: false, comment: null,
  }
  for (const [key, value] of settings) {
    if (key === 'pk' || key === 'primary key') col.inlinePk = true
    else if (key === 'not null') col.notNull = true
    else if (key === 'null') col.notNull = false
    else if (key === 'increment') col.autoIncrement = true
    else if (key === 'unique') {
      out.constraints.push({ kind: 'unique', table, name: null, columns: [col.name] })
    } else if (key === 'default' && typeof value === 'string') {
      col.defaultValue = dbmlDefaultToRaw(value)
    } else if (key === 'note' && typeof value === 'string') {
      takeNote(out, table, col.name, value)
    } else if (key === 'ref' && typeof value === 'string') {
      parseInlineRef(out, table, col.name, value, item.line)
    }
  }
  // 컬럼 설정 `[pk]` 는 **테이블 수준 pk 제약으로도** 낸다. DDL 파서가 인라인 PRIMARY KEY 를
  // 같은 방식으로 정규화하고(`ddl-parse.ts` 의 `if (col.inlinePk) out.constraints.push(...)`),
  // 그 뒤 파이프라인의 여러 판정이 `inlinePk` 가 아니라 **pk 제약**(`pkOf`)만 본다 —
  // 관계의 identifying 재추론, PK 와 컬럼이 같은 유니크 인덱스 제외, 참조 컬럼을 생략한 FK 의
  // 부모 PK 해소가 전부 그렇다. 여기서 정규화하지 않으면 단일 PK 테이블에서 그 판정이 전부
  // 어긋난다(리뷰 M-1: 식별 관계가 통째로 비식별로 뒤집혔다).
  // `inlinePk` 는 그대로 둔다 — 컬럼의 `isPk` 판정이 그것도 함께 본다.
  if (col.inlinePk) out.constraints.push({ kind: 'pk', table, columns: [col.name] })
  return col
}

function parseTableBlock(out: Out, header: string, body: string, bodyLine: number): void {
  const id = readIdent(header, 0)
  if (id === null) return
  const name = id.name
  const rest = header.slice(id.end)
  const br = topLevelIndexOf(rest, '[')
  if (br >= 0) {
    const settings = parseSettings(rest.slice(br + 1, Math.max(br + 1, rest.lastIndexOf(']'))))
    const note = settings.get('note')
    if (typeof note === 'string') takeNote(out, name, null, note)
    const color = settings.get('headercolor')
    if (typeof color === 'string') out.headerColors.set(name.toUpperCase(), color.trim())
  }

  const columns: ParsedColumn[] = []
  for (const item of splitItems(body, bodyLine)) {
    if (/^indexes\b/i.test(item.text)) { parseIndexesBlock(out, name, item); continue }
    if (/^note\s*:/i.test(item.text)) {
      takeNote(out, name, null, item.text.slice(item.text.indexOf(':') + 1))
      continue
    }
    const col = parseColumnItem(out, name, item)
    if (col !== null) columns.push(col)
  }
  out.tables.push({ name, columns })
}

function parseProjectBlock(out: Out, body: string, bodyLine: number): void {
  for (const item of splitItems(body, bodyLine)) {
    const m = /^database_type\s*:/i.exec(item.text)
    if (m) out.databaseType = unquote(item.text.slice(m[0].length))
  }
}

/**
 * DBML 텍스트를 파싱한다. 결과는 DDL 파서와 같은 `ParsedDdl` 어휘(+ DBML 고유 3필드)라
 * 그 뒤 파이프라인(planDdlImport → applyDdlImport)을 그대로 탄다.
 * 손으로 쓴 좁은 파서다 — core 는 IO·런타임 의존성 free 이므로 외부 파서를 쓰지 않는다.
 */
export function parseDbml(text: string): ParsedDbml {
  const s = stripComments(text)
  const out: Out = {
    tables: [], constraints: [], indexes: [], comments: [], skipped: [],
    groups: [], customValues: [], databaseType: null, headerColors: new Map(),
  }

  let i = 0
  let line = 1
  const advance = (to: number) => {
    line += (s.slice(i, to).match(/\n/g) ?? []).length
    i = to
  }

  while (i < s.length) {
    if (/\s/.test(s[i]!)) { advance(i + 1); continue }
    const kw = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i))
    if (!kw) { advance(i + 1); continue }
    const keyword = kw[0]
    const startLine = line
    const afterKw = i + keyword.length

    // `{` 가 나올 때까지 훑는다. 줄이 끝나고 그 다음 비공백이 `{` 가 아니면 한 줄짜리 구문이다.
    let j = afterKw
    let brace = -1
    let lineEnd = -1
    while (j < s.length) {
      const c = s[j]!
      if (c === "'" || c === '"' || c === '`') { j = skipQuoted(s, j); continue }
      if (c === '{') { brace = j; break }
      if (c === '\n') {
        const nxt = /\S/.exec(s.slice(j))
        if (nxt && s[j + nxt.index] === '{') { j += nxt.index; continue }
        lineEnd = j
        break
      }
      j++
    }

    let end: number
    let header = ''
    let body = ''
    let bodyLine = startLine
    if (brace >= 0) {
      const close = matchBrace(s, brace)
      end = close < 0 ? s.length : close + 1
      header = s.slice(afterKw, brace)
      body = s.slice(brace + 1, close < 0 ? s.length : close)
      bodyLine = startLine + (s.slice(i, brace + 1).match(/\n/g) ?? []).length
    } else {
      end = lineEnd < 0 ? s.length : lineEnd
      header = s.slice(afterKw, end)
    }

    const construct = s.slice(i, end)
    const lower = keyword.toLowerCase()
    if (lower === 'table' && brace >= 0) parseTableBlock(out, header, body, bodyLine)
    else if (lower === 'project' && brace >= 0) parseProjectBlock(out, body, bodyLine)
    else if (lower === 'tablegroup' && brace >= 0) parseTableGroupBlock(out, header, body, bodyLine)
    else if (lower === 'ref') {
      if (brace >= 0) {
        // 블록형 `Ref { 좌 > 우 }`. 줄마다 같은 줄 파서를 태운다.
        for (const item of splitItems(body, bodyLine)) parseRefExpr(out, item.text, null, item.line)
      } else {
        const colon = topLevelIndexOf(header, ':')
        const named = colon < 0 ? null : readIdent(header.slice(0, colon), 0)
        const expr = colon < 0 ? header : header.slice(colon + 1)
        parseRefExpr(out, expr.trim(), named?.name ?? null, startLine)
      }
    } else {
      out.skipped.push({
        keyword, line: startLine, excerpt: construct.replace(/\s+/g, ' ').trim().slice(0, 80),
      })
    }
    advance(end)
  }

  // 그룹 색: TableGroup [color:] → 먼저 나온 소속 테이블의 headercolor → null.
  // Table 블록이 TableGroup 뒤에 올 수 있으므로 전체 스캔이 끝난 뒤에 해소한다.
  for (const g of out.groups) {
    if (g.color !== null) continue
    for (const t of g.tables) {
      const c = out.headerColors.get(t.toUpperCase())
      if (c !== undefined) { g.color = c; break }
    }
  }

  return {
    tables: out.tables, constraints: out.constraints, indexes: out.indexes,
    comments: out.comments, skipped: out.skipped,
    groups: out.groups, customValues: out.customValues, databaseType: out.databaseType,
  }
}
