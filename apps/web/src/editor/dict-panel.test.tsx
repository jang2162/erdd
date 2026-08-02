import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { grantEditPermission } from '@/testing/editor-store'

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
  grantEditPermission()
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

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

/**
 * loadModelWithDict의 term1은 '등급코드'/GRD_CD이고, 픽스처의 c1·c4가 논리명 '등급코드' ·
 * 물리명 'GRD_CD'로 이미 용어와 일치한다. 물리명을 바꾸면 두 컬럼이 전파 대상이 된다.
 * (논리명 '등급코드'인 테이블은 없으므로 대상은 컬럼 2개다.)
 */
async function openTermEdit() {
  await userEvent.click(screen.getByRole('button', { name: /사전/ }))
  await userEvent.click(screen.getByRole('button', { name: '용어' }))
  await userEvent.click(screen.getByRole('button', { name: '등급코드 편집' }))
}

async function typePhysicalName(value: string) {
  const physical = screen.getByLabelText('물리명')
  await userEvent.clear(physical)
  await userEvent.type(physical, value)
}

describe('DictPanel 용어 전파', () => {
  it('사용처가 있고 바뀐 값이 있으면 확인 단계를 보여준다', async () => {
    loadModelWithDict()
    renderPanel()
    await openTermEdit()
    await typePhysicalName('GRADE_CD')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByText(/함께 갱신할까요/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /2곳에 반영/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '유지' })).toBeInTheDocument()
    // 무엇이 바뀌는지 대상별로 보여준다
    expect(screen.getAllByText(/GRD_CD → GRADE_CD/)).toHaveLength(2)
  })

  it('확인 목록의 도메인은 UUID가 아니라 이름으로 보여준다', async () => {
    // loadModelWithDict의 term1은 '등급코드'(도메인 없음), c1·c4가 그 용어를 쓴다.
    loadModelWithDict()
    const m = useEditorStore.getState().model
    const withDomains = {
      ...m,
      domains: {
        dom1: {
          id: 'dom1', name: '코드값', category: null, logicalType: 'CHAR(2)',
          dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
          defaultValue: null, allowedValues: [], description: null, origin: null,
        },
      },
    }
    useEditorStore.getState().setLoaded(withDomains, 1, PROJECT_ID)

    renderPanel()
    await openTermEdit()
    // 용어에 도메인을 지정하면 사용처 컬럼(도메인 없음 → dom1)이 전파 대상이 된다.
    await userEvent.selectOptions(screen.getByLabelText('도메인 (선택)'), 'dom1')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByText(/함께 갱신할까요/)).toBeInTheDocument()
    // 이름으로 보여야 한다 — UUID가 새어나오면 실패
    expect(screen.getAllByText(/없음 → 코드값/).length).toBeGreaterThan(0)
    expect(screen.queryByText(/dom1/)).not.toBeInTheDocument()
  })

  it('바뀐 값이 없으면 확인 없이 저장된다', async () => {
    loadModelWithDict()
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    renderPanel()
    await openTermEdit()
    await userEvent.type(screen.getByLabelText('설명'), '설명만 수정')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(screen.queryByText(/함께 갱신할까요/)).not.toBeInTheDocument()
    // 확인 없이 '저장까지' 됐는지 확인 — 다이얼로그 부재만 보면 onSave가 즉시 리턴해도 통과한다.
    await waitFor(() =>
      expect(useEditorStore.getState().model.terms.term1!.description).toBe('설명만 수정'))
  })

  it('유지를 고르면 용어만 바뀌고 사용처는 그대로다', async () => {
    loadModelWithDict()
    // 스토어는 seq 1로 로드된다. 낙관적 갱신이 롤백되지 않으려면 mutation이 성공해야 하고,
    // 반환 seq는 정확히 seqBefore+1(=2)이어야 한다 — 다른 값이면 use-model의 resync 경로가
    // 발동해 model.get을 부르고 낙관적 상태를 덮어쓴다.
    const fetchMock = mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    renderPanel()
    await openTermEdit()
    await typePhysicalName('GRADE_CD')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await userEvent.click(await screen.findByRole('button', { name: '유지' }))

    await waitFor(() => expect(useEditorStore.getState().model.terms.term1!.physicalName).toBe('GRADE_CD'))
    const m = useEditorStore.getState().model
    expect(m.columns.c1!.physicalName).toBe('GRD_CD')   // 사용처는 그대로
    expect(m.columns.c4!.physicalName).toBe('GRD_CD')
    expect(fetchMock).toHaveBeenCalledTimes(1)   // 유지도 Revision 1건이다
  })

  it('반영을 고르면 용어와 사용처가 한 번의 mutation으로 함께 바뀐다', async () => {
    loadModelWithDict()
    const fetchMock = mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    renderPanel()
    await openTermEdit()
    await typePhysicalName('GRADE_CD')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    await userEvent.click(await screen.findByRole('button', { name: /2곳에 반영/ }))

    await waitFor(() => expect(useEditorStore.getState().model.columns.c1!.physicalName).toBe('GRADE_CD'))
    const m = useEditorStore.getState().model
    expect(m.terms.term1!.physicalName).toBe('GRADE_CD')
    expect(m.columns.c4!.physicalName).toBe('GRADE_CD')
    // Revision 1건 — model.mutate가 정확히 한 번만 나간다
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
