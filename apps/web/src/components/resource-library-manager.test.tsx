import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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
  return queryClient
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

  it('항목 목록 조회 실패는 알림으로 보인다', async () => {
    renderManager({
      'resource.library.list': () => ({ data: LIBS }),
      'resource.items.list': () => ({ error: { code: -32004, message: '항목을 불러오지 못했습니다' } }),
    })
    await userEvent.click(await screen.findByRole('button', { name: /항목 3개/ }))
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('항목을 불러오지 못했습니다'))
  })

  it('항목을 만든다', async () => {
    const create = vi.fn(() => ({ data: { id: 'i3' } }))
    renderManager({
      'resource.library.list': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
      'resource.items.create': create,
    })
    await userEvent.click(await screen.findByRole('button', { name: /항목 3개/ }))
    await screen.findByText('회원')
    const wordSection = screen.getByText('단어').parentElement!.parentElement!
    await userEvent.click(within(wordSection).getByRole('button', { name: '추가' }))
    await userEvent.type(screen.getByLabelText(/논리명/), '주문')
    await userEvent.type(screen.getByLabelText(/물리 약어/), 'ORD')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      libraryId: 'l1',
      kind: 'word',
      payload: { logicalName: '주문', abbreviation: 'ORD', description: null },
    }))
  })

  it('항목을 수정한다', async () => {
    const update = vi.fn(() => ({ data: { ok: true } }))
    renderManager({
      'resource.library.list': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: ITEMS }),
      'resource.items.update': update,
    })
    await userEvent.click(await screen.findByRole('button', { name: /항목 3개/ }))
    await screen.findByText('회원')
    await userEvent.click(screen.getByRole('button', { name: '회원 편집' }))
    const nameInput = screen.getByLabelText(/논리명/)
    await userEvent.clear(nameInput)
    await userEvent.type(nameInput, '회원신규')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(update).toHaveBeenCalledWith({
      itemId: 'i1',
      payload: { logicalName: '회원신규', abbreviation: 'MBR', description: null },
    }))
  })

  it('쓰기 권한이 없어도 내보내기 버튼이 보이고, 가져오기·파일에서 만들기는 관리자에게만 보인다', async () => {
    renderManager({ 'resource.library.list': () => ({ data: LIBS }) }, { canManage: false })
    expect(await screen.findByRole('button', { name: '표준 사전(예시) 내보내기' })).toBeDefined()
    expect(screen.queryByRole('button', { name: '표준 사전(예시) 가져오기' })).toBeNull()
    expect(screen.queryByRole('button', { name: /파일에서 만들기/ })).toBeNull()
  })

  it('가져오기 완료는 펼쳐진 라이브러리가 아니라 가져온 라이브러리의 항목 쿼리를 무효화한다', async () => {
    const LIBS2 = [
      { id: 'a1', scope: 'global', orgId: null, name: '대상 A', description: '', itemCount: 1 },
      { id: 'b1', scope: 'global', orgId: null, name: '펼친 B', description: '', itemCount: 1 },
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
      'resource.items.list': () => ({ data: [] }),
      'resource.library.import': importFn,
    })
    await screen.findByText('대상 A')
    // B 를 펼쳐 둔 채로 A 의 가져오기를 실행한다 — 펼친 행과 가져오기 대상이 다를 수 있다.
    await userEvent.click(screen.getByRole('button', { name: /펼친 B.*항목 1개/ }))
    await screen.findByText('단어')
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    await userEvent.click(screen.getByRole('button', { name: '대상 A 가져오기' }))
    const file = new File(
      ['format: erdd-library\nformatVersion: 1\nlibrary: { name: 표준 }\n'], 'std.erdd-lib.yaml',
    )
    await userEvent.upload(await screen.findByLabelText('파일 선택'), file)
    await userEvent.click(await screen.findByRole('button', { name: '가져오기 실행' }))
    await waitFor(() => expect(invalidateSpy).toHaveBeenCalled())
    const invalidatedItemsKey = (libraryId: string) => invalidateSpy.mock.calls.some(([opts]) =>
      JSON.stringify((opts as { queryKey?: unknown } | undefined)?.queryKey) ===
      JSON.stringify([['resource', 'items', 'list'], { input: { libraryId }, type: 'query' }]))
    expect(invalidatedItemsKey('a1')).toBe(true)
    expect(invalidatedItemsKey('b1')).toBe(false)
  })
})
