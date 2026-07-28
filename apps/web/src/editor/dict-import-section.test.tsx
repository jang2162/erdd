import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { SheetData } from '@erdd/core'
import { createEmptyModel } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { useEditorStore } from './store.js'
import { buildWorkbookBlob } from './excel-file.js'
import { DictImportSection } from './dict-import-section.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000cc'
const mutate = vi.fn(() => Promise.resolve())
vi.mock('./use-model.js', () => ({ useModelMutation: () => mutate }))

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<DictImportSection projectId={PROJECT_ID} />, { wrapper: w })
}

async function xlsxFile(sheets: SheetData[], name = 'dict.xlsx'): Promise<File> {
  const blob = await buildWorkbookBlob(sheets)
  return new File([blob], name, { type: blob.type })
}

const wordsSheet = (rows: string[][]): SheetData => ({
  key: 'words', name: '단어사전', headers: ['논리명', '약어', '영문명', '설명'], rows,
})

afterEach(() => { cleanup(); mutate.mockClear(); useEditorStore.getState().reset() })

describe('DictImportSection', () => {
  it('파일을 고르면 신규·중복·오류 건수를 보여준다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['주문', 'ORD', '', ''], ['', '', '', 'x']])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => {
      expect(screen.getByText(/신규 1건/)).toBeInTheDocument()
    })
    expect(screen.getByText(/오류 1행/)).toBeInTheDocument()
  })

  it('이슈 목록에 사유를 보여준다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['', 'ORD', '', 'x']])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => {
      expect(screen.getByText(/논리명이 비어 있습니다/)).toBeInTheDocument()
    })
  })

  it('가져오기 버튼이 mutate를 한 번 호출한다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['주문', 'ORD', '', '']])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => expect(screen.getByRole('button', { name: '가져오기' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: '가져오기' }))
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('중복 처리 라디오를 덮어쓰기로 바꿀 수 있다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['주문', 'ORD', '', '']])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => expect(screen.getByRole('radio', { name: '덮어쓰기' })).toBeInTheDocument())
    await userEvent.click(screen.getByRole('radio', { name: '덮어쓰기' }))
    expect(screen.getByRole('radio', { name: '덮어쓰기' })).toBeChecked()
  })

  it('양식 다운로드 버튼이 있다', () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    expect(screen.getByRole('button', { name: /양식 다운로드/ })).toBeInTheDocument()
  })
})
