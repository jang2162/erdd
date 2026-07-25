import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { applyOps, diffModels, invertOps, validateModelIntegrity, type ProjectModel } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'

// 모든 모델 mutation(정상 편집·undo·redo)을 전역으로 직렬화한다. 낙관적 갱신과 undo/redo
// 히스토리 스택 조작이 await 경계에서 뒤섞여 잘못된 배치를 이동시키는 경쟁을 막는다
// (서버도 프로젝트별 mutation을 직렬화하므로 동작 의미가 일치한다).
let mutationChain: Promise<unknown> = Promise.resolve()
function serializeMutation<T>(fn: () => Promise<T>): Promise<T> {
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

/** 모델 변경의 저수준 단일 경로. 성공 시 true. record=true면 undo 스택에 기록. */
function useSubmit(projectId: string) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const mutation = useMutation(trpc.model.mutate.mutationOptions())

  return useCallback(
    async (
      producer: (model: ProjectModel) => ProjectModel,
      opts: { summary?: string; record: boolean },
    ): Promise<boolean> => {
      // mutation은 직렬화로 지연 실행될 수 있다. 프로젝트가 전환된 뒤 큐에 남은 producer가
      // 새 프로젝트의 모델을 읽거나(옛 프로젝트로 전송) 새 프로젝트 상태를 오염시키는 것을 막는다.
      if (useEditorStore.getState().loadedProjectId !== projectId) return false
      const store = useEditorStore.getState()
      const current = store.model
      let next: ProjectModel
      try {
        next = producer(current)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : '변경을 적용할 수 없습니다')
        return false
      }
      const ops = diffModels(current, next)
      if (ops.length === 0) return false

      const issues = validateModelIntegrity(next)
      if (issues.length > 0) {
        toast.error(issues[0]!.message)
        return false
      }

      store.setModel(next) // 낙관적
      try {
        const { seq } = await mutation.mutateAsync({ projectId, ops, summary: opts.summary })
        // await 사이 프로젝트가 바뀌었으면 새 프로젝트의 seq/히스토리를 오염시키지 않는다.
        if (useEditorStore.getState().loadedProjectId !== projectId) return false
        useEditorStore.getState().setSeq(seq)
        if (opts.record) useEditorStore.getState().recordEdit(ops)
        return true
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
        return false
      }
    },
    [projectId, mutation, queryClient, trpc],
  )
}

export function useModelMutation(projectId: string) {
  const submit = useSubmit(projectId)
  return useCallback(
    (producer: (model: ProjectModel) => ProjectModel, opts?: { summary?: string }) =>
      serializeMutation(() => submit(producer, { summary: opts?.summary, record: true })).then(() => undefined),
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
      const ok = await submit((m) => applyOps(m, invertOps(ops)), { summary: '실행 취소', record: false })
      if (ok) useEditorStore.getState().moveUndoToRedo()
    }),
    [submit],
  )

  const redo = useCallback(
    () => serializeMutation(async () => {
      const stack = useEditorStore.getState().redoStack
      const ops = stack[stack.length - 1]
      if (!ops) return
      const ok = await submit((m) => applyOps(m, ops), { summary: '다시 실행', record: false })
      if (ok) useEditorStore.getState().moveRedoToUndo()
    }),
    [submit],
  )

  return { undo, redo, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 }
}
