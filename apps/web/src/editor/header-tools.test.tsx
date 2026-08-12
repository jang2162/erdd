import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { ReactFlowProvider } from '@xyflow/react'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { createEmptyModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { HeaderTools } from './header-tools.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'

function renderTools() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </TRPCProvider>
    </QueryClientProvider>
  )
  render(<HeaderTools projectId={PROJECT_ID} />, { wrapper: w })
}

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('HeaderTools — 사전·리소스', () => {
  it('메뉴에서 「도메인」을 고르면 도메인 다이얼로그가 열린다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools()

    await userEvent.click(screen.getByRole('button', { name: /사전·리소스/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '도메인' }))

    expect(await screen.findByRole('dialog', { name: '도메인' })).toBeInTheDocument()
  })

  it('한 번에 하나만 열린다 — 다른 것을 고르면 앞의 것이 닫힌다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools()

    await userEvent.click(screen.getByRole('button', { name: /사전·리소스/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '도메인' }))
    expect(await screen.findByRole('dialog', { name: '도메인' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /사전·리소스/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '커스텀 항목' }))

    expect(await screen.findByRole('dialog', { name: '커스텀 항목' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '도메인' })).not.toBeInTheDocument()
  })
})

describe('HeaderTools — 버전·모델 검사·파일', () => {
  it('「버전」을 누르면 버전 다이얼로그가 열린다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools()

    await userEvent.click(screen.getByRole('button', { name: /버전/ }))

    expect(await screen.findByRole('dialog', { name: '버전' })).toBeInTheDocument()
  })

  it('경고가 있으면 「모델 검사」에 건수가 붙는다', () => {
    const m = buildSampleModel()
    const t = Object.values(m.tables)[0]!
    m.tables[t.id] = { ...t, physicalName: 'ORDER' }
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    // 예약어 경고는 dialect 가 있어야 계산된다(core warnings.ts).
    useEditorStore.getState().setProjectConfig(
      { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 }, ['postgresql'], null)
    grantEditPermission()
    renderTools()

    expect(screen.getByRole('button', { name: /모델 검사 \(\d+\)/ })).toBeInTheDocument()
  })

  it('경고가 없으면 「모델 검사」에 건수가 붙지 않는다', () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools()

    expect(screen.getByRole('button', { name: '모델 검사' })).toBeInTheDocument()
  })

  it('「파일」에서 「내보내기」를 고르면 내보내기 다이얼로그가 열린다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools()

    await userEvent.click(screen.getByRole('button', { name: /파일/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '내보내기' }))

    expect(await screen.findByRole('dialog', { name: '내보내기' })).toBeInTheDocument()
  })

  // ddl-import-dialog.test.tsx 의 「편집 권한이 없으면 진입점이 없다」가 여기로 왔다 —
  // canEdit 가드가 컴포넌트에서 메뉴 항목으로 옮겨졌기 때문이다(설계 3.3).
  it('읽기 전용이면 「파일」에 가져오기가 없고 내보내기는 있다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID) // grantEditPermission 을 부르지 않는다
    renderTools()

    await userEvent.click(screen.getByRole('button', { name: /파일/ }))

    expect(screen.queryByRole('menuitem', { name: 'DDL·DBML 가져오기' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '내보내기' })).toBeInTheDocument()
  })

  it('편집 권한이 있으면 「파일」에 「DDL·DBML 가져오기」가 있다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools()

    await userEvent.click(screen.getByRole('button', { name: /파일/ }))

    expect(screen.getByRole('menuitem', { name: 'DDL·DBML 가져오기' })).toBeInTheDocument()
  })
})
