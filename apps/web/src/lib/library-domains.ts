import { useQuery, useQueryClient } from '@tanstack/react-query'
import { resourceDisplayName } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import type { DomainOption } from '@/components/resource-item-form'

/** 도메인 전체를 받을 때의 페이지 크기 — `items.page` 의 limit 상한이다. */
export const DOMAIN_PAGE_LIMIT = 200

/** 라이브러리 도메인 전체 목록의 캐시 키. 항목을 추가·수정·삭제·가져오기한 뒤 `items.page` 와 함께 무효화한다. */
export function libraryDomainsQueryKey(libraryId: string) {
  return ['library-domain-options', libraryId] as const
}

/**
 * `items.page({ kind: 'domain' })` 를 페이지 끝까지 넘기며 도메인 전부를 모은다(도메인은 수백 건 수준).
 * 그 사이 지워져 짧은 페이지가 오면 거기서 멈춘다.
 */
export async function fetchAllDomainOptions(
  fetchPage: (offset: number) => Promise<{ items: { id: string; payload: Record<string, unknown> }[]; total: number }>,
): Promise<DomainOption[]> {
  const out: DomainOption[] = []
  for (let offset = 0; ; offset += DOMAIN_PAGE_LIMIT) {
    const page = await fetchPage(offset)
    for (const item of page.items) out.push({ id: item.id, name: resourceDisplayName('domain', item.payload) })
    if (page.items.length < DOMAIN_PAGE_LIMIT || offset + DOMAIN_PAGE_LIMIT >= page.total) return out
  }
}

/**
 * 라이브러리 도메인 전체 — 용어 폼의 도메인 선택지, 용어 표의 도메인 칸, Excel 가져오기의 도메인 이름 해석이 쓴다.
 * 항목 전체(`items.list`)를 받지 않는다.
 */
export function useLibraryDomains(libraryId: string | null, enabled: boolean) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: libraryDomainsQueryKey(libraryId ?? ''),
    queryFn: () => fetchAllDomainOptions((offset) => queryClient.fetchQuery(
      trpc.resource.items.page.queryOptions({
        libraryId: libraryId!, kind: 'domain', offset, limit: DOMAIN_PAGE_LIMIT,
      }),
    )),
    enabled: enabled && libraryId !== null,
  })
}
