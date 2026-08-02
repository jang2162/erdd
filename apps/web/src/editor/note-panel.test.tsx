import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { TRPCProvider } from '@/lib/trpc'
import type { AppRouter } from '@erdd/server/src/router.js'
import { mockTrpcFetch } from '@/testing/trpc-mock'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { grantEditPermission } from '@/testing/editor-store'
import { useEditorStore } from './store.js'
import { NotePanel } from './note-panel.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<NotePanel projectId={PROJECT_ID} />, { wrapper: w })
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); useEditorStore.getState().reset() })

describe('NotePanel', () => {
  it('renders the note content, delete button, and unlocked inputs when editable', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectNote('n1')
    renderPanel()

    expect(screen.getByRole('button', { name: '메모 삭제' })).toBeInTheDocument()
    const contentInput = screen.getByLabelText('내용') as HTMLTextAreaElement
    expect(contentInput).toHaveValue('회원 도메인 메모')
    expect(contentInput).not.toHaveAttribute('readonly')
    expect(screen.getByLabelText('색상')).not.toBeDisabled()
  })

  it('edits the note content and sends a mutation when editable', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectNote('n1')
    renderPanel()

    const contentInput = screen.getByLabelText('내용') as HTMLTextAreaElement
    await userEvent.clear(contentInput)
    await userEvent.type(contentInput, '수정된 메모')
    await userEvent.tab() // blur → commit
    await waitFor(() => expect(useEditorStore.getState().model.notes['n1']!.content).toBe('수정된 메모'))
  })

  it('deletes the note and clears selection when the delete button is clicked', async () => {
    mockTrpcFetch({ 'model.mutate': () => ({ data: { seq: 2 } }) })
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    grantEditPermission()
    useEditorStore.getState().selectNote('n1')
    renderPanel()

    await userEvent.click(screen.getByRole('button', { name: '메모 삭제' }))
    await waitFor(() => expect(useEditorStore.getState().model.notes['n1']).toBeUndefined())
    expect(useEditorStore.getState().selectedNoteId).toBeNull()
  })

  it('편집 권한이 없으면 삭제 버튼이 사라지고 내용/색상이 잠기지만 내용 값은 그대로 보인다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, PROJECT_ID)
    useEditorStore.getState().selectNote('n1')
    // grantEditPermission을 부르지 않는다 — Viewer 상태.
    renderPanel()

    expect(screen.queryByRole('button', { name: '메모 삭제' })).toBeNull()
    const contentInput = screen.getByLabelText('내용') as HTMLTextAreaElement
    expect(contentInput).toHaveValue('회원 도메인 메모')
    expect(contentInput).toHaveAttribute('readonly')
    expect(screen.getByLabelText('색상')).toBeDisabled()
  })
})
