import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { ResourceLibraryManager } from './resource-library-manager.js'

const COUNTS = { word: 3280, term: 13159, domain: 126, customField: 0 }
const LIBS = [
  { id: 'l1', scope: 'global', orgId: null, name: '표준 사전(예시)', description: '예시', itemCount: 16565, countsByKind: COUNTS },
]
const EMPTY_PAGE = () => ({ data: { items: [], total: 0 } })

function renderManager(
  handlers: Parameters<typeof mockTrpcFetch>[0],
  props: { canManage?: boolean } = {},
) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ResourceLibraryManager scope="global" canManage={props.canManage ?? true} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
  return queryClient
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('ResourceLibraryManager', () => {
  it('목록 행에 설명과 항목 수를 천 단위로 보인다', async () => {
    renderManager({ 'resource.library.list': () => ({ data: LIBS }) })
    expect(await screen.findByText('예시 · 항목 16,565개')).toBeInTheDocument()
  })

  it('행을 누르면 조회 모달이 열리고 items.list 는 부르지 않는다', async () => {
    const list = vi.fn(() => ({ data: [] }))
    renderManager({
      'resource.library.list': () => ({ data: LIBS }),
      'resource.items.list': list,
      'resource.items.page': EMPTY_PAGE,
    })
    await userEvent.click(await screen.findByRole('button', { name: /항목 16,565개/ }))
    expect(await screen.findByRole('dialog', { name: '라이브러리 조회 — 표준 사전(예시)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '단어 (3,280)' })).toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
  })

  it('라이브러리를 만든다', async () => {
    const create = vi.fn(() => ({ data: { id: 'l2' } }))
    renderManager({
      'resource.library.list': () => ({ data: LIBS }),
      'resource.library.create': create,
    })
    await screen.findByText('표준 사전(예시)')
    await userEvent.click(screen.getByRole('button', { name: '라이브러리 만들기' }))
    await userEvent.type(screen.getByLabelText('이름'), '새 사전')
    await userEvent.click(screen.getByRole('button', { name: '만들기' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'global', name: '새 사전' })))
  })

  it('canManage=false면 편집 컨트롤이 없다', async () => {
    renderManager({ 'resource.library.list': () => ({ data: LIBS }) }, { canManage: false })
    await screen.findByText('표준 사전(예시)')
    expect(screen.queryByRole('button', { name: '라이브러리 만들기' })).toBeNull()
  })

  it('라이브러리 삭제 확인 문구의 항목 수도 천 단위다', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderManager({ 'resource.library.list': () => ({ data: LIBS }) })
    await userEvent.click(await screen.findByRole('button', { name: '표준 사전(예시) 삭제' }))
    expect(confirm).toHaveBeenCalledWith('"표준 사전(예시)"을(를) 삭제하면 항목 16,565개도 함께 삭제됩니다. 계속할까요?')
  })

  it('쓰기 권한이 없어도 내보내기 버튼이 보이고, 가져오기·파일에서 만들기는 관리자에게만 보인다', async () => {
    renderManager({ 'resource.library.list': () => ({ data: LIBS }) }, { canManage: false })
    expect(await screen.findByRole('button', { name: '표준 사전(예시) 내보내기' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '표준 사전(예시) 가져오기' })).toBeNull()
    expect(screen.queryByRole('button', { name: /파일에서 만들기/ })).toBeNull()
  })

  it('가져오기 완료는 가져온 라이브러리의 항목 페이지·도메인 목록 쿼리만 무효화한다', async () => {
    const LIBS2 = [
      { id: 'a1', scope: 'global', orgId: null, name: '대상 A', description: '', itemCount: 1, countsByKind: { ...COUNTS, word: 1 } },
      { id: 'b1', scope: 'global', orgId: null, name: '다른 B', description: '', itemCount: 1, countsByKind: { ...COUNTS, word: 1 } },
    ]
    const importFn = vi.fn((input: unknown) => ({
      data: {
        libraryId: 'a1',
        applied: !(input as { dryRun: boolean }).dryRun,
        stateHash: 'h',
        summary: { counts: { add: 1, update: 0, unchanged: 0, stale: 0, remove: 0, removeBlocked: 0 }, warnings: [], entries: [] },
      },
    }))
    const queryClient = renderManager({
      'resource.library.list': () => ({ data: LIBS2 }),
      'resource.items.page': EMPTY_PAGE,
      'resource.library.import': importFn,
    })
    await screen.findByText('대상 A')
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    await userEvent.click(screen.getByRole('button', { name: '대상 A 가져오기' }))
    const file = new File(
      ['format: erdd-library\nformatVersion: 1\nlibrary: { name: 표준 }\n'], 'std.erdd-lib.yaml',
    )
    await userEvent.upload(await screen.findByLabelText('파일 선택'), file)
    await userEvent.click(await screen.findByRole('button', { name: '가져오기 실행' }))
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled())
    const invalidatedPage = (libraryId: string) => invalidateSpy.mock.calls.some(([opts]) =>
      JSON.stringify((opts as { queryKey?: unknown } | undefined)?.queryKey) ===
      JSON.stringify([['resource', 'items', 'page'], { input: { libraryId }, type: 'query' }]))
    expect(invalidatedPage('a1')).toBe(true)
    expect(invalidatedPage('b1')).toBe(false)
    const invalidatedDomains = (libraryId: string) => invalidateSpy.mock.calls.some(([opts]) =>
      JSON.stringify((opts as { queryKey?: unknown } | undefined)?.queryKey) ===
      JSON.stringify(['library-domain-options', libraryId]))
    expect(invalidatedDomains('a1')).toBe(true)
    expect(invalidatedDomains('b1')).toBe(false)
  })
})
