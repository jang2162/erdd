import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { needsExplicitNullToken, resolveColumn } from './domain-resolve.js'

function base(): ProjectModel {
  const m = createEmptyModel()
  m.tables['t'] = { id: 't', logicalName: 'T', physicalName: 'T', comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
  return m
}
const col = (over = {}) => ({ id: 'c', tableId: 't', logicalName: 'A', physicalName: 'A',
  type: 'INT', isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
  order: 0, comment: null, domainId: null, custom: {}, ...over })

describe('resolveColumn', () => {
  it('직접입력 컬럼은 타입을 그대로 변환', () => {
    const m = base(); m.columns['c'] = col({ type: 'VARCHAR(10)' })
    expect(resolveColumn(m.columns['c']!, m, 'postgresql').sql).toBe('varchar(10)')
  })
  it('도메인 컬럼은 방언 오버라이드 우선, 없으면 논리타입 변환', () => {
    const m = base()
    m.domains['d'] = { id: 'd', name: '금액', category: null, logicalType: 'DECIMAL(15,0)',
      dialectTypes: { postgresql: 'numeric(15)', mysql: null, oracle: null, mssql: null },
      defaultValue: '0', allowedValues: [], description: null, origin: null }
    m.columns['c'] = col({ domainId: 'd', defaultValue: null })
    expect(resolveColumn(m.columns['c']!, m, 'postgresql').sql).toBe('numeric(15)')
    expect(resolveColumn(m.columns['c']!, m, 'mysql').sql).toBe('DECIMAL(15,0)') // 논리타입 변환
    expect(resolveColumn(m.columns['c']!, m, 'postgresql').defaultValue).toBe('0') // 도메인 기본값
    expect(resolveColumn(m.columns['c']!, m, 'postgresql').logicalType).toBe('DECIMAL(15,0)')
  })
  it('컬럼 defaultValue가 도메인보다 우선', () => {
    const m = base()
    m.domains['d'] = { id: 'd', name: '여부', category: null, logicalType: 'CHAR(1)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: "'N'", allowedValues: ['Y', 'N'], description: null, origin: null }
    m.columns['c'] = col({ domainId: 'd', type: 'INT', defaultValue: "'Y'" })
    const r = resolveColumn(m.columns['c']!, m, 'postgresql')
    expect(r.defaultValue).toBe("'Y'")
    expect(r.checkValues).toEqual(['Y', 'N'])
  })
})

// ── needsExplicitNullToken ──────────────────────────────────────────────

/*
 * ddl.ts 와 dbml.ts 가 공유하는 판정이다. 아래 다섯은 판정식의 조각(방언 · 타입 정규식 · `\b` ·
 * `i` · `.trim()`)을 **하나씩 단독으로** 잠그고, 마지막 하나는 `\b` 를 「강화」하지 못하게 막는다.
 * ⚠️ 한 테스트가 두 조각을 함께 잠그게 만들지 마라 — 이중 방어를 넣으면 어느 조각을 지웠을 때
 * 무엇이 걸린 것인지 구분되지 않아 각 조각의 구분력이 함께 사라진다.
 */
describe('needsExplicitNullToken', () => {
  it('mysql 의 TIMESTAMP 에는 필요하다', () => {
    expect(needsExplicitNullToken('mysql', 'TIMESTAMP')).toBe(true)
  })

  /**
   * 방언 조건 단독 잠금 — 타입 가드가 살아 있어도 mysql 가드가 사라지면 걸려야 한다.
   * ⚠️ 물리 타입이 **실제로 `TIMESTAMP` 로 시작하는** 것을 골라야 한다(oracle 의 TIMESTAMPTZ).
   * postgresql 의 `timestamptz` 로 쓰면 단어 경계에서 먼저 떨어져 방언 가드를 지워도 초록으로 남는다.
   */
  it('mysql 이 아니면 물리 타입이 TIMESTAMP 로 시작해도 필요 없다', () => {
    expect(needsExplicitNullToken('oracle', 'TIMESTAMP WITH TIME ZONE')).toBe(false)
  })

  // 타입 조건 단독 잠금 — 방언 가드가 사라져도 이 케이스는 안 걸린다.
  it('mysql 이어도 TIMESTAMP 가 아니면 필요 없다', () => {
    expect(needsExplicitNullToken('mysql', 'VARCHAR(100)')).toBe(false)
  })

  /**
   * `\b` 단독 잠금 — 단어 경계를 지우면 `TIMESTAMP` 로 **시작만** 하는 타입이 걸린다.
   * 이 문자열은 대문자가 아니라 `i` 를 지우면 어차피 거짓이다 — 그래서 `\b` 만 잠근다.
   * (도메인 오버라이드로 mysql 컬럼에 `timestamptz` 를 적는 일은 실제로 도달 가능하다.)
   */
  it('TIMESTAMP 로 시작만 하는 타입은 아니다', () => {
    expect(needsExplicitNullToken('mysql', 'timestamptz')).toBe(false)
  })

  // `i` 단독 잠금 — 대소문자를 가리면 소문자 오버라이드와 파싱에 실패해 원문이 그대로
  // 나가는 컬럼이 조용히 빠진다. `\b` 를 지워도 이 문자열은 그대로 참이라 조각이 섞이지 않는다.
  it('소문자 timestamp 도 같다', () => {
    expect(needsExplicitNullToken('mysql', 'timestamp')).toBe(true)
  })

  // `.trim()` 단독 잠금 — 도메인 오버라이드는 생산자(`resolveColumn` 의 `sql = override`)가
  // 정규화하지 않아 앞뒤 공백이 물리 타입 문자열에 그대로 남는다.
  it('앞뒤 공백이 있어도 같다', () => {
    expect(needsExplicitNullToken('mysql', '  TIMESTAMP  ')).toBe(true)
  })

  /**
   * 소수 자릿수 계열 — `(` 가 단어 경계라 `\b` 를 그대로 통과한다.
   * ⚠️ 이것이 `\b` 를 `\s` 나 `$` 로 「강화」하지 못하게 막는다 — 그러면 소수 자릿수를 쓰는
   * 실제 컬럼이 조용히 빠져 MySQL 함정에 그대로 남는다.
   */
  it('TIMESTAMP(6) 같은 소수 자릿수 타입도 같다', () => {
    expect(needsExplicitNullToken('mysql', 'TIMESTAMP(6)')).toBe(true)
  })
})
