import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import type { SheetData } from '@erdd/core'
import { MAX_OPS_PER_MUTATION, createEmptyModel } from '@erdd/core'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { useEditorStore } from './store.js'
import { buildWorkbookBlob } from './excel-file.js'
import { DictImportSection } from './dict-import-section.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000cc'
const mutate = vi.fn(() => Promise.resolve(true))
vi.mock('./use-model.js', () => ({ useModelMutation: () => mutate }))

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: toastError } }))

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

const wordsSheet = (rows: string[][], headers = ['논리명', '약어', '영문명', '설명']): SheetData => ({
  key: 'words', name: '단어사전', headers, rows,
})

const importButton = () => screen.getByRole('button', { name: '가져오기 실행' })

afterEach(() => {
  cleanup()
  mutate.mockClear()
  mutate.mockReturnValue(Promise.resolve(true))
  toastSuccess.mockClear()
  toastError.mockClear()
  useEditorStore.getState().reset()
})

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
    expect(screen.getByText('적용 대상 1건')).toBeInTheDocument()
  })

  it('이슈 목록에 시트 이름과 사유를 보여준다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['', 'ORD', '', 'x']])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => {
      expect(screen.getByText(/단어사전 · 1행 · 논리명이 비어 있습니다/)).toBeInTheDocument()
    })
  })

  it('시트별로 인식한 컬럼을 보여준다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['주문', 'ORD']], ['논리명', '약어'])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => expect(screen.getByLabelText('인식한 컬럼')).toBeInTheDocument())
    expect(screen.getByLabelText('인식한 컬럼').textContent).toBe('단어사전: 논리명, 약어')
  })

  it('파일을 읽은 뒤 input 값을 비워 같은 파일 재선택이 동작한다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const input = screen.getByLabelText('Excel 파일 선택') as HTMLInputElement
    await userEvent.upload(input, await xlsxFile([wordsSheet([['주문', 'ORD', '', '']])]))
    await waitFor(() => expect(screen.getByText(/신규 1건/)).toBeInTheDocument())
    expect(input.value).toBe('')
  })

  it('가져오기 버튼이 mutate를 한 번 호출한다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['주문', 'ORD', '', '']])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => expect(importButton()).toBeEnabled())
    await userEvent.click(importButton())
    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('mutate가 성공해야 완료 토스트를 띄우고 미리보기를 치운다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['주문', 'ORD', '', '']])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => expect(importButton()).toBeEnabled())
    await userEvent.click(importButton())
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1))
    expect(toastSuccess.mock.calls[0]![0]).toContain('단어 1')
    expect(screen.queryByRole('button', { name: '가져오기 실행' })).not.toBeInTheDocument()
  })

  it('mutate가 실패하면 완료 토스트 없이 미리보기를 남긴다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const file = await xlsxFile([wordsSheet([['주문', 'ORD', '', '']])])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), file)
    await waitFor(() => expect(importButton()).toBeEnabled())
    mutate.mockReturnValueOnce(Promise.resolve(false))
    await userEvent.click(importButton())
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(importButton()).toBeInTheDocument()
    expect(screen.getByText(/신규 1건/)).toBeInTheDocument()
  })

  it('서버 op 한도를 넘으면 가져오기를 막고 파일 분할을 안내한다', async () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)
    renderSection()
    const rows = Array.from({ length: MAX_OPS_PER_MUTATION + 1 }, (_, i) => [`단어${i}`, `W${i}`, '', ''])
    await userEvent.upload(screen.getByLabelText('Excel 파일 선택'), await xlsxFile([wordsSheet(rows)]))
    await waitFor(
      () => expect(screen.getByText(`적용 대상 ${MAX_OPS_PER_MUTATION + 1}건`)).toBeInTheDocument(),
      { timeout: 20000 },
    )
    expect(screen.getByRole('alert').textContent)
      .toBe(`한 번에 보낼 수 있는 최대 ${MAX_OPS_PER_MUTATION}건을 넘습니다. 파일을 나눠서 올려 주세요`)
    expect(importButton()).toBeDisabled()
    expect(mutate).not.toHaveBeenCalled()
  }, 60000)

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
