import { z } from 'zod'
import { DIALECTS, type Dialect } from './dialect.js'

/**
 * 프로젝트 수준 테이블 옵션 — `CREATE TABLE` 의 닫는 괄호 뒤에 붙는 방언별 자유 문자열.
 *
 * `ENGINE`·`DEFAULT CHARSET` 은 논리 모델이 아니라 **물리 배포 설정**이고 실무에서 프로젝트
 * 전체가 같은 값을 쓴다(설계 D2). 그래서 테이블별 필드가 아니라 프로젝트 설정이다.
 *
 * **방언마다 문법이 다르므로 한 칸으로는 안 된다** — 한 문자열을 네 방언에 다 붙이면 MySQL 의
 * `ENGINE=` 이 PostgreSQL `CREATE TABLE` 뒤에 나가 DDL 이 아예 실행되지 않는다. 모양은
 * `Domain.dialectTypes`(방언 4키 × 자유 문자열)를 그대로 베꼈다.
 *
 * **검증하지 않는다** — `dialectTypes` 와 같은 방침이다. 잘못 적으면 그 방언의 DDL 이 실패하고,
 * 그것은 사용자가 즉시 보는 실패다.
 */
export type TableOptions = Record<Dialect, string>

export const DEFAULT_TABLE_OPTIONS: TableOptions = {
  postgresql: '', mysql: '', oracle: '', mssql: '',
}

/**
 * **읽기용** — 네 키에 `.default('')` 를 걸어 키가 없는 옛 jsonb 행에 기본값을 주입한다.
 * 기본값이 주입되는 지점은 `project.get` 의 파싱 하나다.
 */
export const TableOptionsSchema = z.object(
  Object.fromEntries(DIALECTS.map((d) => [d, z.string().default('')])) as {
    [K in Dialect]: z.ZodDefault<z.ZodString>
  },
)

/**
 * **쓰기 검증용** — 네 키 전부 필수. 기본값 주입을 겸하지 않는다.
 *
 * ⚠️ `TableOptionsSchema` 의 `.default('')` 는 **읽기 시점 주입**이 목적이다. 그것을 쓰기 입력에
 * 그대로 걸면 `{mysql: '…'}` 만 보낸 화면이 **나머지 세 방언의 값을 조용히 지운다** — 부분
 * 페이로드가 전체 덮어쓰기로 둔갑한다. 키가 넷이라 `NamingRules` 보다 함정이 크다.
 * (`naming.ts` 의 `NamingRulesSchema`/`NamingRulesStrictSchema` 가 **같은 이유로** 갈려 있다.)
 */
export const TableOptionsStrictSchema = z.object(
  Object.fromEntries(DIALECTS.map((d) => [d, z.string()])) as { [K in Dialect]: z.ZodString },
)
