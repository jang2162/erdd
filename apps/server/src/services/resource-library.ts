import { TRPCError } from '@trpc/server'
import { and, asc, count, eq, or, sql, type SQL } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { RESOURCE_PAYLOAD_SCHEMAS, type ResourceKind } from '@erdd/core'
import type { Db } from '../db/client.js'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { getOrgMember } from './perm.js'

export type LibraryRow = typeof resourceLibraries.$inferSelect
type Actor = { id: string; role: 'admin' | 'user' }

/** 라이브러리에 저장할 payload를 종류별 스키마로 검증한다. */
export function parsePayload(kind: ResourceKind, payload: unknown): Record<string, unknown> {
  const parsed = RESOURCE_PAYLOAD_SCHEMAS[kind].safeParse(payload)
  if (!parsed.success) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `항목 형식 오류 — ${parsed.error.message}` })
  }
  return parsed.data as Record<string, unknown>
}

async function loadLibrary(db: Db, libraryId: string): Promise<LibraryRow> {
  const row = (
    await db.select().from(resourceLibraries).where(eq(resourceLibraries.id, libraryId))
  )[0]
  if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: '라이브러리를 찾을 수 없습니다' })
  return row
}

/** 전역은 인증 사용자 전체, 조직은 해당 조직 멤버만 읽는다. */
export async function requireScopeRead(
  db: Db, scope: 'global' | 'org', orgId: string | null, actor: Actor,
): Promise<void> {
  if (scope === 'global') return
  if (!orgId || !(await getOrgMember(db, orgId, actor.id))) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '조직 리소스 접근 권한이 없습니다' })
  }
}

/** 전역은 서비스 관리자, 조직은 Org Owner/Admin만 쓴다. */
export async function requireScopeWrite(
  db: Db, scope: 'global' | 'org', orgId: string | null, actor: Actor,
): Promise<void> {
  if (scope === 'global') {
    if (actor.role !== 'admin') {
      throw new TRPCError({ code: 'FORBIDDEN', message: '전역 리소스는 서비스 관리자만 관리할 수 있습니다' })
    }
    return
  }
  const me = orgId ? await getOrgMember(db, orgId, actor.id) : undefined
  if (!me || (me.role !== 'owner' && me.role !== 'admin')) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '조직 리소스 관리 권한이 없습니다' })
  }
}

export async function requireLibraryRead(db: Db, libraryId: string, actor: Actor): Promise<LibraryRow> {
  const library = await loadLibrary(db, libraryId)
  await requireScopeRead(db, library.scope, library.orgId, actor)
  return library
}

export async function requireLibraryWrite(db: Db, libraryId: string, actor: Actor): Promise<LibraryRow> {
  const library = await loadLibrary(db, libraryId)
  await requireScopeWrite(db, library.scope, library.orgId, actor)
  return library
}

const STARTER_WORDS = [
  { logicalName: '회원', abbreviation: 'MBR', description: null },
  { logicalName: '주문', abbreviation: 'ORD', description: null },
  { logicalName: '번호', abbreviation: 'NO', description: null },
  { logicalName: '이름', abbreviation: 'NM', description: null },
  { logicalName: '금액', abbreviation: 'AMT', description: null },
  { logicalName: '일자', abbreviation: 'DT', description: null },
]

const STARTER_DOMAINS = [
  {
    name: '식별번호', category: '번호', logicalType: 'BIGINT',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: '순번형 식별자',
  },
  {
    name: '이름100', category: '명칭', logicalType: 'VARCHAR(100)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: '일반 명칭',
  },
  {
    name: '금액', category: '수량/금액', logicalType: 'DECIMAL(15,2)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: '0', allowedValues: [], description: '통화 금액',
  },
]

const STARTER_CUSTOM_FIELDS = [
  {
    name: '개인정보여부', target: 'column' as const, type: 'select' as const,
    options: ['해당없음', '개인정보', '민감정보'], required: false, defaultValue: '해당없음',
  },
  {
    name: '비고', target: 'table' as const, type: 'text' as const,
    options: [], required: false, defaultValue: null,
  },
]

/**
 * 전역 라이브러리가 하나도 없을 때만 예시 라이브러리를 만든다(ensureBootstrapAdmin과 같은 패턴).
 * 행안부 표준 사전 실데이터는 출처·라이선스 확인이 끝난 뒤 별도로 넣는다.
 * 존재 확인 + 두 insert를 한 트랜잭션으로 묶는다 — library insert 뒤 items insert 전에
 * 실패하면 항목 0개짜리 라이브러리가 남고, 다음 부팅부터 existing 가드에 걸려 영원히
 * 복구되지 않기 때문이다.
 */
export async function ensureStarterGlobalLibrary(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = (
      await tx.select({ id: resourceLibraries.id }).from(resourceLibraries)
        .where(eq(resourceLibraries.scope, 'global')).limit(1)
    )[0]
    if (existing) return

    const libraryId = uuidv7()
    await tx.insert(resourceLibraries).values({
      id: libraryId, scope: 'global', orgId: null,
      name: '표준 사전(예시)',
      description: '가져오기·재동기화를 시험해 볼 수 있는 예시 데이터입니다. 행안부 표준 사전 실데이터는 별도 소싱 예정입니다.',
    })

    const rows: { id: string; libraryId: string; kind: 'domain' | 'word' | 'term' | 'customField'; payload: Record<string, unknown>; version: number }[] = []
    const domainIdByName = new Map<string, string>()
    for (const payload of STARTER_DOMAINS) {
      const id = uuidv7()
      domainIdByName.set(payload.name, id)
      rows.push({ id, libraryId, kind: 'domain', payload, version: 1 })
    }
    for (const payload of STARTER_WORDS) {
      rows.push({ id: uuidv7(), libraryId, kind: 'word', payload, version: 1 })
    }
    const terms = [
      { logicalName: '회원번호', physicalName: 'MBR_NO', domainId: domainIdByName.get('식별번호')!, description: null },
      { logicalName: '회원명', physicalName: 'MBR_NM', domainId: domainIdByName.get('이름100')!, description: null },
      { logicalName: '주문금액', physicalName: 'ORD_AMT', domainId: domainIdByName.get('금액')!, description: null },
    ]
    for (const payload of terms) {
      rows.push({ id: uuidv7(), libraryId, kind: 'term', payload, version: 1 })
    }
    for (const payload of STARTER_CUSTOM_FIELDS) {
      rows.push({ id: uuidv7(), libraryId, kind: 'customField', payload, version: 1 })
    }
    await tx.insert(resourceItems).values(rows)
    console.log(`예시 전역 공용 리소스 라이브러리 생성: ${libraryId}`)
  })
}

/** LIKE 패턴의 메타 문자(`\`·`%`·`_`)를 글자 그대로 찾게 한다. Postgres LIKE 의 기본 ESCAPE 가 `\` 다. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/** 종류별 논리명 칸 — 정렬 키이고, core `resourceDisplayName` 이 읽는 키와 같다. */
const NAME_FIELD: Record<ResourceKind, string> = {
  domain: 'name', word: 'logicalName', term: 'logicalName', customField: 'name',
}

/**
 * 조회 모달의 검색 필드. 에디터 사전·도메인·커스텀 패널의 클라이언트 검색도 같은 필드를 쓴다
 * (guides/shared-resources.md 「관리 화면의 항목 조회」) — 한쪽만 바꾸면 같은 검색어가 화면마다 다르게 걸린다.
 */
export const PAGE_SEARCH_FIELDS: Record<ResourceKind, readonly string[]> = {
  word: ['logicalName', 'abbreviation', 'englishName'],
  term: ['logicalName', 'physicalName'],
  domain: ['name'],
  customField: ['name'],
}

/** payload 의 문자열 필드. 필드 이름은 위 두 상수에서만 오므로 raw 로 박아도 주입 경로가 없다. */
function payloadText(field: string): SQL {
  return sql`(${resourceItems.payload} ->> ${sql.raw(`'${field}'`)})`
}

/**
 * 관리 화면 조회 모달의 한 페이지 — 종류 하나, 검색어로 거른 뒤 논리명 칸 오름차순·동률 id 순.
 * 동률 깨기가 없으면 같은 이름이 많을 때 페이지를 넘기며 항목이 겹치거나 빠진다.
 * 정렬은 `COLLATE "C"`(코드 포인트 순)다 — DB 기본 로캘(compose 의 postgres 는 en_US.utf8)에서는 한글이 글자 수
 * 먼저로 늘어선다(「가, 값, 국, 가감」). "C" 는 어느 Postgres 에나 있고 한글 음절을 가나다순으로 둔다. ICU
 * 콜레이션은 빌드에 따라 없을 수 있어 쓰지 않는다(guides/shared-resources.md 「알려진 한계」).
 * 이름이 jsonb 안에 있어 정렬·검색은 인덱스를 타지 않는다 — (library_id, kind) 인덱스로 좁힌 뒤 거른다.
 */
export async function loadLibraryItemPage(
  db: Db,
  input: { libraryId: string; kind: ResourceKind; query?: string; offset: number; limit: number },
): Promise<{
  items: { id: string; kind: ResourceKind; payload: Record<string, unknown>; version: number }[]
  total: number
}> {
  const q = input.query?.trim() ?? ''
  const pattern = `%${escapeLike(q)}%`
  const where = and(
    eq(resourceItems.libraryId, input.libraryId),
    eq(resourceItems.kind, input.kind),
    q === '' ? undefined : or(...PAGE_SEARCH_FIELDS[input.kind].map((f) => sql`${payloadText(f)} ILIKE ${pattern}`)),
  )
  const [items, totals] = await Promise.all([
    db.select({
      id: resourceItems.id, kind: resourceItems.kind,
      payload: resourceItems.payload, version: resourceItems.version,
    })
      .from(resourceItems)
      .where(where)
      .orderBy(asc(sql`${payloadText(NAME_FIELD[input.kind])} COLLATE "C"`), asc(resourceItems.id))
      .limit(input.limit)
      .offset(input.offset),
    db.select({ total: count() }).from(resourceItems).where(where),
  ])
  return { items, total: totals[0]?.total ?? 0 }
}
