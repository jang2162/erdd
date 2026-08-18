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
 * 조합 중간 조각. `lit` 은 「리터럴 토큰에서 왔는가」다.
 * ⚠️ 이 표시가 필요한 이유: 말미 밑줄을 지울 때 **변수 값은 건드리면 안 된다**(설계 D2).
 * 사용자가 물리명을 'ORD_' 로 넣었으면 그대로 나가야 한다.
 */
type Piece = { text: string; lit: boolean }

/**
 * 조각 배열 말미의 밑줄을 정리한다.
 *
 * ⚠️ **뒤에서부터 훑는 것이 급소다.** 직전 조각 하나만 보면 `TB_{A}_{B}` 에서 A·B 가 둘 다 빌 때
 * A 가 남긴 **빈 조각**에 막혀 `TB_` 가 나온다. 빈 조각을 버리며 계속 훑어야 `TB` 가 된다.
 */
function trimTrailingSeparator(out: Piece[]): void {
  for (let k = out.length - 1; k >= 0; k -= 1) {
    const p = out[k]!
    if (p.text === '') { out.pop(); continue }
    if (!p.lit) return                       // 변수 값 — 건드리지 않는다
    p.text = p.text.replace(/_+$/, '')
    if (p.text === '') out.pop()
    return
  }
}

/**
 * 테이블의 최종 물리명. 산출물(DDL·DBML·Excel)과 검사(중복·길이·예약어)가 이것을 쓴다.
 *
 * ⚠️ **템플릿이 비면 physicalName 을 그대로 돌려준다.** 소비처가 「템플릿이 있는가」를 몰라도 되게
 * 하는 계약이다 — 분기가 소비처로 새면 스무 곳이 각자 판단하게 된다(설계 3.1).
 *
 * ⚠️ 빈 변수 규칙(설계 D2): **빈 변수는 자기 자신과 바로 뒤 리터럴 선두의 밑줄들을 지운다. 뒤에
 * 리터럴이 없으면 바로 앞 리터럴 말미의 밑줄들을 지운다. 변수 값은 절대 건드리지 않는다.**
 * 정규식 후처리로 흉내내지 않는다 — 변수 값 안의 연속 밑줄(`A__B`)까지 접힌다.
 */
export function composeTablePhysicalName(
  table: Table, model: ProjectModel, rules: NamingRules,
): string {
  if (rules.tablePhysicalTemplate === '') return table.physicalName
  const tokens = parseTemplate(rules.tablePhysicalTemplate)
  const out: Piece[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!
    if (tok.kind === 'lit') { out.push({ text: tok.text, lit: true }); continue }
    const value = resolveVar(tok.name, table, model)
    if (value !== '') { out.push({ text: value, lit: false }); continue }
    const next = tokens[i + 1]
    if (next !== undefined && next.kind === 'lit') {
      // 뒤 리터럴을 통째로 버리지 않는다 — 선두 밑줄만 지우고 낱말은 남긴다.
      out.push({ text: next.text.replace(/^_+/, ''), lit: true })
      i += 1
      continue
    }
    trimTrailingSeparator(out)
  }
  return out.map((p) => p.text).join('')
}
