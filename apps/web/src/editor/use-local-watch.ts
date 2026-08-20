import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { serializeMutation } from './use-model.js'

/**
 * 로컬 서버의 파일 감시 알림을 받아 모델을 되맞춘다.
 *
 * 로컬 모드에는 실시간 협업이 없으므로 op 브로드캐스트도 presence 도 없다 —
 * 필요한 것은 "밖에서 파일이 바뀌었다" 한 줄뿐이라 SSE 로 충분하다.
 */
export function useLocalWatch(projectId: string, enabled: boolean): void {
  const trpc = useTRPC()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled || projectId === '') return
    const es = new EventSource('/local/events')
    // reload 재조회는 await 구간을 거치므로, 그 사이 도착한 blocked 가 최신 판단이다.
    // 늦게 끝난 reload 가 그것을 덮어쓰지 못하도록 이벤트마다 세대를 매겨 자기 세대가
    // 여전히 최신일 때만 잠금을 푼다(use-model.ts 의 loadedProjectId 가드와 같은 정신).
    let generation = 0
    es.onmessage = (e) => {
      let payload: unknown
      try { payload = JSON.parse(e.data) } catch { return }
      const type = (payload as { type?: string }).type
      if (type === 'blocked') {
        generation += 1
        useEditorStore.getState().setBlocked(
          (payload as { failures: { path: string; message: string }[] }).failures,
        )
        return
      }
      if (type !== 'reload') return
      generation += 1
      const myGeneration = generation
      // 내 편집이 in-flight 인 동안 끼어들어 낙관적 상태와 경합하지 않도록 같은 체인을 탄다
      // (use-realtime 이 수신 op 를 다루는 방식과 같다).
      void serializeMutation(async () => {
        try {
          const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
          if (useEditorStore.getState().loadedProjectId !== projectId) return
          // setLoaded 가 아니라 resync 다 — resync 만 keptSelection 을 타서 사라진 대상이
          // 선택에 남지 않고, 그룹 뷰에서 튕기지 않는다(use-model.ts 의 주석 참조).
          useEditorStore.getState().resync(fresh.model, fresh.seq)
          // 갱신이 성공한 뒤에만 잠금을 푼다 — 재조회 실패 전에 먼저 풀면 "잠금 해제 + 낡은
          // 모델 + 무고지" 상태가 된다. 단, 재조회가 도는 동안 더 최신 이벤트(주로 blocked)가
          // 왔으면 이 reload는 이미 낡았다 — 그 판단을 덮어쓰지 않는다.
          if (myGeneration === generation) useEditorStore.getState().setBlocked(null)
        } catch {
          toast.error('파일 변경을 반영하지 못했습니다. 새로고침해 주세요.')
        }
      })
    }
    return () => { es.close() }
  }, [enabled, projectId, queryClient, trpc])
}
