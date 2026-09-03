import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { RequireAuth } from '@/components/require-auth'
import { useEditorStore } from '@/editor/store'
import { ProjectPage } from './project.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'

/** EventSource 는 jsdom 에 없다 — 로컬 모드에서 `useLocalWatch` 가 연다. */
class FakeEventSource {
  onmessage: ((e: { data: string }) => void) | null = null
  constructor(public url: string) {}
  close() {}
}

/**
 * ⚠️ **모델을 끝내 주지 않는다**(`loaded` 가 false 로 남는다). 그러면 `Canvas`·`TableTree` 가
 * 마운트되지 않고 `useRealtime` 의 ready 가드(`loadedProjectId === projectId`)도 참이 되지 않아
 * 소켓이 열리지 않는다. 이 테스트가 잠그려는 것은 **`project.tsx` 의 `isLocal` 렌더 가드**뿐이니
 * 그 이상을 세울 이유가 없다.
 */
function renderProject(mode: 'server' | 'local') {
  mockTrpcFetch({
    'auth.me': () => ({ data: { id: 'u1', email: 'me@t.dev', name: '사용자', role: 'user', mode } }),
    'model.get': () => new Promise(() => {}),
    'project.get': () => new Promise(() => {}),
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

beforeEach(() => { vi.stubGlobal('EventSource', FakeEventSource) })
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('ProjectPage 의 로컬 가드', () => {
  /**
   * 🔥 **서버 모드에는 저장 UI 가 하나도 없어야 한다.** 렌더 자체를 막는 것이 요점이다 —
   * `LocalSaveControls`/`LocalSaveBanner` 가 마운트되면 `useLocalSave` 가 `Cmd+S` 를 가로채
   * 서버 모드에서 브라우저의 「페이지 저장」이 죽는다(HANDOFF 3.18 의 「닫아 두는 것이 아니라
   * 렌더하지 않는 것」과 같은 규칙).
   */
  it('서버 모드에서는 external 이어도 외부 변경 배너가 뜨지 않는다', async () => {
    renderProject('server')
    await screen.findByText('불러오는 중…')
    useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: true })
    await waitFor(() => { expect(screen.queryByRole('alert')).toBeNull() })
  })

  it('로컬 모드에서는 같은 상태에서 배너가 뜬다', async () => {
    renderProject('local')
    await screen.findByText('불러오는 중…')
    useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: true })
    expect(await screen.findByRole('alert')).toHaveTextContent('파일이 밖에서 바뀌었습니다')
  })
})
