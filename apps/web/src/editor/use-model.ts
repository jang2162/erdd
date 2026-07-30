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
      setProjectConfig(projectQuery.data.namingRules, projectQuery.data.dialects)
    }
  }, [projectQuery.data, setProjectConfig])
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

      store.setModel(next) // 낙관적
      try {
        const { seq } = await mutation.mutateAsync({ projectId, ops, summary: opts.summary })
        // await 사이 프로젝트가 바뀌었으면 새 프로젝트의 seq/히스토리를 오염시키지 않는다.
        if (useEditorStore.getState().loadedProjectId !== projectId) return 'error'
        useEditorStore.getState().setSeq(seq)
        if (opts.record) useEditorStore.getState().recordEdit(ops)
        return 'applied'
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '변경을 저장하지 못했습니다')
        // 여전히 이 프로젝트를 보고 있을 때만 서버 상태로 복구한다(다른 프로젝트 화면 덮어쓰기 방지).
        if (useEditorStore.getState().loadedProjectId === projectId) {
          try {
            const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
            if (useEditorStore.getState().loadedProjectId === projectId) {
              useEditorStore.getState().setLoaded(fresh.model, fresh.seq, projectId)
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
