import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { createWord, createTerm } from './dict-edits.js'
import { DictPanel } from './dict-panel.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000bb'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<DictPanel projectId={PROJECT_ID} />, { wrapper: w })
}

function loadModelWithDict() {
  // buildSampleModel의 t2 테이블 논리명은 "회원", c2/c3/c4 컬럼 논리명은 "회원번호"/"회원명"/"등급코드".
  let m = buildSampleModel()
  m = createWord(m, {
    id: 'w1', logicalName: '회원', abbreviation: 'MBR',
    englishName: null, description: null, origin: null,
  })
  m = createTerm(m, {
    id: 'term1', logicalName: '등급코드', physicalName: 'GRD_CD', domainId: null, description: null,
    origin: null,
  })
  useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
}

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('DictPanel', () => {
  it('단어 탭: 목록과 사용처 개수를 보여준다', async () => {
    loadModelWithDict()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /사전/ }))
    expect(screen.getByText('회원')).toBeInTheDocument()
    expect(screen.getByText('MBR')).toBeInTheDocument()
    expect(screen.getByText(/사용처 \d+개/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '단어 추가' })).toBeInTheDocument()
  })

  it('용어 탭으로 전환하면 용어 목록을 보여준다', async () => {
    loadModelWithDict()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /사전/ }))
    await userEvent.click(screen.getByRole('button', { name: '용어' }))
    expect(screen.getByText('등급코드')).toBeInTheDocument()
    expect(screen.getByText('GRD_CD')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '용어 추가' })).toBeInTheDocument()
  })

  it('미등록 단어 탭은 사전에 없는 단어 후보를 보여준다', async () => {
    loadModelWithDict()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /사전/ }))
    await userEvent.click(screen.getByRole('button', { name: /미등록 단어/ }))
    // c1 "등급코드"(용어로 정확히 매치되지 않는 t1측 컬럼), c3 "회원명" 등에서 미분해 조각이 남는다.
    expect(screen.getByText('명')).toBeInTheDocument()
  })

  it('삭제는 가드 없이 즉시 반영된다(사용 중이어도 버튼이 활성 상태)', async () => {
    loadModelWithDict()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /사전/ }))
    expect(screen.getByRole('button', { name: '회원 삭제' })).toBeEnabled()
  })

  it('가져오기 탭에 양식 다운로드와 파일 선택이 있다', async () => {
    loadModelWithDict()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /사전/ }))
    await userEvent.click(screen.getByRole('button', { name: '가져오기' }))
    expect(screen.getByRole('button', { name: /양식 다운로드/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Excel 파일 선택')).toBeInTheDocument()
  })

  it('단어 편집 폼에 영문명 입력란이 있다', async () => {
    loadModelWithDict()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /사전/ }))
    await userEvent.click(screen.getByRole('button', { name: '단어 추가' }))
    expect(screen.getByLabelText('영문명')).toBeInTheDocument()
  })
})
