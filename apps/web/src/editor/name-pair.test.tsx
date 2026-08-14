import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { createWord } from './dict-edits.js'
import { updateTable } from './model-edits.js'
import { NamePair } from './name-pair.js'

const PROJECT = '018f6b0e-0000-7000-8000-0000000000aa'

/** 단어 사전을 채운 모델을 store에 싣는다. t2 = 회원/MBR. */
function loadModel(over?: { logicalName?: string; physicalName?: string }) {
  let m = buildSampleModel()
  m = createWord(m, { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null })
  m = createWord(m, { id:'w2', logicalName:'주문', abbreviation:'ORD', englishName:null, description:null, origin:null })
  m = createWord(m, { id:'w3', logicalName:'번호', abbreviation:'NO', englishName:null, description:null, origin:null })
  if (over) m = updateTable(m, 't2', over)
  useEditorStore.getState().setLoaded(m, 1, PROJECT)
  grantEditPermission()
}

function renderPair(canEdit = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  const table = useEditorStore.getState().model.tables['t2']!
  render(
    <NamePair
      projectId={PROJECT}
      logicalName={table.logicalName}
      physicalName={table.physicalName}
      idPrefix="tbl"
      physicalLabel="테이블 물리명"
      canEdit={canEdit}
      applyNames={(m, patch) => updateTable(m, 't2', patch)}
    />,
    { wrapper: w },
  )
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('NamePair', () => {
  it('blur 하면 값을 커밋한다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel()
    renderPair()
    const input = screen.getByLabelText(/테이블 물리명/) as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'MEMBER')
    await userEvent.tab()
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MEMBER'))
  })

  it('Enter 로도 커밋한다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel()
    renderPair()
    const input = screen.getByLabelText(/테이블 물리명/) as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, 'MEMBER{Enter}')
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MEMBER'))
  })

  // ⚠️ 이 트랙의 핵심 회귀. onMouseDown 의 preventDefault 를 지우면 빨개진다.
  it('치고 blur 없이 재생성을 누르면 방금 친 값을 기준으로 돈다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주문번호')      // blur 하지 않는다
    await userEvent.click(screen.getByRole('button', { name: '물리명 재생성' }))
    await waitFor(() => {
      const t = useEditorStore.getState().model.tables['t2']!
      expect(t.physicalName).toBe('MBR_ORD_NO')      // 옛 값('회원')이면 'MBR' 이 나온다
      expect(t.logicalName).toBe('회원주문번호')       // 친 값도 함께 확정된다
    })
  })

  it('재생성 한 번이 뮤테이션 한 건이다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주문번호')
    await userEvent.click(screen.getByRole('button', { name: '물리명 재생성' }))
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MBR_ORD_NO'))
    expect(calls).toHaveLength(1)
  })

  it('논리명 재생성은 물리명을 기준으로 돈다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '', physicalName: 'MBR_ORD' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '논리명 재생성' }))
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.logicalName).toBe('회원주문'))
  })

  it('복원할 수 없으면 사유를 토스트로 알린다', async () => {
    const { toast } = await import('sonner')
    const spy = vi.spyOn(toast, 'error').mockImplementation(() => '' as never)
    loadModel({ logicalName: '', physicalName: 'MBR_XXX' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '논리명 재생성' }))
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('XXX'))
    expect(useEditorStore.getState().model.tables['t2']!.logicalName).toBe('')
  })

  it('물리명을 커밋할 때 논리명이 비어 있으면 함께 채운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '', physicalName: '' })
    renderPair()
    const input = screen.getByLabelText(/테이블 물리명/) as HTMLInputElement
    await userEvent.type(input, 'MBR_ORD')
    await userEvent.tab()
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.logicalName).toBe('회원주문'))
  })

  it('논리명이 이미 있으면 물리명 커밋이 그것을 덮지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '기존이름', physicalName: '' })
    renderPair()
    const input = screen.getByLabelText(/테이블 물리명/) as HTMLInputElement
    await userEvent.type(input, 'MBR_ORD')
    await userEvent.tab()
    await waitFor(() => expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MBR_ORD'))
    expect(useEditorStore.getState().model.tables['t2']!.logicalName).toBe('기존이름')
  })

  it('읽기 전용이면 재생성 버튼이 없고 입력이 readOnly 다', () => {
    loadModel()
    useEditorStore.setState({ canEdit: false })
    renderPair(false)
    expect(screen.queryByRole('button', { name: '물리명 재생성' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('논리명')).toHaveAttribute('readonly')
  })
})

describe('NamePair 자동완성', () => {
  it('논리명 꼬리에 맞는 후보를 목록으로 낸다', async () => {
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주')
    const list = await screen.findByRole('listbox')
    expect(list).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /주문/ })).toBeInTheDocument()
  })

  it('사전 단어로 딱 떨어지면 목록이 없다', async () => {
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주문')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('클릭으로 확정하면 꼬리만 치환되고 커밋은 나가지 않는다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주')
    await userEvent.click(await screen.findByRole('option', { name: /주문/ }))
    expect(logical.value).toBe('회원주문')
    expect(calls).toHaveLength(0)                 // 확정은 커밋이 아니다
    expect(useEditorStore.getState().model.tables['t2']!.logicalName).toBe('회원')
  })

  it('아래 화살표 + Enter 로 확정하고, 그 Enter 는 커밋으로 내려가지 않는다', async () => {
    const calls: unknown[] = []
    mockTrpcFetch({ 'model.mutate': (input) => { calls.push(input); return { data: { seq: 2 } } } })
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{ArrowDown}{Enter}')
    expect(logical.value).toBe('회원주문')
    expect(calls).toHaveLength(0)
  })

  it('Esc 로 닫고, 한 글자 더 치면 다시 열린다', async () => {
    loadModel()
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    // 닫은 뒤 한 글자 더 치면 다시 열린다
    await userEvent.type(logical, '문')
    expect(logical.value).toBe('회원주문')
  })

  it('목록을 닫는 Esc 는 상위로 전파되지 않는다', async () => {
    const onKeyDown = vi.fn()
    loadModel()
    // 상위 감시자를 끼운 래퍼로 다시 렌더한다(renderPair 와 같은 provider 를 쓴다).
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
    const table = useEditorStore.getState().model.tables['t2']!
    render(
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
          {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
          <div onKeyDown={onKeyDown}>
            <NamePair
              projectId={PROJECT}
              logicalName={table.logicalName}
              physicalName={table.physicalName}
              idPrefix="tbl"
              physicalLabel="테이블 물리명"
              canEdit
              applyNames={(m, patch) => updateTable(m, 't2', patch)}
            />
          </div>
        </TRPCProvider>
      </QueryClientProvider>,
    )
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.clear(logical)
    await userEvent.type(logical, '회원주')
    await screen.findByRole('listbox')
    onKeyDown.mockClear()
    await userEvent.keyboard('{Escape}')
    expect(onKeyDown).not.toHaveBeenCalled()
  })

  it('물리명에서는 약어를 제안한다', async () => {
    loadModel()
    renderPair()
    const physical = screen.getByLabelText(/테이블 물리명/) as HTMLInputElement
    await userEvent.clear(physical)
    await userEvent.type(physical, 'MBR_OR')
    expect(await screen.findByRole('option', { name: /ORD/ })).toBeInTheDocument()
  })

  it('읽기 전용이면 목록이 열리지 않는다', async () => {
    loadModel()
    useEditorStore.setState({ canEdit: false })
    renderPair(false)
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.click(logical)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('NamePair 미등록 칩', () => {
  it('커밋된 논리명의 미등록 단어를 칩으로 낸다', () => {
    loadModel({ logicalName: '회원쿠폰', physicalName: 'MBR' })
    renderPair()
    expect(screen.getByRole('button', { name: '쿠폰 등록' })).toBeInTheDocument()
  })

  it('타이핑 중에는 칩이 바뀌지 않는다(커밋된 값 기준)', async () => {
    loadModel({ logicalName: '회원', physicalName: 'MBR' })
    renderPair()
    const logical = screen.getByLabelText('논리명') as HTMLInputElement
    await userEvent.type(logical, '쿠')
    expect(screen.queryByRole('button', { name: '쿠 등록' })).not.toBeInTheDocument()
  })

  it('칩을 누르면 약어 입력이 펼쳐지고 등록하면 단어가 생긴다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '회원쿠폰', physicalName: 'MBR_XXX' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '쿠폰 등록' }))
    await userEvent.type(screen.getByLabelText('쿠폰 약어'), 'CPN')
    await userEvent.click(screen.getByRole('button', { name: '단어 등록' }))
    await waitFor(() => {
      const added = Object.values(useEditorStore.getState().model.words)
        .find((w) => w.logicalName === '쿠폰')
      expect(added?.abbreviation).toBe('CPN')
    })
  })

  it('물리명 칩은 논리명을 받아 역방향으로 등록한다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '회원', physicalName: 'MBR_CPN' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: 'CPN 등록' }))
    await userEvent.type(screen.getByLabelText('CPN 논리명'), '쿠폰')
    await userEvent.click(screen.getByRole('button', { name: '단어 등록' }))
    await waitFor(() => {
      const added = Object.values(useEditorStore.getState().model.words)
        .find((w) => w.abbreviation === 'CPN')
      expect(added?.logicalName).toBe('쿠폰')
    })
  })

  // ⚠️ duplicate 는 **물리명 칩 방향에서만** 도달한다. 논리명 칩은 정의상 사전에 없는 구간이라
  // 그쪽으로는 중복이 생길 수 없다 — 물리명 칩 'CPN' 에 이미 있는 논리명 '회원' 을 넣는 것이
  // 실제로 일어나는 형태다.
  it('물리명 칩에 이미 있는 논리명을 넣으면 등록이 막히고 사유가 보인다', async () => {
    loadModel({ logicalName: '회원', physicalName: 'MBR_CPN' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: 'CPN 등록' }))
    const input = screen.getByLabelText('CPN 논리명')
    await userEvent.type(input, '주문')          // 사전에 있다(w2)
    expect(screen.getByRole('button', { name: '단어 등록' })).toBeDisabled()
    expect(screen.getByText(/이미 있는 이름/)).toBeInTheDocument()
    await userEvent.clear(input)
    await userEvent.type(input, '쿠폰')          // 사전에 없다
    expect(screen.getByRole('button', { name: '단어 등록' })).toBeEnabled()
  })

  it('사전이 채워져 칩이 사라지면 펼친 폼도 닫힌다', async () => {
    loadModel({ logicalName: '회원쿠폰', physicalName: 'MBR' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '쿠폰 등록' }))
    expect(screen.getByLabelText('쿠폰 약어')).toBeInTheDocument()
    const m = useEditorStore.getState().model
    useEditorStore.getState().setLoaded(
      createWord(m, { id:'w9', logicalName:'쿠폰', abbreviation:'CPN', englishName:null, description:null, origin:null }),
      2, PROJECT,
    )
    grantEditPermission()
    await waitFor(() => expect(screen.queryByLabelText('쿠폰 약어')).not.toBeInTheDocument())
  })

  it('약어가 겹치면 막지 않고 경고만 보여 준다', async () => {
    loadModel({ logicalName: '회원쿠폰', physicalName: 'MBR' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '쿠폰 등록' }))
    await userEvent.type(screen.getByLabelText('쿠폰 약어'), 'MBR')   // w1과 겹친다
    expect(screen.getByRole('button', { name: '단어 등록' })).toBeEnabled()
    expect(screen.getByText(/이미 쓰는 약어/)).toBeInTheDocument()
  })

  it('등록하면 반대편이 비어 있을 때만 함께 채운다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '회원쿠폰', physicalName: '' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '쿠폰 등록' }))
    await userEvent.type(screen.getByLabelText('쿠폰 약어'), 'CPN')
    await userEvent.click(screen.getByRole('button', { name: '단어 등록' }))
    await waitFor(() =>
      expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('MBR_CPN'))
  })

  it('반대편이 이미 차 있으면 등록이 그것을 덮지 않는다', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    loadModel({ logicalName: '회원쿠폰', physicalName: '기존물리명' })
    renderPair()
    await userEvent.click(screen.getByRole('button', { name: '쿠폰 등록' }))
    await userEvent.type(screen.getByLabelText('쿠폰 약어'), 'CPN')
    await userEvent.click(screen.getByRole('button', { name: '단어 등록' }))
    await waitFor(() =>
      expect(Object.values(useEditorStore.getState().model.words).some((w) => w.logicalName === '쿠폰'))
        .toBe(true))
    expect(useEditorStore.getState().model.tables['t2']!.physicalName).toBe('기존물리명')
  })

  it('읽기 전용이면 칩이 없다', () => {
    loadModel({ logicalName: '회원쿠폰', physicalName: 'MBR' })
    useEditorStore.setState({ canEdit: false })
    renderPair(false)
    expect(screen.queryByRole('button', { name: '쿠폰 등록' })).not.toBeInTheDocument()
  })
})
