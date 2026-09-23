import type { Dialect } from '../dialect.js'

/** 이 ERDD 가 쓰고 읽는 기록 형식 번호. 더 큰 번호의 기록은 파서가 거절한다. */
export const CHANGESET_FORMAT = 1

/**
 * 코드 단위 사전순. **`localeCompare` 를 쓰지 않는다** — 실행 환경의 로캘에 따라 순서가 달라져
 * 같은 모델에서 다른 기록이 나오고, 재생 순서(파일명 순)도 흔들린다.
 */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export type DialectTypes = Partial<Record<Dialect, string>>

// ── 스키마 투영 — guide 「기록 대상 — 스키마 투영」 ──

export type ProjColumn = {
  id: string
  tableId: string
  name: string
  /** 유효 논리 타입(도메인을 거친 값). DB 중립이다. */
  type: string
  /** 도메인의 방언별 타입 중 프로젝트 방언에 있는 것만. 없으면 빈 객체. */
  dialectTypes: DialectTypes
  nullable: boolean
  /** 원문 기본값. 자동증가 컬럼이면 null(DDL 도 DEFAULT 를 내지 않는다). */
  default: string | null
  increment: boolean
  /** DDL 이 내는 코멘트 텍스트(`commentText`). */
  comment: string | null
  /** 허용값(CHECK IN). 없으면 빈 배열. */
  check: string[]
}

export type ProjTable = {
  id: string
  /** 명명 템플릿을 거친 실제 물리명. */
  name: string
  comment: string | null
  /** 컬럼 순서. 정수 order 가 아니라 id 목록이다 — guide 「`after` 는 최종 순서의 바로 앞 컬럼이다」. */
  columnIds: string[]
  /** PK 컬럼 id — 컬럼 순서대로(DDL 의 PRIMARY KEY 절과 같은 순서). */
  primaryKey: string[]
}

export type ProjIndex = {
  id: string
  tableId: string
  name: string
  columns: { columnId: string; direction: 'asc' | 'desc' }[]
  unique: boolean
}

export type ProjForeignKey = {
  id: string
  name: string
  childTableId: string
  childColumnIds: string[]
  parentTableId: string
  parentColumnIds: string[]
  cardinality: '1:1' | '1:N'
  /** 1:1 이면 DDL 이 함께 내는 UNIQUE 제약 이름. */
  uniqueName: string | null
}

export type SchemaProjection = {
  tables: Record<string, ProjTable>
  columns: Record<string, ProjColumn>
  indexes: Record<string, ProjIndex>
  foreignKeys: Record<string, ProjForeignKey>
}

export function emptyProjection(): SchemaProjection {
  return { tables: {}, columns: {}, indexes: {}, foreignKeys: {} }
}

// ── 문장 — 이름으로 쓴 정의. 대상은 `id` 로 찾는다(guide 「재생은 `@id` 로 대상을 찾는다」) ──

export type ColumnDef = Omit<ProjColumn, 'tableId'>

export type IndexDef = {
  id: string
  name: string
  table: string
  columns: { name: string; direction: 'asc' | 'desc' }[]
  unique: boolean
}

export type ForeignKeyDef = {
  id: string
  name: string
  child: string
  childColumns: string[]
  parent: string
  parentColumns: string[]
  cardinality: '1:1' | '1:N'
  uniqueName: string | null
}

export type TableDef = {
  id: string
  name: string
  comment: string | null
  columns: ColumnDef[]
  /** PK 컬럼 이름. */
  primaryKey: string[]
  /** drop table 만 싣는다(되돌리기용). create table 은 언제나 빈 배열 — 인덱스는 add index 로 따로 나간다. */
  indexes: IndexDef[]
}

/** `position` 의 값은 최종 순서에서 바로 앞 컬럼의 이름, null 은 맨 앞. */
export type ColumnChange =
  | { field: 'type'; from: string; to: string }
  | { field: 'dialects'; from: DialectTypes; to: DialectTypes }
  | { field: 'nullable'; from: boolean; to: boolean }
  | { field: 'default'; from: string | null; to: string | null }
  | { field: 'increment'; from: boolean; to: boolean }
  | { field: 'comment'; from: string | null; to: string | null }
  | { field: 'check'; from: string[]; to: string[] }
  | { field: 'position'; from: string | null; to: string | null }

/** `line` 은 파서가 채운다(오류·경고 위치). 직렬화는 보지 않는다. */
export type AlterAction = (
  | { kind: 'dropColumn'; column: ColumnDef }
  | { kind: 'renameColumn'; id: string; from: string; to: string }
  | { kind: 'addColumn'; column: ColumnDef; after: string | null }
  | { kind: 'modifyColumn'; id: string; name: string; changes: ColumnChange[] }
  | { kind: 'primaryKey'; from: string[]; to: string[] }
  | { kind: 'tableComment'; from: string | null; to: string | null }
) & { line?: number }

export type Statement = (
  | { kind: 'dropForeignKey'; fk: ForeignKeyDef }
  | { kind: 'dropIndex'; index: IndexDef }
  | { kind: 'renameIndex'; id: string; table: string; from: string; to: string }
  | { kind: 'dropTable'; table: TableDef }
  | { kind: 'renameTable'; id: string; from: string; to: string }
  | { kind: 'createTable'; table: TableDef }
  | { kind: 'alterTable'; id: string; name: string; actions: AlterAction[] }
  | { kind: 'addIndex'; index: IndexDef }
  | { kind: 'addForeignKey'; fk: ForeignKeyDef }
) & { line?: number }

export type ChangesetHeader = { format: number; name: string; created: string; baseline: boolean }
export type Changeset = { header: ChangesetHeader; statements: Statement[] }

/** 오류·경고의 위치. 파일도 줄도 없으면 모델 쪽 문제다. */
export type ChangeIssue = { file: string | null; line: number | null; message: string }
