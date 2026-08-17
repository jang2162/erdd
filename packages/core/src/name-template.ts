import type { NamingRules } from './naming.js'
import type { ProjectModel, Table } from './model.js'
import { resolveCustomValue } from './custom-field.js'

export type TemplateToken = { kind: 'lit'; text: string } | { kind: 'var'; name: string }

/** 템플릿을 리터럴·변수 토큰으로 쪼갠다. 짝이 안 맞는 중괄호는 리터럴로 남긴다(오류를 던지지 않는다). */
export function parseTemplate(template: string): TemplateToken[] {
  const tokens: TemplateToken[] = []
  let i = 0
  let lit = ''
  while (i < template.length) {
    const open = template.indexOf('{', i)
    if (open === -1) { lit += template.slice(i); break }
    const close = template.indexOf('}', open + 1)
    if (close === -1) { lit += template.slice(i); break }
    lit += template.slice(i, open)
    if (lit !== '') { tokens.push({ kind: 'lit', text: lit }); lit = '' }
    tokens.push({ kind: 'var', name: template.slice(open + 1, close) })
    i = close + 1
  }
  if (lit !== '') tokens.push({ kind: 'lit', text: lit })
  return tokens
}

const CUSTOM_PREFIX = '커스텀:'

/** 알 수 없는 변수는 빈 값이다 — 설정 화면 오타로 모델 전체가 죽으면 안 된다(설계 3.2). */
function resolveVar(name: string, table: Table, model: ProjectModel): string {
  const group = table.groupId === null ? undefined : model.tableGroups[table.groupId]
  if (name === '그룹별칭') return group?.alias ?? ''
  if (name === '그룹명') return group?.name ?? ''
  if (name === '물리명') return table.physicalName
  if (name === '논리명') return table.logicalName
  if (name.startsWith(CUSTOM_PREFIX)) {
    const fieldName = name.slice(CUSTOM_PREFIX.length)
    // 값 맵의 키가 UUID 라 사람이 쓸 수 없다 — 정의 이름으로 지목한다(설계 D4).
    const field = Object.values(model.customFields)
      .find((f) => f.target === 'table' && f.name === fieldName)
    // 값 > 정의 기본값 > '' 은 custom-field.ts 의 정책이다. 여기서 다시 짜지 않는다.
    return field === undefined ? '' : resolveCustomValue(table, field)
  }
  return ''
}

/**
 * 테이블의 최종 물리명. 산출물(DDL·DBML·Excel)과 검사(중복·길이·예약어)가 이것을 쓴다.
 *
 * ⚠️ **템플릿이 비면 physicalName 을 그대로 돌려준다.** 소비처가 「템플릿이 있는가」를 몰라도 되게
 * 하는 계약이다 — 분기가 소비처로 새면 스무 곳이 각자 판단하게 된다(설계 3.1).
 *
 * ⚠️ 빈 변수 규칙(설계 3.2): **빈 변수는 자기 자신과 바로 뒤의 리터럴을 함께 지운다. 뒤에 리터럴이
 * 없으면 바로 앞의 리터럴을 지운다.** 정규식 후처리로 흉내내지 않는다 — 구분자가 '_' 가 아닐 수 있고
 * 부분 이름 안의 연속 밑줄까지 접힌다.
 */
export function composeTablePhysicalName(
  table: Table, model: ProjectModel, rules: NamingRules,
): string {
  if (rules.tablePhysicalTemplate === '') return table.physicalName
  const tokens = parseTemplate(rules.tablePhysicalTemplate)
  const out: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!
    if (tok.kind === 'lit') { out.push(tok.text); continue }
    const value = resolveVar(tok.name, table, model)
    if (value !== '') { out.push(value); continue }
    const next = tokens[i + 1]
    if (next !== undefined && next.kind === 'lit') { i += 1; continue }  // 뒤 리터럴을 함께 건너뛴다
    if (tokens[i - 1]?.kind === 'lit') out.pop()                          // 없으면 앞 리터럴을 지운다
  }
  return out.join('')
}
