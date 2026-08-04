import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { toast } from 'sonner'
import { createEmptyModel, type Domain, type ProjectModel, type Term, type Word } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { ResourcePanel } from './resource-panel.js'

const PROJECT_ID = 'p1'
const LIBS = [
  { id: 'l1', scope: 'global', orgId: null, name: '표준 사전', description: '', itemCount: 0, canWrite: false },
  { id: 'l2', scope: 'org', orgId: 'o1', name: '조직 표준', description: '', itemCount: 0, canWrite: true },
]

function word(id: string, logicalName: string, abbreviation: string): Word {
  return { id, logicalName, abbreviation, englishName: null, description: null, origin: null }
}
function domain(id: string, name: string): Domain {
  return {
    id, name, category: null, logicalType: 'DECIMAL(15,2)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: null, origin: null,
  }
}
function term(id: string, logicalName: string, domainId: string | null): Term {
  return { id, logicalName, physicalName: 'X', domainId, description: null, origin: null }
}

vi.mock('./use-model.js', () => ({ useModelMutation: () => vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

function renderPanel(
  handlers: Parameters<typeof mockTrpcFetch>[0], model: ProjectModel,
  perms: { canEdit: boolean; canManage: boolean } = { canEdit: true, canManage: true },
) {
  mockTrpcFetch(handlers)
  useEditorStore.getState().setLoaded(model, 0, PROJECT_ID)
  grantEditPermission(perms)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ResourcePanel projectId={PROJECT_ID} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

async function openPromoteTab() {
  await userEvent.click(screen.getByRole('button', { name: /공용 리소스/ }))
  await userEvent.click(await screen.findByRole('tab', { name: '조직으로 승격' }))
  await userEvent.click(await screen.findByRole('button', { name: /조직 표준/ }))
}

beforeEach(() => { vi.mocked(toast.success).mockClear(); vi.mocked(toast.error).mockClear() })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ResourcePromoteTab', () => {
  it('쓰기 가능한 라이브러리만 목록에 보인다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })
    await userEvent.click(screen.getByRole('button', { name: /공용 리소스/ }))
    await userEvent.click(await screen.findByRole('tab', { name: '조직으로 승격' }))
    expect(screen.queryByRole('button', { name: /표준 사전/ })).toBeNull()
    expect(screen.getByRole('button', { name: /조직 표준/ })).toBeDefined()
  })

  it('프로젝트 자체 항목이 "신규 추가"로 뜨고 기본 선택된다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })
    await openPromoteTab()
    expect(await screen.findByText('신규 추가 (1)')).toBeDefined()
    expect(screen.getByRole('checkbox', { name: '회원 선택' })).toHaveProperty('checked', true)
  })

  it('동명 항목은 "동명 발견"으로 뜨고 기본 미선택이다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({
        data: [{
          id: 's1', kind: 'word', version: 1,
          payload: { logicalName: '회원', abbreviation: 'MEMBER', englishName: null, description: null },
        }],
      }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })
    await openPromoteTab()
    expect(await screen.findByText('동명 발견 (1)')).toBeDefined()
    expect(screen.getByRole('checkbox', { name: '회원 선택' })).toHaveProperty('checked', false)
  })

  it('도메인을 함께 선택하면 "도메인 연결 비움" 경고가 사라진다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
    }, {
      ...createEmptyModel(),
      domains: { d1: domain('d1', '금액') },
      terms: { t1: term('t1', '주문금액', 'd1') },
    })
    await openPromoteTab()
    await screen.findByText('신규 추가 (2)')
    // 기본은 둘 다 선택 상태라 경고가 없다 → 도메인을 빼면 경고가 뜬다
    await userEvent.click(screen.getByRole('checkbox', { name: '금액 선택' }))
    expect(await screen.findByText('도메인 연결 비움')).toBeDefined()
    await userEvent.click(screen.getByRole('checkbox', { name: '금액 선택' }))
    await waitFor(() => expect(screen.queryByText('도메인 연결 비움')).toBeNull())
  })

  it('승격하면 서버 결과를 알리고 그룹 뷰를 유지한 채 모델을 되맞춘다', async () => {
    const promoted = vi.fn(() => ({ data: { seq: 1, inserted: 1, updated: 0, skipped: [] } }))
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
      'resource.promote': promoted,
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 1 } }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } })
    useEditorStore.getState().enterGroupView('g1')
    await openPromoteTab()
    await screen.findByText('신규 추가 (1)')
    await userEvent.click(screen.getByRole('button', { name: '승격' }))

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('추가 1건 · 갱신 0건을 올렸습니다'))
    expect(promoted).toHaveBeenCalledTimes(1)
    // resync를 썼으므로 그룹 뷰가 살아 있다(setLoaded면 null로 튕긴다)
    expect(useEditorStore.getState().activeGroupView).toBe('g1')
    expect(useEditorStore.getState().seq).toBe(1)
  })

  it('편집 권한이 없으면 쓰기 가능한 라이브러리가 있어도 승격 탭이 없다', async () => {
    renderPanel({
      'resource.library.listForProject': () => ({ data: LIBS }),
      'resource.items.list': () => ({ data: [] }),
    }, { ...createEmptyModel(), words: { w1: word('w1', '회원', 'MBR') } }, { canEdit: false, canManage: false })
    await userEvent.click(screen.getByRole('button', { name: /공용 리소스/ }))
    expect(screen.queryByRole('tab', { name: '조직으로 승격' })).toBeNull()
  })
})
