import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { DEFAULT_NAMING_RULES, type NamingRules } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { ProjectSettingsPage } from './project-settings.js'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const PROJECT_ID = 'p1'
const ORG_ID = 'o1'

/**
 * `project.get` 응답 모양은 `apps/server/src/routers/project.ts` 의 get 반환값과 같다 —
 * 프로젝트 행 전체 + namingRules · myRole · myOrgRole · canEdit · canManage.
 */
function projectFixture(over: {
  logicalSeparator?: NamingRules['logicalSeparator']
  canManage?: boolean
  myRole?: string | null
  myOrgRole?: string | null
} = {}) {
  return {
    id: PROJECT_ID,
    orgId: ORG_ID,
    name: '주문시스템',
    description: '',
    dialects: ['postgresql'],
    createdAt: '2026-01-01T00:00:00.000Z',
    namingRules: {
      ...DEFAULT_NAMING_RULES,
      logicalSeparator: over.logicalSeparator ?? DEFAULT_NAMING_RULES.logicalSeparator,
    },
    myRole: over.myRole === undefined ? 'admin' : over.myRole,
    myOrgRole: over.myOrgRole === undefined ? 'owner' : over.myOrgRole,
    canEdit: true,
    canManage: over.canManage ?? true,
  }
}

function renderSettings(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch({
    'project.members.list': () => ({ data: [] }),
    'org.members.list': () => ({ data: [] }),
    ...handlers,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([{ path: '/p/:projectId/settings', Component: ProjectSettingsPage }])
  render(
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <Stub initialEntries={[`/p/${PROJECT_ID}/settings`]} />
      </TRPCProvider>
    </QueryClientProvider>,
  )
}

afterEach(cleanup)

describe('ProjectSettingsPage — 논리명 구분자 토글', () => {
  it('논리명 구분자 토글이 현재 값을 보여 준다', async () => {
    renderSettings({ 'project.get': () => ({ data: projectFixture({ logicalSeparator: '_' }) }) })
    expect(await screen.findByRole('checkbox', { name: /논리명을 밑줄로 구분/ })).toBeChecked()
  })

  it('꺼진 값은 체크되지 않은 채로 보여 준다', async () => {
    renderSettings({ 'project.get': () => ({ data: projectFixture({ logicalSeparator: '' }) }) })
    expect(await screen.findByRole('checkbox', { name: /논리명을 밑줄로 구분/ })).not.toBeChecked()
  })

  it('끄면 빈 구분자로 update 를 보낸다', async () => {
    const calls: { namingRules: NamingRules }[] = []
    renderSettings({
      'project.get': () => ({ data: projectFixture({ logicalSeparator: '_' }) }),
      'project.update': (input) => {
        calls.push(input as { namingRules: NamingRules })
        return { data: { ok: true } }
      },
    })
    await userEvent.click(await screen.findByRole('checkbox', { name: /논리명을 밑줄로 구분/ }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]!.namingRules.logicalSeparator).toBe('')
    // 나머지 규칙은 그대로 실어 보낸다(부분 갱신이 아니라 객체 통째다)
    expect(calls[0]!.namingRules.separator).toBe('_')
    expect(calls[0]!.namingRules.case).toBe('UPPER_SNAKE')
    expect(calls[0]!.namingRules.maxLengthBytes).toBe(30)
  })

  it('켜면 밑줄 구분자로 update 를 보낸다', async () => {
    const calls: { namingRules: NamingRules }[] = []
    renderSettings({
      'project.get': () => ({ data: projectFixture({ logicalSeparator: '' }) }),
      'project.update': (input) => {
        calls.push(input as { namingRules: NamingRules })
        return { data: { ok: true } }
      },
    })
    await userEvent.click(await screen.findByRole('checkbox', { name: /논리명을 밑줄로 구분/ }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]!.namingRules.logicalSeparator).toBe('_')
  })

  it('관리 권한이 없으면 토글이 없다', async () => {
    renderSettings({
      'project.get': () => ({
        data: projectFixture({ canManage: false, myOrgRole: null, myRole: 'editor' }),
      }),
    })
    await screen.findByText('주문시스템')
    expect(screen.queryByRole('checkbox', { name: /논리명을 밑줄로 구분/ })).not.toBeInTheDocument()
  })

  // ⚠️ 서버가 canManage 를 실어 보내는데 화면이 역할 조합식을 손으로 재현하면 perm.ts 가 바뀔 때
  // 조용히 어긋난다(HANDOFF 이월 항목). 서버가 false 라고 했으면 역할과 무관하게 false 여야 한다.
  it('역할이 admin 이어도 서버가 canManage:false 라고 하면 토글이 없다', async () => {
    renderSettings({
      'project.get': () => ({
        data: projectFixture({ canManage: false, myOrgRole: 'owner', myRole: 'admin' }),
      }),
    })
    await screen.findByText('주문시스템')
    expect(screen.queryByRole('checkbox', { name: /논리명을 밑줄로 구분/ })).not.toBeInTheDocument()
  })
})
