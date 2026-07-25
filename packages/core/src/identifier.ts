import type { Dialect } from './dialect.js'

// 네 방언 모두에서 예약어라 식별자로 쓰면 대체로 오류가 나는 표준 예약어(큐레이션, 확장 가능).
// 소문자로 저장하고 비교는 대소문자 무시. 흔한 컬럼명(type/value/status/comment/name/date/time 등)은
// 대부분 방언에서 비예약이므로 여기 넣지 않는다 — 불필요한 인용(노이즈·PG/Oracle의 case-fold 강제)을 피한다.
// 방언별로만 예약인 단어는 EXTRA에 둔다.
const BASE = ['order','user','group','table','select','from','where','index','key','primary',
  'foreign','references','constraint','unique','check','default','column','into','values',
  'insert','update','delete','create','alter','drop','set','join','on','and','or','not','null',
  'as','in','is','like','between','distinct','having','union','all','case','when','then','else',
  'end','exists','desc','asc']
const EXTRA: Record<Dialect, string[]> = {
  postgresql: ['limit','offset','analyse','analyze'],
  mysql: ['limit','rank','lag','lead','read','write','system','interval','change','fulltext'],
  oracle: ['date','level','number','comment','rowid','session','access','audit','resource','mode'],
  mssql: ['identity','current','top','percent','pivot','merge','output','function','backup','proc','rowcount'],
}
const RESERVED: Record<Dialect, Set<string>> = {
  postgresql: new Set([...BASE, ...EXTRA.postgresql]),
  mysql: new Set([...BASE, ...EXTRA.mysql]),
  oracle: new Set([...BASE, ...EXTRA.oracle]),
  mssql: new Set([...BASE, ...EXTRA.mssql]),
}

const SAFE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** 예약어이거나 안전패턴 위반 시에만 방언 규칙으로 인용한다. */
export function quoteIdentifier(name: string, dialect: Dialect): string {
  const needs = !SAFE.test(name) || RESERVED[dialect].has(name.toLowerCase())
  if (!needs) return name
  switch (dialect) {
    case 'postgresql':
    case 'oracle':
      return `"${name.replace(/"/g, '""')}"`
    case 'mysql':
      return '`' + name.replace(/`/g, '``') + '`'
    case 'mssql':
      return `[${name.replace(/]/g, ']]')}]`
  }
}
