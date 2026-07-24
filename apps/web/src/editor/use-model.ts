import { useCallback, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { diffModels, validateModelIntegrity, type ProjectModel } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'

/** model.get을 스토어에 적재한다. */
export function useModelLoader(projectId: string) {
  const trpc = useTRPC()
  const setLoaded = useEditorStore((s) => s.setLoaded)
  const query = useQuery(trpc.model.get.queryOptions({ projectId }))
  useEffect(() => {
    if (query.data && !useEditorStore.getState().loaded) {
      setLoaded(query.data.model, query.data.seq)
    }
  }, [query.data, setLoaded])
  return query
}

/**
 * 모델 변경의 단일 경로. producer가 다음 모델을 만들면 diffModels로 op을 도출해
 * 낙관적으로 스토어에 반영하고 서버에 전송한다. 실패 시 서버 상태로 재로드한다.
 */
export function useModelMutation(projectId: string) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const mutation = useMutation(trpc.model.mutate.mutationOptions())

  return useCallback(
    async (producer: (model: ProjectModel) => ProjectModel, opts?: { summary?: string }) => {
      const store = useEditorStore.getState()
      const current = store.model
      const next = producer(current)
      const ops = diffModels(current, next)
      if (ops.length === 0) return

      const issues = validateModelIntegrity(next)
      if (issues.length > 0) {
        toast.error(issues[0]!.message)
        return
      }

      store.setModel(next) // 낙관적
      try {
        const { seq } = await mutation.mutateAsync({ projectId, ops, summary: opts?.summary })
        useEditorStore.getState().setSeq(seq)
      } catch (err) {
        const message = err instanceof Error ? err.message : '변경을 저장하지 못했습니다'
        toast.error(message)
        const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
        useEditorStore.getState().setLoaded(fresh.model, fresh.seq)
      }
    },
    [projectId, mutation, queryClient, trpc],
  )
}
