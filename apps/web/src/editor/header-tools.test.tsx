import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { ReactFlowProvider } from '@xyflow/react'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { createEmptyModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'
import { RequireAuth } from '@/components/require-auth'
import { useEditorStore } from './store.js'
import { HeaderTools } from './header-tools.js'
import { VersionDialog } from './version-dialog.js'
import { DomainPanel } from './domain-panel.js'
import { DictPanel } from './dict-panel.js'
import { CustomFieldPanel } from './custom-field-panel.js'
import { ResourcePanel } from './resource-panel.js'
import { NamingCheck } from './naming-check.js'
import { DdlImportDialog } from './ddl-import-dialog.js'
import { ExportDialog } from './export-dialog.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'

function wrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
        <ReactFlowProvider>{children}</ReactFlowProvider>
      </TRPCProvider>
    </QueryClientProvider>
  )
}

// HeaderTools는 useIsLocal(→ useMe)을 쓴다 — RequireAuth 안에서만 렌더할 수 있다.
function renderTools(mode: 'server' | 'local' = 'server') {
  mockTrpcFetch({
    'auth.me': () => ({ data: { id: 'u1', email: 'me@t.dev', name: '사용자', role: 'user', mode } }),
  })
  render(<RequireAuth><HeaderTools projectId={PROJECT_ID} /></RequireAuth>, { wrapper: wrapper() })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

/**
 * 트리거 → 열리는 다이얼로그의 전수 표. `dialog`는 각 파일의 `<DialogTitle>` 실제 문자열이다.
 * `menu`가 있으면 드롭다운을 먼저 열고 그 안의 항목을 고른다.
 *
 * **전수여야 한다** — 일부만 잠그면 배선을 맞바꿔도 통과한다(실측: dict ↔ resource 를 맞바꿔도
 * 8건이 전부 그린이었다).
 */
const OPENINGS: { trigger: RegExp; menu?: string; dialog: string }[] = [
  { trigger: /버전/, dialog: '버전' },
  { trigger: /사전·리소스/, menu: '도메인', dialog: '도메인' },
  { trigger: /사전·리소스/, menu: '단어·용어 사전', dialog: '단어·용어 사전' },
  { trigger: /사전·리소스/, menu: '커스텀 항목', dialog: '커스텀 항목' },
  { trigger: /사전·리소스/, menu: '공용 리소스', dialog: '공용 리소스' },
  { trigger: /모델 검사/, dialog: '모델 검사' },
  { trigger: /파일/, menu: 'DDL·DBML 가져오기', dialog: 'DDL·DBML 가져오기' },
  { trigger: /파일/, menu: '내보내기', dialog: '내보내기' },
]

describe('HeaderTools — 트리거와 다이얼로그의 배선', () => {
  for (const { trigger, menu, dialog } of OPENINGS) {
    const label = menu === undefined ? `「${dialog}」` : `「${menu}」`
    it(`${label} 를 고르면 「${dialog}」 다이얼로그가 열린다`, async () => {
      useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
      grantEditPermission()
      renderTools()

      await userEvent.click(await screen.findByRole('button', { name: trigger }))
      if (menu !== undefined) {
        await userEvent.click(screen.getByRole('menuitem', { name: menu }))
      }

      expect(await screen.findByRole('dialog', { name: dialog })).toBeInTheDocument()
    })
  }

  /**
   * 설계 D5 의 실질은 "둘이 동시에 열리지 않는다"가 아니라 **트리거 렌더 책임의 단일화**다.
   * 전자는 행위 테스트로 못 잠근다 — Radix 모달이 서로를 닫으므로 "동시에 열린 상태"는 UI 로
   * 관측 자체가 불가능하고, 단일 상태를 다이얼로그별 개별 상태로 되돌려도 전부 통과한다(실측).
   * 대신 **잠글 수 있는 각도**가 이것이다: 다이얼로그가 닫혀 있으면 화면에 아무 버튼도 없어야 한다.
   * 자체 `<DialogTrigger>` 가 남아 있으면 그 버튼이 보이므로 실제로 빨개진다.
   */
  // VersionDialog는 useIsLocal(→ useMe)을 쓰므로 RequireAuth 안에서 렌더해야 한다. RequireAuth의
  // auth.me 가 pending인 「불러오는 중…」 상태에서는 버튼이 0개인 것이 당연해 그 시점을 단언하면
  // 이 케이스가 이빨을 잃는다(리뷰 I-2) — 실제로 로드된 뒤를 기다려야 한다.
  it('VersionDialog 은 닫혀 있으면 자체 트리거를 렌더하지 않는다', async () => {
    mockTrpcFetch({
      'auth.me': () => ({ data: { id: 'u1', email: 'me@t.dev', name: '사용자', role: 'user', mode: 'server' } }),
    })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    render(
      <RequireAuth><VersionDialog projectId={PROJECT_ID} open={false} onOpenChange={() => {}} /></RequireAuth>,
      { wrapper: wrapper() },
    )
    await waitFor(() => expect(screen.queryByText('불러오는 중…')).toBeNull())

    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  // 나머지는 useIsLocal 을 쓰지 않아 RequireAuth 도 auth.me 목도 필요 없다 — 걸어 두면
  // "이 컴포넌트도 인증이 필요하다"는 잘못된 신호가 된다(리뷰 M-4).
  const CLOSED: { name: string; render: () => ReactNode }[] = [
    { name: 'DomainPanel', render: () => <DomainPanel projectId={PROJECT_ID} open={false} onOpenChange={() => {}} /> },
    { name: 'DictPanel', render: () => <DictPanel projectId={PROJECT_ID} open={false} onOpenChange={() => {}} /> },
    { name: 'CustomFieldPanel', render: () => <CustomFieldPanel projectId={PROJECT_ID} open={false} onOpenChange={() => {}} /> },
    { name: 'ResourcePanel', render: () => <ResourcePanel projectId={PROJECT_ID} open={false} onOpenChange={() => {}} /> },
    { name: 'NamingCheck', render: () => <NamingCheck projectId={PROJECT_ID} open={false} onOpenChange={() => {}} /> },
    { name: 'DdlImportDialog', render: () => <DdlImportDialog projectId={PROJECT_ID} open={false} onOpenChange={() => {}} /> },
    { name: 'ExportDialog', render: () => <ExportDialog open={false} onOpenChange={() => {}} /> },
  ]

  for (const { name, render: renderClosed } of CLOSED) {
    it(`${name} 은 닫혀 있으면 자체 트리거를 렌더하지 않는다`, () => {
      useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
      grantEditPermission()
      render(<>{renderClosed()}</>, { wrapper: wrapper() })

      expect(screen.queryAllByRole('button')).toHaveLength(0)
    })
  }

  // 이름 그대로 "연달아 바꿔 열 수 있다"만 검증한다. "동시에 열리지 않는다"는 위 주석대로
  // 행위 테스트로 관측할 수 없어 여기서 잠그지 않는다.
  it('도구를 연달아 바꿔 열 수 있다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools()

    await userEvent.click(await screen.findByRole('button', { name: /사전·리소스/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '도메인' }))
    expect(await screen.findByRole('dialog', { name: '도메인' })).toBeInTheDocument()

    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: /사전·리소스/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: '커스텀 항목' }))

    expect(await screen.findByRole('dialog', { name: '커스텀 항목' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '도메인' })).not.toBeInTheDocument()
  })
})

describe('HeaderTools — 모델 검사 배지와 파일 메뉴의 권한', () => {
  // 배지는 "경고가 있으면 건수가 붙는다"만 검증한다. 특정 경고 종류를 세우려고 물리명·방언을
  // 손대 봐야 buildSampleModel 이 이미 다른 경고를 내고 있어 그 두 줄이 아무것도 만들지 않는다.
  it('경고가 있으면 「모델 검사」에 건수가 붙는다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools()

    expect(await screen.findByRole('button', { name: /모델 검사 \(\d+\)/ })).toBeInTheDocument()
  })

  it('경고가 없으면 「모델 검사」에 건수가 붙지 않는다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools()

    expect(await screen.findByRole('button', { name: '모델 검사' })).toBeInTheDocument()
  })

  // ddl-import-dialog.test.tsx 의 「편집 권한이 없으면 진입점이 없다」가 여기로 왔다 —
  // canEdit 가드가 컴포넌트에서 메뉴 항목으로 옮겨졌기 때문이다(설계 3.3).
  it('읽기 전용이면 「파일」에 가져오기가 없고 내보내기는 있다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID) // grantEditPermission 을 부르지 않는다
    renderTools()

    await userEvent.click(await screen.findByRole('button', { name: /파일/ }))

    expect(screen.queryByRole('menuitem', { name: 'DDL·DBML 가져오기' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '내보내기' })).toBeInTheDocument()
  })

  it('편집 권한이 있으면 「파일」에 「DDL·DBML 가져오기」가 있다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools()

    await userEvent.click(await screen.findByRole('button', { name: /파일/ }))

    expect(screen.getByRole('menuitem', { name: 'DDL·DBML 가져오기' })).toBeInTheDocument()
  })
})

describe('HeaderTools 로컬 모드', () => {
  // 공용 리소스는 서버의 라이브러리 테이블에 얹혀 있다 — 로컬 서버에는 resource.library.listForProject
  // 프로시저가 없어, 항목 자체와 ResourcePanel 렌더 둘 다 빠져야 한다.
  it('로컬 모드에서 「공용 리소스」 항목이 없다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools('local')

    await userEvent.click(await screen.findByRole('button', { name: /사전·리소스/ }))
    expect(screen.queryByText('공용 리소스')).not.toBeInTheDocument()
    // 나머지 셋은 남아 있어야 한다
    expect(screen.getByText('도메인')).toBeInTheDocument()
    expect(screen.getByText('단어·용어 사전')).toBeInTheDocument()
    expect(screen.getByText('커스텀 항목')).toBeInTheDocument()
  })

  it('서버 모드에서는 「공용 리소스」가 있다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools('server')

    await userEvent.click(await screen.findByRole('button', { name: /사전·리소스/ }))
    expect(screen.getByText('공용 리소스')).toBeInTheDocument()
  })

  it('로컬 모드에서도 「버전」 버튼은 남는다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools('local')

    expect(await screen.findByRole('button', { name: /버전/ })).toBeInTheDocument()
  })

  // 「이력」은 revision.list 를 부른다 — 로컬 라우터에 없는 프로시저다. 스냅샷·비교는 snapshot.* 만
  // 쓰므로 그대로 남는다.
  it('로컬 모드에서 「이력」 탭이 없다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    renderTools('local')

    await userEvent.click(await screen.findByRole('button', { name: /버전/ }))
    expect(screen.queryByRole('button', { name: '이력' })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '스냅샷' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '비교' })).toBeInTheDocument()
  })
})
