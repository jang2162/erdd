import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { ResourceLibraryManager } from './resource-library-manager.js'

const LIBS = [
  { id: 'l1', scope: 'global', orgId: null, name: '표준 사전(예시)', description: '예시', itemCount: 3 },
]
const ITEMS = [
  { id: 'i1', kind: 'word', version: 1, payload: { logicalName: '회원', abbreviation: 'MBR', description: null } },
  { id: 'i2', kind: 'domain', version: 2, payload: { name: '금액' } },
]

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
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ResourceLibraryManager', () => {
  it('라이브러리 목록과 항목 수를 보여준다', async () => {
    renderManager({ 'resource.library.list': () => ({ data: LIBS }) })
    await waitFor(() => expect(screen.getByText('표준 사전(예시)')).toBeDefined())
    // 설명과 항목 수는 한 span에 함께 렌더되므로 부분 일치(정규식)로 찾는다.
    expect(screen.getByText(/항목 3개/)).toBeDefined()
  })

  it('라이브러리를 고르면 항목을 종류별로 보여준다', async () => {
    renderManager({
      'resource.library.list': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
    })
    // 삭제 버튼의 aria-label도 라이브러리 이름을 포함하므로 목록 버튼만 잡히는 조건을 쓴다.
    await userEvent.click(await screen.findByRole('button', { name: /항목 3개/ }))
    await waitFor(() => expect(screen.getByText('회원')).toBeDefined())
    expect(screen.getByText('금액')).toBeDefined()
    expect(screen.getByText('도메인')).toBeDefined()
    expect(screen.getByText('단어')).toBeDefined()
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

  it('항목 삭제는 확인을 받는다', async () => {
    const remove = vi.fn(() => ({ data: { ok: true } }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderManager({
      'resource.library.list': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
      'resource.items.remove': remove,
    })
    await userEvent.click(await screen.findByRole('button', { name: /항목 3개/ }))
    await screen.findByText('회원')
    await userEvent.click(screen.getByRole('button', { name: '회원 삭제' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ itemId: 'i1' }))
  })
})
