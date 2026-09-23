import { DIALECTS, type Dialect } from '../dialect.js'
import type { ColumnChange, DialectTypes } from './types.js'

// ── 값 표기 — guide 「문법」. 직렬화와 파서가 이 파일 하나를 공유한다 ──

const BARE_IDENT = /^[A-Za-z_][A-Za-z0-9_$#]*$/
const BARE_TYPE = /^[A-Za-z][A-Za-z0-9_]*(\([^()"\n\r]*\))?$/
/** 값 자리의 키워드. 같은 이름의 식별자는 큰따옴표로 감싸 키워드와 갈라진다. */
const VALUE_KEYWORDS = new Set(['first', 'none'])

function escape(s: string, quote: '"' | "'" | '`'): string {
  let out = ''
  for (const ch of s) {
    if (ch === '\\') out += '\\\\'
    else if (ch === quote) out += `\\${quote}`
    else if (ch === '\n') out += '\\n'
    else if (ch === '\r') out += '\\r'
    else out += ch
  }
  return out
}

export const fmtIdent = (s: string): string =>
  BARE_IDENT.test(s) && !VALUE_KEYWORDS.has(s) ? s : `"${escape(s, '"')}"`
export const fmtType = (s: string): string => (BARE_TYPE.test(s) ? s : `"${escape(s, '"')}"`)
export const fmtString = (s: string): string => `'${escape(s, "'")}'`
export const fmtRaw = (s: string): string => `\`${escape(s, '`')}\``
const fmtBool = (b: boolean): string => (b ? 'yes' : 'no')
export const fmtNullableString = (s: string | null): string => (s === null ? 'none' : fmtString(s))
const fmtDefault = (s: string | null): string => (s === null ? 'none' : fmtRaw(s))
export const fmtIdentList = (names: readonly string[]): string =>
  names.length === 0 ? 'none' : `(${names.map(fmtIdent).join(', ')})`
export const fmtCheckList = (values: readonly string[]): string =>
  values.length === 0 ? 'none' : `(${values.map(fmtString).join(', ')})`
function fmtDialects(d: DialectTypes): string {
  const parts = DIALECTS.flatMap((k) => (d[k] === undefined ? [] : [`${k}: ${fmtType(d[k])}`]))
  return parts.length === 0 ? 'none' : `(${parts.join(', ')})`
}
const fmtPosition = (after: string | null): string => (after === null ? 'first' : `after ${fmtIdent(after)}`)

/** modify column 의 이전·이후 값. 경합 경고도 이 표기로 현재 값을 보여 준다. */
export function fmtFieldValue(field: ColumnChange['field'], v: unknown): string {
  switch (field) {
    case 'type': return fmtType(v as string)
    case 'dialects': return fmtDialects(v as DialectTypes)
    case 'nullable':
    case 'increment': return fmtBool(v as boolean)
    case 'default': return fmtDefault(v as string | null)
    case 'comment': return fmtNullableString(v as string | null)
    case 'check': return fmtCheckList(v as string[])
    case 'position': return fmtPosition(v as string | null)
  }
}

// ── 파서 커서 — 한 줄 안을 읽는다 ──

export class ParseFailure extends Error {
  constructor(readonly line: number, message: string) {
    super(message)
    this.name = 'ParseFailure'
  }
}

const IDENT_CHAR = /[A-Za-z0-9_$#]/

export class Cursor {
  #pos = 0
  constructor(readonly text: string, readonly line: number) {}

  fail(message: string): never { throw new ParseFailure(this.line, message) }

  #ws(): void {
    while (this.#pos < this.text.length && (this.text[this.#pos] === ' ' || this.text[this.#pos] === '\t')) this.#pos += 1
  }
  #rest(): string { return this.text.slice(this.#pos) }
  #near(): string {
    const r = this.#rest().trim()
    return r === '' ? '줄 끝' : `'${r.slice(0, 24)}'`
  }

  atEnd(): boolean { this.#ws(); return this.#pos >= this.text.length }
  end(): void { if (!this.atEnd()) this.fail(`줄 끝이어야 하는데 ${this.#near()} 이(가) 있습니다`) }

  /** 단어 경계까지 맞는 키워드. 공백으로 나뉜 여러 단어(`not null`, `drop foreign key`)도 받는다. */
  tryWord(word: string): boolean {
    this.#ws()
    let pos = this.#pos
    for (const [i, part] of word.split(' ').entries()) {
      if (i > 0) {
        const m = /^[ \t]+/.exec(this.text.slice(pos))
        if (m === null) return false
        pos += m[0].length
      }
      if (!this.text.startsWith(part, pos)) return false
      pos += part.length
    }
    const next = this.text[pos]
    if (next !== undefined && IDENT_CHAR.test(next)) return false
    this.#pos = pos
    return true
  }
  word(word: string): void {
    if (!this.tryWord(word)) this.fail(`'${word}' 이(가) 와야 하는데 ${this.#near()} 이(가) 있습니다`)
  }
  trySymbol(sym: string): boolean {
    this.#ws()
    if (!this.text.startsWith(sym, this.#pos)) return false
    this.#pos += sym.length
    return true
  }
  symbol(sym: string): void {
    if (!this.trySymbol(sym)) this.fail(`'${sym}' 이(가) 와야 하는데 ${this.#near()} 이(가) 있습니다`)
  }

  #quoted(quote: '"' | "'" | '`', what: string): string {
    let out = ''
    let i = this.#pos + 1
    for (;;) {
      const ch = this.text[i]
      if (ch === undefined) this.fail(`${what}의 닫는 ${quote} 가 없습니다`)
      if (ch === quote) { this.#pos = i + 1; return out }
      if (ch === '\\') {
        const nx = this.text[i + 1]
        if (nx === 'n') out += '\n'
        else if (nx === 'r') out += '\r'
        else if (nx === '\\' || nx === quote) out += nx
        else this.fail(`${what} 안의 알 수 없는 이스케이프입니다: \\${nx ?? ''}`)
        i += 2
        continue
      }
      out += ch
      i += 1
    }
  }

  ident(): string {
    this.#ws()
    if (this.text[this.#pos] === '"') return this.#quoted('"', '이름')
    const m = /^[A-Za-z_][A-Za-z0-9_$#]*/.exec(this.#rest())
    if (m === null) this.fail(`이름이 와야 하는데 ${this.#near()} 이(가) 있습니다`)
    this.#pos += m[0].length
    return m[0]
  }
  type(): string {
    this.#ws()
    if (this.text[this.#pos] === '"') return this.#quoted('"', '타입')
    const m = /^[A-Za-z][A-Za-z0-9_]*(\([^()"\n\r]*\))?/.exec(this.#rest())
    if (m === null) this.fail(`타입이 와야 하는데 ${this.#near()} 이(가) 있습니다`)
    this.#pos += m[0].length
    return m[0]
  }
  string(): string {
    this.#ws()
    if (this.text[this.#pos] !== "'") this.fail(`'…' 문자열이 와야 하는데 ${this.#near()} 이(가) 있습니다`)
    return this.#quoted("'", '문자열')
  }
  raw(): string {
    this.#ws()
    if (this.text[this.#pos] !== '`') this.fail(`\`…\` 기본값이 와야 하는데 ${this.#near()} 이(가) 있습니다`)
    return this.#quoted('`', '기본값')
  }
  integer(): number {
    this.#ws()
    const m = /^\d+/.exec(this.#rest())
    if (m === null) this.fail(`숫자가 와야 하는데 ${this.#near()} 이(가) 있습니다`)
    this.#pos += m[0].length
    return Number(m[0])
  }

  bool(): boolean {
    if (this.tryWord('yes')) return true
    if (this.tryWord('no')) return false
    return this.fail(`yes 또는 no 가 와야 하는데 ${this.#near()} 이(가) 있습니다`)
  }
  trueFalse(): boolean {
    if (this.tryWord('true')) return true
    if (this.tryWord('false')) return false
    return this.fail(`true 또는 false 가 와야 하는데 ${this.#near()} 이(가) 있습니다`)
  }
  nullableString(): string | null { return this.tryWord('none') ? null : this.string() }
  defaultValue(): string | null { return this.tryWord('none') ? null : this.raw() }
  identList(): string[] {
    if (this.tryWord('none')) return []
    this.symbol('(')
    const out = [this.ident()]
    while (this.trySymbol(',')) out.push(this.ident())
    this.symbol(')')
    return out
  }
  checkList(): string[] {
    if (this.tryWord('none')) return []
    this.symbol('(')
    const out = [this.string()]
    while (this.trySymbol(',')) out.push(this.string())
    this.symbol(')')
    return out
  }
  tryDialect(): Dialect | null {
    for (const d of DIALECTS) if (this.tryWord(d)) return d
    return null
  }
  dialects(): DialectTypes {
    if (this.tryWord('none')) return {}
    this.symbol('(')
    const out: DialectTypes = {}
    do {
      const d = this.tryDialect()
      if (d === null) this.fail(`방언 이름(${DIALECTS.join('·')})이 와야 하는데 ${this.#near()} 이(가) 있습니다`)
      this.symbol(':')
      out[d] = this.type()
    } while (this.trySymbol(','))
    this.symbol(')')
    return out
  }
  position(): string | null {
    if (this.tryWord('first')) return null
    this.word('after')
    return this.ident()
  }
}
