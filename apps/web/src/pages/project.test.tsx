import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { createEmptyModel, DEFAULT_TABLE_OPTIONS } from '@erdd/core'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { RequireAuth } from '@/components/require-auth'
import { useEditorStore } from '@/editor/store'
import { ProjectPage } from './project.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'

/** EventSource·WebSocket 은 jsdom 에 없다 — 로컬은 SSE 를, 서버는 소켓을 연다. */
class FakeEventSource {
  onmessage: ((e: { data: string }) => void) | null = null
  constructor(public url: string) {}
  close() {}
}
class FakeSocket {
  static readonly OPEN = 1
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  constructor(public url: string) {}
  send() {}
  close() {}
}

/**
 * ⚠️ **저장 상태를 렌더 전에 세운다.** 렌더 뒤에 세우면 첫 단언이 리렌더보다 먼저 지나가
 * 「배너가 없다」가 **가드와 무관하게** 통과한다(실제로 그렇게 써서 구분력이 없었다).
 */
function renderProject(mode: 'server' | 'local') {
  useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: true })
  mockTrpcFetch({
    'auth.me': () => ({ data: { id: 'u1', email: 'me@t.dev', name: '사용자', role: 'user', mode } }),
    'model.get': () => ({ data: { model: createEmptyModel(), seq: 0 } }),
    'project.get': () => ({ data: {
      id: PROJECT_ID, orgId: 'o1', name: '프로젝트', description: '', dialects: ['postgresql'],
      namingRules: {
        case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30,
        tablePhysicalTemplate: '', tableLogicalTemplate: '',
      },
      tableOptions: DEFAULT_TABLE_OPTIONS,
      createdAt: new Date(0).toISOString(), myRole: 'admin', myOrgRole: 'owner',
      canEdit: true, canManage: true,
    } }),
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[`/p/${PROJECT_ID}`]}>
      <QueryClientProvider client={queryClient}>
        <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
  render(
    <RequireAuth>
      <Routes><Route path="/p/:projectId" element={<ProjectPage />} /></Routes>
    </RequireAuth>,
    { wrapper },
  )
}

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('ProjectPage 의 로컬 가드', () => {
  /**
   * 🔥 **서버 모드에는 저장 UI 가 하나도 없어야 한다.** 렌더 자체를 막는 것이 요점이다 —
   * `LocalSaveControls`/`LocalSaveBanner` 가 마운트되면 `useLocalSave` 가 `Cmd+S` 를 가로채
   * 서버 모드에서 브라우저의 「페이지 저장」이 죽는다(HANDOFF 3.18 의 「닫아 두는 것이 아니라
   * 렌더하지 않는 것」과 같은 규칙).
   */
  it('서버 모드에는 저장 UI 가 하나도 없다', async () => {
    renderProject('server')
    // ⚠️ **`loaded` 가 된 뒤에 단언해야 한다.** 저장 컨트롤은 `loaded && isLocal` 가드 아래에
    // 있어서, 로딩 중에 재면 `isLocal` 가드를 떼도 「없다」가 통과한다(실제로 그랬다).
    // 「버전」은 `loaded` 일 때만 뜨는 HeaderTools 의 버튼이라 그 시점의 표식으로 쓴다.
    await screen.findByRole('button', { name: /버전/ })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('button', { name: /저장$/ })).toBeNull()
    expect(screen.queryByRole('button', { name: '저장 옵션' })).toBeNull()
  })

  it('로컬 모드에서는 같은 상태에서 배너와 저장 버튼이 뜬다', async () => {
    renderProject('local')
    await screen.findByRole('button', { name: /버전/ })
    expect(await screen.findByRole('alert')).toHaveTextContent('파일이 밖에서 바뀌었습니다')
    expect(screen.getByRole('button', { name: /저장$/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '저장 옵션' })).toBeInTheDocument()
  })
})
