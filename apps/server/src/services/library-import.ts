import { createHash } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { eq, inArray } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import {
  formatLibraryFileIssues, materializeLibraryImport, parseLibraryFile, planLibraryImport, summarizeLibraryImport,
  type LibraryImportSummary, type LibraryImportWrites,
} from '@erdd/core'
import type { Db, Tx } from '../db/client.js'
import { resourceItems, resourceLibraries } from '../db/schema.js'
import { loadLibraryItems } from './promote.js'
import { parsePayload, requireLibraryWrite, requireScopeWrite } from './resource-library.js'

type Actor = { id: string; role: 'admin' | 'user' }

export type LibraryImportInput = {
  target: { libraryId: string } | { create: { scope: 'global' | 'org'; orgId?: string; name: string; description: string } }
  text: string
  prune: boolean
  includeStale: boolean
  dryRun: boolean
  expectedStateHash?: string
}
export type LibraryImportResponse = {
  libraryId: string | null
  applied: boolean
  stateHash: string
  summary: LibraryImportSummary
}

/** 한 번에 넣는 행 수 — 행당 파라미터 5개라 Postgres 한도(65535)보다 넉넉히 작게. */
const CHUNK = 1000

/**
 * 미리보기 → 적용 사이에 라이브러리가 바뀌었는지 판정하는 값. (id, version) 전체를 id 오름차순으로
 * 이어 해시한다 — 항목이 5만 건이어도 클라가 들고 다니는 것은 64자다.
 */
export function libraryStateHash(items: readonly { id: string; version: number }[]): string {
  const hash = createHash('sha256')
  for (const it of [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) hash.update(`${it.id}:${it.version}\n`)
  return hash.digest('hex')
}

/**
 * 파일 → 라이브러리 갱신 병합(guides/shared-resources.md 「파일 내보내기·가져오기」).
 * 파일은 텍스트로 받아 여기서 파싱한다 — 클라가 파싱한 구조를 믿지 않는다.
 * 한 번의 가져오기는 한 트랜잭션이고 전부 아니면 전무다.
 */
export async function runLibraryImport(db: Db, actor: Actor, input: LibraryImportInput): Promise<LibraryImportResponse> {
  const parsed = parseLibraryFile(input.text, 'source')
  if (!parsed.ok) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: [`라이브러리 파일 오류 ${parsed.issues.length}건`, ...formatLibraryFileIssues(parsed.issues)].join('\n'),
    })
  }
  const doc = parsed.doc
  const opts = { prune: input.prune, includeStale: input.includeStale }

  if ('create' in input.target) {
    const create = input.target.create
    if (create.scope === 'org' && !create.orgId) throw new TRPCError({ code: 'BAD_REQUEST', message: '조직 id가 필요합니다' })
    await requireScopeWrite(db, create.scope, create.orgId ?? null, actor)
    const plan = planLibraryImport([], doc, null)
    const response = { stateHash: libraryStateHash([]), summary: summarizeLibraryImport(plan, []) }
    if (input.dryRun) return { libraryId: null, applied: false, ...response }
    const libraryId = uuidv7()
    await db.transaction(async (tx) => {
      await tx.insert(resourceLibraries).values({
        id: libraryId, scope: create.scope, orgId: create.scope === 'org' ? create.orgId! : null,
        name: create.name, description: create.description,
      })
      await writeImport(tx, libraryId, materializeLibraryImport(plan, opts, uuidv7))
    })
    return { libraryId, applied: true, ...response }
  }

  const libraryId = input.target.libraryId
  await requireLibraryWrite(db, libraryId, actor)
  if (input.dryRun) {
    const items = await loadLibraryItems(db, libraryId)
    const plan = planLibraryImport(items, doc, libraryId)
    return { libraryId, applied: false, stateHash: libraryStateHash(items), summary: summarizeLibraryImport(plan, items) }
  }
  return db.transaction(async (tx) => {
    // 라이브러리 행을 먼저 잠그고 그 뒤에 항목을 읽는다 — 가져오기끼리의 동시 삽입(동명 중복)이 여기서
    // 직렬화된다. 항목을 락 전에 읽으면 계획이 낡은 목록으로 「추가」를 세운다.
    const locked = await tx.select({ id: resourceLibraries.id }).from(resourceLibraries)
      .where(eq(resourceLibraries.id, libraryId)).for('update')
    if (locked.length === 0) throw new TRPCError({ code: 'NOT_FOUND', message: '라이브러리를 찾을 수 없습니다' })
    const items = await loadLibraryItems(tx, libraryId)
    const stateHash = libraryStateHash(items)
    if (input.expectedStateHash !== undefined && input.expectedStateHash !== stateHash) {
      throw new TRPCError({ code: 'CONFLICT', message: '미리보기 이후 라이브러리가 바뀌었습니다 — 다시 미리보기 하세요' })
    }
    const plan = planLibraryImport(items, doc, libraryId)
    await writeImport(tx, libraryId, materializeLibraryImport(plan, opts, uuidv7))
    return { libraryId, applied: true, stateHash, summary: summarizeLibraryImport(plan, items) }
  })
}

async function writeImport(tx: Tx, libraryId: string, writes: LibraryImportWrites): Promise<void> {
  if (writes.inserts.length + writes.updates.length + writes.removes.length === 0) return
  const now = new Date()
  // 쓰기 직전에 종류별 스키마로 한 번 더 검증한다 — 병합 결과가 완전값인지(원천 파일의 부분 필드 + 기본값).
  for (let i = 0; i < writes.inserts.length; i += CHUNK) {
    await tx.insert(resourceItems).values(writes.inserts.slice(i, i + CHUNK).map((row) => ({
      id: row.id, libraryId, kind: row.kind, payload: parsePayload(row.kind, row.payload), version: 1,
    })))
  }
  for (const u of writes.updates) {
    await tx.update(resourceItems).set({ payload: parsePayload(u.kind, u.payload), version: u.version, updatedAt: now })
      .where(eq(resourceItems.id, u.id))
  }
  for (let i = 0; i < writes.removes.length; i += CHUNK) {
    await tx.delete(resourceItems).where(inArray(resourceItems.id, writes.removes.slice(i, i + CHUNK)))
  }
  await tx.update(resourceLibraries).set({ updatedAt: now }).where(eq(resourceLibraries.id, libraryId))
}
