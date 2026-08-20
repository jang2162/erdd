import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRoutesStub } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { DEFAULT_NAMING_RULES, createEmptyModel, type NamingRules } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { RequireAuth } from '@/components/require-auth'
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
  tablePhysicalTemplate?: string
  tableLogicalTemplate?: string
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
      tablePhysicalTemplate: over.tablePhysicalTemplate ?? '',
      tableLogicalTemplate: over.tableLogicalTemplate ?? '',
    },
    myRole: over.myRole === undefined ? 'admin' : over.myRole,
    myOrgRole: over.myOrgRole === undefined ? 'owner' : over.myOrgRole,
    canEdit: true,
    canManage: over.canManage ?? true,
  }
}

/**
 * 설정 화면의 미리보기가 쓰는 모델.
 * ⚠️ `model.get` 은 모델을 `{ model, seq }` 로 감싸 돌려준다(apps/server/src/routers/model.ts:22).
 * ⚠️ 값을 **폴백 예시(MBR/ORD)와 다르게** 둔다 — 같으면 「현재 모델을 쓴다」와 「고정 예시로
 * 떨어졌다」를 테스트가 구분하지 못한다.
 */
const MODEL_FIXTURE = {
  model: {
    ...createEmptyModel(),
    tableGroups: { g1: { id: 'g1', name: '상품관리', color: '#eeeeee', comment: null, alias: 'PRD' } },
    tables: {
      t1: {
        id: 't1', logicalName: '품목', physicalName: 'ITEM', comment: null, groupId: 'g1',
        position: { x: 0, y: 0 }, groupPosition: null, custom: {},
      },
    },
  },
  seq: 1,
}

// ProjectSettingsPage는 useIsLocal(→ useMe)을 쓴다 — RequireAuth 안에서만 렌더할 수 있다.
function renderSettings(handlers: Parameters<typeof mockTrpcFetch>[0]) {
  mockTrpcFetch({
    'auth.me': () => ({ data: { id: 'u1', email: 'me@t.dev', name: '사용자', role: 'user', mode: 'server' } }),
    'project.members.list': () => ({ data: [] }),
    'org.members.list': () => ({ data: [] }),
    'model.get': () => ({ data: MODEL_FIXTURE }),
    ...handlers,
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const Stub = createRoutesStub([{
    path: '/p/:projectId/settings',
    Component: () => <RequireAuth><ProjectSettingsPage /></RequireAuth>,
  }])
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

describe('ProjectSettingsPage — 테이블 물리명 형식', () => {
  it('현재 템플릿을 입력란에 보여 준다', async () => {
    renderSettings({
      'project.get': () => ({ data: projectFixture({ tablePhysicalTemplate: 'TB_{물리명}' }) }),
    })
    expect(await screen.findByLabelText(/테이블 물리명 형식/)).toHaveValue('TB_{물리명}')
  })

  it('입력하고 포커스를 빼면 update 로 보낸다', async () => {
    const calls: { namingRules: NamingRules }[] = []
    renderSettings({
      'project.get': () => ({ data: projectFixture() }),
      'project.update': (input) => {
        calls.push(input as { namingRules: NamingRules })
        return { data: { ok: true } }
      },
    })
    const input = await screen.findByLabelText(/테이블 물리명 형식/)
    await userEvent.type(input, 'TB_{{그룹별칭}_{{물리명}')   // userEvent 에서 '{' 는 '{{' 로 이스케이프
    await userEvent.tab()
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]!.namingRules.tablePhysicalTemplate).toBe('TB_{그룹별칭}_{물리명}')
    // 나머지 규칙은 그대로 실어 보낸다(객체 통째다)
    expect(calls[0]!.namingRules.logicalSeparator).toBe('_')
    expect(calls[0]!.namingRules.maxLengthBytes).toBe(30)
  })

  it('현재 모델의 테이블로 미리보기를 보여 준다', async () => {
    renderSettings({
      'project.get': () => ({
        data: projectFixture({ tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }),
      }),
    })
    expect(await screen.findByText('TB_PRD_ITEM')).toBeInTheDocument()
  })

  // ⚠️ 오타를 즉시 알게 하는 것이 미리보기의 목적이다(설계 3.2 — 알 수 없는 변수는 빈 값).
  it('없는 변수를 적으면 미리보기가 그 자리를 비워 보여 준다', async () => {
    renderSettings({
      'project.get': () => ({
        data: projectFixture({ tablePhysicalTemplate: 'TB_{그룹별칙}_{물리명}' }),
      }),
    })
    expect(await screen.findByText('TB_ITEM')).toBeInTheDocument()
  })

  // 새 프로젝트에서도 형식을 확인할 수 있어야 한다 — 테이블이 없으면 가상 예시로 떨어진다.
  it('모델에 테이블이 없으면 가상 예시로 미리보기를 보여 준다', async () => {
    renderSettings({
      'project.get': () => ({
        data: projectFixture({ tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }),
      }),
      'model.get': () => ({ data: { model: createEmptyModel(), seq: 1 } }),
    })
    expect(await screen.findByText('TB_MBR_ORD')).toBeInTheDocument()
  })

  it('관리 권한이 없으면 입력란이 없다', async () => {
    renderSettings({
      'project.get': () => ({
        data: projectFixture({ canManage: false, myOrgRole: null, myRole: 'editor' }),
      }),
    })
    await screen.findByText('주문시스템')
    expect(screen.queryByLabelText(/테이블 물리명 형식/)).not.toBeInTheDocument()
  })
})

describe('ProjectSettingsPage — 테이블 논리명 형식', () => {
  it('현재 논리 템플릿을 입력란에 보여 준다', async () => {
    renderSettings({
      'project.get': () => ({ data: projectFixture({ tableLogicalTemplate: '{그룹명}_{논리명}' }) }),
    })
    expect(await screen.findByLabelText(/테이블 논리명 형식/)).toHaveValue('{그룹명}_{논리명}')
  })

  it('입력하고 포커스를 빼면 update 로 보낸다', async () => {
    const calls: { namingRules: NamingRules }[] = []
    renderSettings({
      'project.get': () => ({ data: projectFixture() }),
      'project.update': (input) => {
        calls.push(input as { namingRules: NamingRules })
        return { data: { ok: true } }
      },
    })
    const input = await screen.findByLabelText(/테이블 논리명 형식/)
    await userEvent.type(input, '{{그룹명}_{{논리명}')     // userEvent 에서 '{' 는 '{{' 로 이스케이프
    await userEvent.tab()
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]!.namingRules.tableLogicalTemplate).toBe('{그룹명}_{논리명}')
    // 물리 템플릿은 그대로 실려 나간다(객체 통째다)
    expect(calls[0]!.namingRules.tablePhysicalTemplate).toBe('')
  })

  // MODEL_FIXTURE 의 테이블은 그룹 '상품관리'(별칭 PRD) 소속 논리명 '품목'/물리명 'ITEM' 이다.
  it('논리 미리보기가 현재 모델의 테이블로 나온다', async () => {
    renderSettings({
      'project.get': () => ({ data: projectFixture({ tableLogicalTemplate: '{그룹명}_{논리명}' }) }),
    })
    expect(await screen.findByText('상품관리_품목')).toBeInTheDocument()
  })

  it('두 미리보기가 서로를 침범하지 않는다', async () => {
    renderSettings({
      'project.get': () => ({ data: projectFixture({
        tablePhysicalTemplate: 'TB_{물리명}', tableLogicalTemplate: '{그룹명}_{논리명}',
      }) }),
    })
    expect(await screen.findByText('TB_ITEM')).toBeInTheDocument()      // 물리 미리보기
    expect(screen.getByText('상품관리_품목')).toBeInTheDocument()        // 논리 미리보기
  })

  it('관리 권한이 없으면 논리 입력란도 없다', async () => {
    renderSettings({
      'project.get': () => ({
        data: projectFixture({ canManage: false, myOrgRole: null, myRole: 'editor' }),
      }),
    })
    await screen.findByText('주문시스템')
    expect(screen.queryByLabelText(/테이블 논리명 형식/)).not.toBeInTheDocument()
  })

  // ⚠️ `TemplatePreview` 의 `template === '' → null` 가드를 잠근다(설계 3.4). 두 사이클 연속으로
  // 이월돼 있던 자리다 — 가드를 지우면 빈 템플릿에서도 「미리보기: 」가 떠서 이 케이스가 빨개진다.
  // 입력란을 먼저 기다려야 한다 — project.get 이 오기 전에는 절 자체가 없어 무조건 통과한다.
  it('두 템플릿이 다 비면 미리보기가 없다', async () => {
    renderSettings({ 'project.get': () => ({ data: projectFixture() }) })
    await screen.findByLabelText(/테이블 논리명 형식/)
    expect(screen.queryByText(/미리보기:/)).not.toBeInTheDocument()
  })
})
