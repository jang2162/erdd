import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  LOCAL_CHANGES_CREATE_PATH, LOCAL_CHANGES_PATH,
  type LocalChangesCreateResult, type LocalChangesStatus,
} from '@erdd/core'

/** `use-local-watch.ts` 가 로컬 이벤트마다 이 키를 무효화한다. */
export const LOCAL_CHANGES_QUERY_KEY = ['local-changes'] as const

/**
 * tRPC 밖 로컬 전용 채널이다(`local-protocol.ts`). **상태 코드를 본다** — 500·403 을 그대로
 * 캐스트하면 약속하지 않은 모양이 화면으로 샌다(`use-local-save.ts` 와 같은 이유).
 */
async function postJson(path: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!res.ok) throw new Error(`요청이 실패했습니다 (HTTP ${res.status})`)
  return res.json()
}

export function useLocalChanges() {
  return useQuery({
    queryKey: LOCAL_CHANGES_QUERY_KEY,
    queryFn: async () => await postJson(LOCAL_CHANGES_PATH) as LocalChangesStatus,
  })
}

export function useCreateLocalChange() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string }) => await postJson(LOCAL_CHANGES_CREATE_PATH, input) as LocalChangesCreateResult,
    onSettled: async () => { await queryClient.invalidateQueries({ queryKey: LOCAL_CHANGES_QUERY_KEY }) },
  })
}
