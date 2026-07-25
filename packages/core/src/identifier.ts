import type { Dialect } from './dialect.js'

// 흔히 물리명과 충돌하는 예약어(큐레이션, 확장 가능). 소문자로 저장하고 비교는 대소문자 무시.
const BASE = ['order','user','group','table','select','from','where','index','key','primary',
  'foreign','constraint','check','default','desc','asc','date','time','timestamp','level','type',
  'comment','column','value','values','case','when','then','end','null','into','set','join']
const EXTRA: Record<Dialect, string[]> = {
  postgresql: ['limit','offset','analyse','analyze'],
  mysql: ['rank','lead','lag','read','write','status'],
  oracle: ['number','rowid','session','access','audit'],
  mssql: ['identity','rowcount','proc','current'],
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
