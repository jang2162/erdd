import type {
  ParsedColumn, ParsedComment, ParsedConstraint, ParsedDdl, ParsedIndex, ParsedTable,
  SkippedStatement,
} from './ddl-parse.js'
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
    }
  }
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
    if (typeof color === 'string') out.headerColors.set(name, color.trim())
  }

  const columns: ParsedColumn[] = []
  for (const item of splitItems(body, bodyLine)) {
    if (/^indexes\b/i.test(item.text)) continue
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
    else {
      out.skipped.push({
        keyword, line: startLine, excerpt: construct.replace(/\s+/g, ' ').trim().slice(0, 80),
      })
    }
    advance(end)
  }

  return {
    tables: out.tables, constraints: out.constraints, indexes: out.indexes,
    comments: out.comments, skipped: out.skipped,
    groups: out.groups, customValues: out.customValues, databaseType: out.databaseType,
  }
}
