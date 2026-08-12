import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { applyOps, diffModels, invertOps, validateModelIntegrity, type ProjectModel } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'

// 모든 모델 mutation(정상 편집·undo·redo)을 전역으로 직렬화한다. 낙관적 갱신과 undo/redo
// 히스토리 스택 조작이 await 경계에서 뒤섞여 잘못된 배치를 이동시키는 경쟁을 막는다
// (서버도 프로젝트별 mutation을 직렬화하므로 동작 의미가 일치한다).
// 실시간 수신 op도 같은 체인을 쓴다(use-realtime) — 내 mutation이 in-flight인 동안 남의 op가
// 끼어들어 낙관적 상태와 경합하는 것을 막는다.
let mutationChain: Promise<unknown> = Promise.resolve()
export function serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
  const run = mutationChain.then(fn, fn)
  mutationChain = run.then(() => undefined, () => undefined)
  return run
}

export function useModelLoader(projectId: string) {
  const trpc = useTRPC()
  const setLoaded = useEditorStore((s) => s.setLoaded)
  const setProjectConfig = useEditorStore((s) => s.setProjectConfig)
  const setPermissions = useEditorStore((s) => s.setPermissions)
  const query = useQuery(trpc.model.get.queryOptions({ projectId }))
  // 명명 규칙·방언은 프로젝트 설정(버전 모델 밖)이라 project.get으로 별도 로드해 store에 둔다.
  const projectQuery = useQuery(trpc.project.get.queryOptions({ projectId }))
  useEffect(() => {
    if (query.data && useEditorStore.getState().loadedProjectId !== projectId) {
      setLoaded(query.data.model, query.data.seq, projectId)
    }
  }, [query.data, setLoaded, projectId])
  useEffect(() => {
    if (projectQuery.data) {
      setProjectConfig(
        projectQuery.data.namingRules, projectQuery.data.dialects, projectQuery.data.name,
      )
      setPermissions({
        canEdit: projectQuery.data.canEdit,
        canManage: projectQuery.data.canManage,
      })
    }
  }, [projectQuery.data, setProjectConfig, setPermissions])
  return query
}

/**
 * 모델 변경의 결과.
 * - `applied`: 서버에 반영됨.
 * - `noop`: 바뀔 게 없어 아무것도 보내지 않음(사용자에게 알린 것도 없다).
 * - `error`: 거절·실패. 이미 toast.error로 사유를 알린 뒤다(프로젝트 전환 가드에 걸린 경우는 제외).
 *
 * `noop`과 `error`를 구분하지 않으면 "덮어쓰기인데 내용이 같은" 요청이 아무 반응 없이 끝난다.
 */
export type ModelMutationResult = 'applied' | 'noop' | 'error'

/** 모델 변경의 저수준 단일 경로. record=true면 undo 스택에 기록. */
function useSubmit(projectId: string) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const mutation = useMutation(trpc.model.mutate.mutationOptions())

  return useCallback(
    async (
      producer: (model: ProjectModel) => ProjectModel,
      opts: { summary?: string; record: boolean },
    ): Promise<ModelMutationResult> => {
      // mutation은 직렬화로 지연 실행될 수 있다. 프로젝트가 전환된 뒤 큐에 남은 producer가
      // 새 프로젝트의 모델을 읽거나(옛 프로젝트로 전송) 새 프로젝트 상태를 오염시키는 것을 막는다.
      if (useEditorStore.getState().loadedProjectId !== projectId) return 'error'
      // 편집 권한이 없으면 서버 왕복도 낙관적 적용도 하지 않는다. 서버가 이미 'edit' 게이트로
      // 막지만, 여기서 끊어야 낙관적 적용 → FORBIDDEN → resync 롤백으로 화면이 튀지 않는다.
      // ⚠️ 이 가드는 useSubmit 전용이다. serializeMutation이나 use-realtime에 넣으면 수신 op까지
      // 막혀 Viewer의 실시간 화면이 얼어붙는다(Viewer도 수신·presence는 정상 동작해야 한다).
      if (!useEditorStore.getState().canEdit) {
        toast.error('이 프로젝트에 대한 편집 권한이 없습니다')
        return 'error'
      }
      const store = useEditorStore.getState()
      const current = store.model
      let next: ProjectModel
      try {
        next = producer(current)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '변경을 적용할 수 없습니다')
        return 'error'
      }
      const ops = diffModels(current, next)
      if (ops.length === 0) return 'noop'

      const issues = validateModelIntegrity(next)
      if (issues.length > 0) {
        toast.error(issues[0]!.message)
        return 'error'
      }

      const seqBefore = store.seq
      store.setModel(next) // 낙관적
      // 모델에서 사라진 대상은 선택에서도 걷어낸다. **로컬 편집이 모델을 바꾸는 유일한 지점**이라
      // 여기 한 곳이면 툴바 삭제·undo(추가의 되돌리기)·DDL 임포트가 전부 같은 규칙을 탄다.
      // 남의 삭제 수신(use-realtime)·resync도 같은 keptSelection을 부르므로 규칙은 한 벌이다 —
      // 같은 삭제가 도착 경로에 따라 다른 결과를 내면 안 된다.
      // ⚠️ 위 `store`는 producer 실행 전에 뜬 스냅샷이다. pruneSelection이 읽어야 하는 것은
      // **지금 살아 있는** 선택이므로 반드시 getState()로 다시 집는다.
      useEditorStore.getState().pruneSelection(next)
      try {
        const { seq } = await mutation.mutateAsync({ projectId, ops, summary: opts.summary })
        // await 사이 프로젝트가 바뀌었으면 새 프로젝트의 seq/히스토리를 오염시키지 않는다.
        if (useEditorStore.getState().loadedProjectId !== projectId) return 'error'
        if (seq !== seqBefore + 1) {
          // 내 mutation이 서버 락에 대기하는 동안 다른 사용자의 revision이 끼어들었다.
          // 그 op는 use-realtime의 seq 체인에서 "이미 지나간 것"으로 오인돼 버려지므로,
          // 낙관적 로컬 상태를 버리고 서버의 최신 모델로 통째 되맞춘다.
          const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
          if (useEditorStore.getState().loadedProjectId === projectId) {
            useEditorStore.getState().resync(fresh.model, fresh.seq)
          }
        } else {
          useEditorStore.getState().setSeq(seq)
        }
        if (opts.record) useEditorStore.getState().recordEdit(ops)
        return 'applied'
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '변경을 저장하지 못했습니다')
        // 여전히 이 프로젝트를 보고 있을 때만 서버 상태로 복구한다(다른 프로젝트 화면 덮어쓰기 방지).
        if (useEditorStore.getState().loadedProjectId === projectId) {
          try {
            const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
            if (useEditorStore.getState().loadedProjectId === projectId) {
              // setLoaded가 아니라 **resync**다 — 같은 프로젝트를 서버 상태로 되맞추는 것이므로
              // 위 seq 간극 경로와 같은 함수여야 한다. 셋이 갈린다:
              // ① 그룹 뷰: 편집 하나가 거절됐다고 그룹 뷰에서 튕기면 안 된다(setLoaded는 튕긴다).
              // ② 참여자: setLoaded는 peers를 비워, 다음 presence 프레임까지 남들의 하이라이트가
              //    통째로 사라진다.
              // ③ 선택: **resync만 keptSelection을 탄다.** 남이 먼저 지운 테이블 때문에 내 op가
              //    거절된 경우, setLoaded면 모델에 없는 id가 선택에 남아 BulkPanel 헤더 개수와
              //    목록이 어긋나고 유령 presence가 나간다(설계 §4 — 사라진 대상은 모든 경로에서
              //    같은 한 규칙으로 걷어낸다).
              useEditorStore.getState().resync(fresh.model, fresh.seq)
            }
          } catch {
            toast.error('서버 상태를 복구하지 못했습니다. 새로고침해 주세요.')
          }
        }
        return 'error'
      }
    },
    [projectId, mutation, queryClient, trpc],
  )
}

/**
 * 모델 변경의 표준 진입점. 결과(ModelMutationResult)를 그대로 돌려주므로, 완료 토스트를 띄우는
 * 호출부는 반드시 await해서 `applied`일 때만 알려야 한다(서버 거절 뒤 "성공" 토스트 방지).
 * `noop`은 사용자에게 아무것도 알리지 않은 상태라 호출부가 직접 안내해야 한다.
 * 결과를 쓰지 않는 호출부는 지금처럼 void로 흘려보내면 된다.
 */
export function useModelMutation(projectId: string) {
  const submit = useSubmit(projectId)
  return useCallback(
    (
      producer: (model: ProjectModel) => ProjectModel, opts?: { summary?: string },
    ): Promise<ModelMutationResult> =>
      serializeMutation(() => submit(producer, { summary: opts?.summary, record: true })),
    [submit],
  )
}

/**
 * `useModelMutation`이 돌려주는 함수의 타입. 컴포넌트 밖의 편집 헬퍼(`applyGroupMove`·
 * `createGroupWith`)가 mutate를 인자로 받으므로 여러 모듈이 이 타입을 쓴다 — 선언은 출처인
 * 여기 하나다.
 */
export type Mutate = ReturnType<typeof useModelMutation>

export function useUndoRedo(projectId: string) {
  const submit = useSubmit(projectId)
  const undoStack = useEditorStore((s) => s.undoStack)
  const redoStack = useEditorStore((s) => s.redoStack)

  const undo = useCallback(
    () => serializeMutation(async () => {
      const stack = useEditorStore.getState().undoStack
      const ops = stack[stack.length - 1]
      if (!ops) return
      const r = await submit((m) => applyOps(m, invertOps(ops)), { summary: '실행 취소', record: false })
      if (r === 'applied') useEditorStore.getState().moveUndoToRedo()
    }),
    [submit],
  )

  const redo = useCallback(
    () => serializeMutation(async () => {
      const stack = useEditorStore.getState().redoStack
      const ops = stack[stack.length - 1]
      if (!ops) return
      const r = await submit((m) => applyOps(m, ops), { summary: '다시 실행', record: false })
      if (r === 'applied') useEditorStore.getState().moveRedoToUndo()
    }),
    [submit],
  )

  return { undo, redo, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 }
}
