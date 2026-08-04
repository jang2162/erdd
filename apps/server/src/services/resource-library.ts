import { TRPCError } from '@trpc/server'
import { eq } from 'drizzle-orm'
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
