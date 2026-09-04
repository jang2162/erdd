import type { Column, ProjectModel } from './model.js'
import { resolveColumnType, type Dialect } from './dialect.js'

export type ResolvedColumn = {
  sql: string
  logicalType: string
  warning?: string
  checkValues?: string[]
  defaultValue: string | null
}

export function resolveColumn(column: Column, model: ProjectModel, dialect: Dialect): ResolvedColumn {
  if (column.domainId) {
    const d = model.domains[column.domainId]
    if (d) {
      const override = d.dialectTypes[dialect]
      let sql: string
      let warning: string | undefined
      if (override && override.trim() !== '') {
        sql = override
      } else {
        const r = resolveColumnType(d.logicalType, dialect)
        sql = r.sql
        warning = r.warning
      }
      const defaultValue = column.defaultValue !== null && column.defaultValue !== ''
        ? column.defaultValue : d.defaultValue
      return {
        sql, logicalType: d.logicalType, warning,
        checkValues: d.allowedValues.length ? d.allowedValues : undefined, defaultValue,
      }
    }
  }
  const r = resolveColumnType(column.type, dialect)
  return { sql: r.sql, logicalType: column.type, warning: r.warning, defaultValue: column.defaultValue }
}

/**
 * 이 컬럼이 **`NULL`(DBML 은 `null`) 토큰을 명시해야 하는가**를 판정한다.
 *
 * MySQL·MariaDB 서버가 `explicit_defaults_for_timestamp = 0` 이면 `NULL` 을 명시하지 않은
 * `TIMESTAMP` 컬럼을 제멋대로 `NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`
 * 로 만든다 — nullable 로 설계한 컬럼이 실제 DB 에서 NOT NULL 이 되고 UPDATE 마다 값이 조용히 바뀐다.
 *
 * ⚠️ **판정만 갖는다. 포맷별 정책(PK 를 어떻게 다루는가)은 호출부에 남긴다.**
 * DDL 은 PK 여도 `NULL` 을 내지만 DBML 은 `pk` 와 겹치지 않게 뺀다 — 그 차이를 여기 넣으면
 * 두 포맷의 **의도된** 차이가 헬퍼 안에서 뭉개진다.
 *
 * ⚠️ **`ddl.ts`·`dbml.ts` 가 각자 이 식을 들고 있으면 안 된다.** 두 포맷은 같은
 * `resolveColumn().sql` 을 보고 같은 서버 함정을 막으므로 이 판정에서 독립으로 진화할 수 없다 —
 * 갈라지면 같은 모델의 DDL 과 DBML 이 서로 다른 nullability 를 말한다.
 *
 * @param sql `resolveColumn().sql` — **실제로 나가는 물리 타입**이다. 논리 타입으로 판정하지 마라:
 *   방언별 물리 타입 오버라이드로 TIMESTAMP 가 된 컬럼과, 파싱에 실패해 원문이 그대로 나가는
 *   컬럼이 조용히 빠진다.
 */
export function needsExplicitNullToken(dialect: Dialect, sql: string): boolean {
  // `.trim()` — 도메인 오버라이드는 생산자(위 `resolveColumn` 의 `sql = override`)가 정규화하지
  //   않아 앞뒤 공백이 물리 타입 문자열에 그대로 남는다.
  // `i` — 소문자 오버라이드(`timestamp`)와 파싱에 실패해 원문이 그대로 나가는 컬럼을 놓치지 않는다.
  // `\b` — `TIMESTAMP` 로 **시작만** 하는 다른 타입(`timestamptz`)을 걸러 낸다. `\s` 나 `$` 로
  //   「강화」하지 마라 — 소수 자릿수를 쓰는 실제 컬럼(`TIMESTAMP(6)`)이 조용히 빠진다.
  return dialect === 'mysql' && /^TIMESTAMP\b/i.test(sql.trim())
}
