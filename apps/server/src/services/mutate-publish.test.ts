import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import type { Op } from '@erdd/core'
import { organizations, projects, resourceLibraries } from '../db/schema.js'
import { resetDb } from '../testing/db.js'
import { createTestApp } from '../testing/helpers.js'
import { createAccount } from './accounts.js'
import { RealtimeHub } from './realtime.js'
import { mutateAndPublish } from './mutate-publish.js'

const url = process.env.DATABASE_URL

function noteOp(): Op {
  const id = uuidv7()
  return {
    action: 'create', entity: 'note', entityId: id,
    data: { id, content: '메모', position: { x: 0, y: 0 }, color: '#fff' },
  }
}

describe.skipIf(!url)('mutateAndPublish', () => {
  let app: FastifyInstance
  let projectId: string
  let userId: string
  let hub: RealtimeHub
  let received: unknown[]

  beforeAll(async () => { app = await createTestApp() })
  afterAll(async () => { await app.close() })
  beforeEach(async () => {
    await resetDb(app.pgPool!)
    const account = await createAccount(app.db!, {
      email: 'o@t.dev', name: '오너', password: 'password-o', role: 'user',
    })
    userId = account.id
    const orgId = uuidv7()
    projectId = uuidv7()
    await app.db!.insert(organizations).values({ id: orgId, name: '테스트', kind: 'team' })
    await app.db!.insert(projects).values({
      id: projectId, orgId, name: 'P', description: '', dialects: ['postgresql'],
    })
    hub = new RealtimeHub()
    received = []
    hub.subscribe(projectId, { userId: 'watcher', name: '관찰자', send: (t) => received.push(JSON.parse(t)) })
    received.length = 0 // 구독 직후 presence 프레임은 관심 밖
  })

  it('성공하면 커밋된 seq·ops를 1회 발행한다', async () => {
    const op = noteOp()
    const { seq } = await mutateAndPublish(app.db!, hub, {
      projectId, actorUserId: userId, actorName: '오너', source: 'web', deriveOps: () => [op],
    })
    expect(seq).toBe(1)
    expect(received).toEqual([
      { type: 'ops', seq: 1, ops: [op], actorUserId: userId, actorName: '오너' },
    ])
  })

  it('변경이 없으면(op 0건) 발행하지 않는다', async () => {
    const { seq } = await mutateAndPublish(app.db!, hub, {
      projectId, actorUserId: userId, actorName: '오너', source: 'web', deriveOps: () => [],
    })
    expect(seq).toBe(0)
    expect(received).toEqual([])
  })

  it('트랜잭션이 롤백되면 발행하지 않는다', async () => {
    // 존재하지 않는 메모를 지우는 op → applyOps가 OpApplyError → 트랜잭션 롤백
    const ghost: Op = {
      action: 'delete', entity: 'note', entityId: uuidv7(), before: null,
    }
    await expect(mutateAndPublish(app.db!, hub, {
      projectId, actorUserId: userId, actorName: '오너', source: 'web', deriveOps: () => [ghost],
    })).rejects.toThrow()
    expect(received).toEqual([])
  })

  it('prepare는 락 안에서 그 시점의 권위 모델과 함께 호출된다', async () => {
    const seen: number[] = []
    const record = async (_tx: unknown, model: { notes: Record<string, unknown> }) => {
      seen.push(Object.keys(model.notes).length)
    }
    await mutateAndPublish(app.db!, hub, {
      projectId, actorUserId: userId, actorName: '오너', source: 'web',
      prepare: record, deriveOps: () => [noteOp()],
    })
    await mutateAndPublish(app.db!, hub, {
      projectId, actorUserId: userId, actorName: '오너', source: 'web',
      prepare: record, deriveOps: () => [noteOp()],
    })
    expect(seen).toEqual([0, 1])   // 두 번째 호출은 첫 메모가 반영된 모델을 본다
  })

  it('prepare가 쓴 행은 모델 변경과 한 트랜잭션이다 — op 적용이 실패하면 함께 롤백된다', async () => {
    const libraryId = uuidv7()
    await expect(mutateAndPublish(app.db!, hub, {
      projectId, actorUserId: userId, actorName: '오너', source: 'web',
      prepare: async (tx) => {
        await tx.insert(resourceLibraries).values({
          id: libraryId, scope: 'global', orgId: null, name: '롤백 확인', description: '',
        })
      },
      // 존재하지 않는 메모를 수정하는 op — applyOps가 거부한다
      deriveOps: () => [{
        action: 'update', entity: 'note', entityId: uuidv7(),
        changes: { content: { from: 'a', to: 'b' } },
      }],
    })).rejects.toThrow()

    const rows = await app.db!.select().from(resourceLibraries)
      .where(eq(resourceLibraries.id, libraryId))
    expect(rows).toHaveLength(0)
    expect(received).toEqual([])
  })
})
