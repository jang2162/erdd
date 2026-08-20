import { initTRPC, TRPCError } from '@trpc/server'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import {
  createEmptyModel, parseOps, DIALECTS, NamingRulesStrictSchema, OpParseError,
  type ProjectModel, type RunMode,
} from '@erdd/core'
import { writeConfig, type ErddConfig } from '../config.js'
import { FileStore, LocalStoreError } from './store.js'
import { readSnapshots, updateSnapshots, type SnapshotRecord } from './snapshots.js'

export type LocalContext = {
  store: FileStore
  cwd: string
  /** 이 서버가 여는 유일한 프로젝트 id. 다른 값이 오면 거절한다. */
  projectId: string
  config: ErddConfig
}

/** 로컬 모드에는 계정이 없다 — 화면이 요구하는 사용자 자리를 채우는 고정 id 다. */
const LOCAL_USER_ID = '00000000-0000-7000-8000-000000000001'

/**
 * ⚠️ 리터럴이 아니라 `RunMode` 로 넓힌다. 서버 `auth.me` 도 같은 `RunMode` 로 `'server'` 를
 * 내므로, 어느 한쪽이라도 리터럴이면 두 타입이 서로를 만족하지 않아 아래 계약 잠금이 깨진다.
 */
const LOCAL_MODE: RunMode = 'local'

const t = initTRPC.context<LocalContext>().create()

/** 이 서버는 프로젝트 하나만 연다 — 다른 id 는 잘못 연결된 클라이언트다. */
const scoped = t.procedure
  .input(z.object({ projectId: z.string() }))
  .use(({ ctx, input, next }) => {
    if (input.projectId !== ctx.projectId) {
      throw new TRPCError({ code: 'NOT_FOUND', message: '이 서버가 여는 프로젝트가 아닙니다' })
    }
    return next()
  })

function toRecord(store: FileStore, name: string, description: string): SnapshotRecord {
  return {
    id: uuidv7(),
    name,
    description,
    revisionSeq: store.state.seq,
    model: store.state.model,
    createdAt: new Date().toISOString(),
  }
}

/** 저장소의 도메인 오류(읽기 전용·op 상한·무결성)를 한자리에서 400 으로 바꾼다. */
function wrap<T>(fn: () => Promise<T>): Promise<T> {
  return fn().catch((err: unknown) => {
    if (err instanceof LocalStoreError) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
    }
    throw err
  })
}

export function createLocalRouter() {
  return t.router({
    auth: t.router({
      me: t.procedure.query(() => ({
        id: LOCAL_USER_ID,
        email: 'local@erdd',
        name: '로컬',
        role: 'user' as const,
        mode: LOCAL_MODE,
      })),
    }),

    project: t.router({
      get: scoped.query(({ ctx }) => ({
        id: ctx.projectId,
        orgId: ctx.projectId,
        name: '로컬 프로젝트',
        description: '',
        dialects: ctx.config.dialects,
        namingRules: ctx.config.namingRules,
        createdAt: new Date(0),
        myRole: 'admin' as const,
        myOrgRole: 'owner' as const,
        canEdit: true,
        canManage: true,
      })),

      /**
       * ⚠️ 서버와 **같은** core 스키마로 검증한다. 이 경로가 쓰는 대상은 `erdd.config.yaml` 이고,
       * 그것이 오염되면 `readConfig` 가 거절해 **프로젝트가 아예 열리지 않는다** — 화면 하나가
       * 잘못 보내는 것으로 그 자리까지 가게 두면 안 된다. 검증 실패는 zod 가 BAD_REQUEST 로 낸다.
       *
       * `NamingRulesStrictSchema` 를 쓰는 이유는 서버 주석과 같다 — 읽기용 스키마의 기본값이
       * 걸리면 키 누락이 곧 「기본값으로 되쓰기」가 되어 꺼 둔 구분자가 조용히 켜진다.
       */
      update: scoped
        .input(z.object({
          projectId: z.string(),
          name: z.string().min(1).optional(),
          description: z.string().optional(),
          dialects: z.array(z.enum(DIALECTS)).min(1).optional(),
          namingRules: NamingRulesStrictSchema.optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          // 이름·설명은 config 에 담을 자리가 없다(로컬 프로젝트에는 이름이 없다).
          // 방언·명명 규칙만 되쓴다.
          const next: ErddConfig = {
            ...ctx.config,
            dialects: input.dialects ?? ctx.config.dialects,
            namingRules: input.namingRules ?? ctx.config.namingRules,
          }
          await writeConfig(ctx.cwd, next)
          // ⚠️ 파일만 되쓰면 안 된다 — 컨텍스트가 들고 있는 config 는 서버가 뜰 때 읽은 것이라
          // 그대로 두면 살아 있는 동안 project.get 이 옛 값을 계속 낸다(저장 → 재조회에서
          // 사용자에게는 저장이 안 된 것으로 보인다). 제자리에서 갱신해 같은 객체를 보는
          // 호출자까지 함께 맞춘다.
          Object.assign(ctx.config, next)
          return { ok: true as const }
        }),
    }),

    model: t.router({
      get: scoped.query(({ ctx }) => ({
        model: ctx.store.state.model,
        seq: ctx.store.state.seq,
      })),

      mutate: scoped
        .input(z.object({
          projectId: z.string(),
          ops: z.array(z.unknown()).min(1),
          summary: z.string().min(1).max(200).optional(),
        }))
        .mutation(({ ctx, input }) => wrap(async () => {
          let ops
          try {
            ops = parseOps(input.ops)
          } catch (err) {
            if (err instanceof OpParseError) {
              throw new TRPCError({ code: 'BAD_REQUEST', message: err.message })
            }
            throw err
          }
          return await ctx.store.mutate(ops)
        })),
    }),

    snapshot: t.router({
      create: scoped
        .input(z.object({
          projectId: z.string(),
          name: z.string().min(1).max(100),
          description: z.string().max(1000).optional(),
        }))
        .mutation(async ({ ctx, input }) => {
          const rec = toRecord(ctx.store, input.name, input.description ?? '')
          await updateSnapshots(ctx.cwd, (all) => [rec, ...all])
          return { id: rec.id }
        }),

      list: scoped.query(async ({ ctx }) => ({
        items: (await readSnapshots(ctx.cwd)).map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          revisionSeq: s.revisionSeq,
          createdAt: new Date(s.createdAt),
        })),
      })),

      get: scoped
        .input(z.object({ projectId: z.string(), snapshotId: z.string() }))
        .query(async ({ ctx, input }) => {
          const s = (await readSnapshots(ctx.cwd)).find((x) => x.id === input.snapshotId)
          if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: '스냅샷을 찾을 수 없습니다' })
          return {
            id: s.id,
            projectId: ctx.projectId,
            name: s.name,
            description: s.description,
            revisionSeq: s.revisionSeq,
            model: s.model,
            createdAt: new Date(s.createdAt),
          }
        }),

      delete: scoped
        .input(z.object({ projectId: z.string(), snapshotId: z.string() }))
        .mutation(async ({ ctx, input }) => {
          // 존재 검사도 체인 안에서 한다 — 밖에서 하면 그 사이에 남이 지운 것을 못 본다.
          await updateSnapshots(ctx.cwd, (all) => {
            if (!all.some((x) => x.id === input.snapshotId)) {
              throw new TRPCError({ code: 'NOT_FOUND', message: '스냅샷을 찾을 수 없습니다' })
            }
            return all.filter((x) => x.id !== input.snapshotId)
          })
          return { ok: true as const }
        }),

      restore: scoped
        .input(z.object({ projectId: z.string(), snapshotId: z.string() }))
        .mutation(({ ctx, input }) => wrap(async () => {
          const s = (await readSnapshots(ctx.cwd)).find((x) => x.id === input.snapshotId)
          if (!s) throw new TRPCError({ code: 'NOT_FOUND', message: '스냅샷을 찾을 수 없습니다' })
          // 옛 스냅샷에는 신규 컬렉션 키가 없을 수 있다 — 서버 restore 와 같은 정규화를 한다.
          const model: ProjectModel = { ...createEmptyModel(), ...s.model }
          return await ctx.store.setModel(model)
        })),
    }),
  })
}

export type LocalRouter = ReturnType<typeof createLocalRouter>
