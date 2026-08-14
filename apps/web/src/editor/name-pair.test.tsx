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
