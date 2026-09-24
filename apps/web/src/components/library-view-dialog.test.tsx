import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { LibraryViewDialog, type ItemRow, type ViewedLibrary } from './library-view-dialog'

type PageInput = { libraryId: string; kind: string; query?: string; offset: number; limit: number }

/** 서버 items.page 흉내 — 종류로 거르고 payload 문자열 칸에서 찾는다. rows 는 부를 때마다 다시 읽는다(삭제 반영). */
function pageHandler(rows: () => ItemRow[]) {
  return vi.fn((input: unknown) => {
    const { kind, query, offset, limit } = input as PageInput
    const q = (query ?? '').trim().toLowerCase()
    const hit = rows().filter((r) => r.kind === kind
      && (q === '' || Object.values(r.payload).some((v) => typeof v === 'string' && v.toLowerCase().includes(q))))
    return { data: { items: hit.slice(offset, offset + limit), total: hit.length } }
  })
}

const pad = (i: number) => String(i).padStart(3, '0')
const word = (i: number): ItemRow => ({
  id: `w${i}`, kind: 'word', version: 1,
  payload: { logicalName: `w${pad(i)}`, abbreviation: `A${pad(i)}`, englishName: null, description: null },
})
const words = (n: number) => Array.from({ length: n }, (_, i) => word(i))

const LIB: ViewedLibrary = {
  id: 'l1', name: '표준 사전', countsByKind: { word: 3280, term: 13159, domain: 126, customField: 0 },
}

function renderDialog(
  handlers: Parameters<typeof mockTrpcFetch>[0],
  props: { canManage?: boolean } = {},
) {
  mockTrpcFetch(handlers)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const onChanged = vi.fn(async () => undefined)
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <LibraryViewDialog library={LIB} canManage={props.canManage ?? true} onClose={() => {}} onChanged={onChanged} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
  return { queryClient, onChanged }
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('LibraryViewDialog', () => {
  it('제목과 종류별 탭에 개수를 천 단위로 보이고 처음에는 단어 탭이다 — 행에 물리명 칸이 있다', async () => {
    renderDialog({ 'resource.items.page': pageHandler(() => words(3)) })
    expect(screen.getByRole('dialog', { name: '라이브러리 조회 — 표준 사전' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '단어 (3,280)' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '용어 (13,159)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '도메인 (126)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '커스텀 항목 (0)' })).toBeInTheDocument()
    expect(await screen.findByText('w000')).toBeInTheDocument()
    expect(screen.getByText('A000')).toBeInTheDocument()
  })

  it('다음 쪽은 offset 을 바꿔 부르고, 검색어를 바꾸면 1쪽부터 다시 부른다', async () => {
    const page = pageHandler(() => words(120))
    renderDialog({ 'resource.items.page': page })
    await screen.findByText('w000')
    expect(screen.getByText('1 / 3')).toBeInTheDocument()
    const list = screen.getByText('w000').closest<HTMLElement>('[class*="overflow-y-auto"]')!
    list.scrollTop = 400                                        // 끝까지 내려 「다음」을 누른다
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('w050')).toBeInTheDocument()
    expect(list.scrollTop).toBe(0)
    expect(page).toHaveBeenCalledWith(expect.objectContaining({ kind: 'word', offset: 50, limit: 50 }))
    await userEvent.type(screen.getByRole('textbox', { name: '단어 검색' }), 'w11')
    await waitFor(() => expect(page).toHaveBeenCalledWith(expect.objectContaining({ query: 'w11', offset: 0 })))
    expect(await screen.findByText('w110')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다음' })).toBeNull()   // 10건 — 한 쪽이라 페이지 이동이 숨는다
  })

  it('검색은 입력이 300ms 멎은 뒤 마지막 검색어로 한 번만 부른다', async () => {
    const page = pageHandler(() => words(120))
    renderDialog({ 'resource.items.page': page })
    await screen.findByText('w000')
    const queried = () => page.mock.calls.flatMap(([input]) => {
      const q = (input as PageInput).query
      return q === undefined ? [] : [q]
    })
    await userEvent.type(screen.getByRole('textbox', { name: '단어 검색' }), 'w11')
    const typedAt = Date.now()
    expect(queried()).toEqual([])   // 치는 동안에는 부르지 않는다
    await waitFor(() => expect(queried()).toEqual(['w11']))
    // 타이머는 일찍 울리지 않는다 — 마지막 키 입력에서 300ms 가까이 지나서야 불린다.
    expect(Date.now() - typedAt).toBeGreaterThanOrEqual(250)
  })

  it('검색어는 서버 상한 200자를 넘겨 입력되지 않는다', async () => {
    const page = pageHandler(() => words(3))
    renderDialog({ 'resource.items.page': page })
    await screen.findByText('w000')
    const box = screen.getByRole('textbox', { name: '단어 검색' })
    await userEvent.click(box)
    await userEvent.paste('가'.repeat(250))
    expect(box).toHaveValue('가'.repeat(200))
    await waitFor(() => expect(page).toHaveBeenCalledWith(expect.objectContaining({ query: '가'.repeat(200) })))
    expect(page).not.toHaveBeenCalledWith(expect.objectContaining({ query: '가'.repeat(250) }))
  })

  it('검색 결과가 여러 쪽이어도 검색어를 바꾸면 1쪽으로 간다', async () => {
    const page = pageHandler(() => words(200))
    renderDialog({ 'resource.items.page': page })
    await screen.findByText('w000')
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(await screen.findByText('w050')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox', { name: '단어 검색' }), 'w1')   // w100~w199 — 100건, 두 쪽
    expect(await screen.findByText('w100')).toBeInTheDocument()
    expect(screen.getByText('1 / 2')).toBeInTheDocument()
    expect(page).not.toHaveBeenCalledWith(expect.objectContaining({ query: 'w1', offset: 50 }))
  })

  it('탭을 옮겼다 돌아와도 그 탭의 검색어가 남는다', async () => {
    renderDialog({ 'resource.items.page': pageHandler(() => words(3)) })
    await screen.findByText('w000')
    await userEvent.type(screen.getByRole('textbox', { name: '단어 검색' }), 'w00')
    await userEvent.click(screen.getByRole('tab', { name: '용어 (13,159)' }))
    expect(screen.getByRole('textbox', { name: '용어 검색' })).toHaveValue('')
    await userEvent.click(screen.getByRole('tab', { name: '단어 (3,280)' }))
    expect(screen.getByRole('textbox', { name: '단어 검색' })).toHaveValue('w00')
  })

  it('결과가 없으면 검색 중과 빈 탭을 구별해 알린다', async () => {
    renderDialog({ 'resource.items.page': pageHandler(() => words(3)) })
    await screen.findByText('w000')
    await userEvent.type(screen.getByRole('textbox', { name: '단어 검색' }), 'zzz')
    expect(await screen.findByText('검색 결과가 없습니다')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: '커스텀 항목 (0)' }))
    expect(await screen.findByText('항목이 없습니다')).toBeInTheDocument()
  })

  it('관리 권한이 없으면 추가·편집·삭제 버튼이 없다', async () => {
    renderDialog({ 'resource.items.page': pageHandler(() => words(3)) }, { canManage: false })
    await screen.findByText('w000')
    expect(screen.queryByRole('button', { name: '추가' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'w000 편집' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'w000 삭제' })).toBeNull()
  })

  it('마지막 쪽의 마지막 항목을 지우면 남은 마지막 쪽으로 물러난다', async () => {
    let rows = words(51)
    const remove = vi.fn((input: unknown) => {
      rows = rows.filter((r) => r.id !== (input as { itemId: string }).itemId)
      return { data: { ok: true } }
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { onChanged } = renderDialog({ 'resource.items.page': pageHandler(() => rows), 'resource.items.remove': remove })
    await screen.findByText('w000')
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    await userEvent.click(await screen.findByRole('button', { name: 'w050 삭제' }))
    await waitFor(() => expect(remove).toHaveBeenCalledWith({ itemId: 'w50' }))
    expect(await screen.findByText('w000')).toBeInTheDocument()
    // 물러난 1쪽은 캐시(전체 51건)가 먼저 보이고 무효화된 재조회가 오면 한 쪽으로 준다 — 그래서 기다린다.
    await waitFor(() => expect(screen.queryByRole('button', { name: '다음' })).toBeNull())
    expect(onChanged).toHaveBeenCalled()
  })

  it('용어 탭은 물리명과 도메인 이름을 보인다 — 도메인은 200건씩 끝까지 받아 id 를 푼다', async () => {
    const rows: ItemRow[] = [
      { id: 'd1', kind: 'domain', version: 1, payload: { name: '금액', category: null, logicalType: 'DECIMAL(15)' } },
      { id: 't1', kind: 'term', version: 2, payload: { logicalName: '판매금액', physicalName: 'SALE_AMT', domainId: 'd1', description: null } },
    ]
    const page = pageHandler(() => rows)
    renderDialog({ 'resource.items.page': page })
    await userEvent.click(screen.getByRole('tab', { name: '용어 (13,159)' }))
    expect(await screen.findByText('SALE_AMT')).toBeInTheDocument()
    expect(await screen.findByText('금액')).toBeInTheDocument()
    expect(screen.getByText('v2')).toBeInTheDocument()
    expect(page).toHaveBeenCalledWith(expect.objectContaining({ kind: 'domain', offset: 0, limit: 200 }))
  })

  it('항목을 추가하면 그 라이브러리·종류로 만들고 항목 페이지·도메인 목록·목록 개수를 무효화한다', async () => {
    const create = vi.fn(() => ({ data: { id: 'w9' } }))
    const { queryClient, onChanged } = renderDialog({
      'resource.items.page': pageHandler(() => words(1)), 'resource.items.create': create,
    })
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    await screen.findByText('w000')
    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    await userEvent.type(screen.getByLabelText(/논리명/), '주문')
    await userEvent.type(screen.getByLabelText(/물리 약어/), 'ORD')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(create).toHaveBeenCalledWith({
      libraryId: 'l1', kind: 'word', payload: expect.objectContaining({ logicalName: '주문', abbreviation: 'ORD' }),
    }))
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    const keys = invalidate.mock.calls.map(([f]) => JSON.stringify((f as { queryKey?: unknown } | undefined)?.queryKey))
    expect(keys).toContain(JSON.stringify([['resource', 'items', 'page'], { input: { libraryId: 'l1' }, type: 'query' }]))
    expect(keys).toContain(JSON.stringify(['library-domain-options', 'l1']))
  })
})
