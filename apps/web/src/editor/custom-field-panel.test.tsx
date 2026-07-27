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
import { createCustomField, setCustomValue } from './custom-field-edits.js'
import { CustomFieldPanel } from './custom-field-panel.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(<CustomFieldPanel projectId={PROJECT_ID} />, { wrapper: w })
}

function loadModelWithFields() {
  let m = buildSampleModel()
  m = createCustomField(m, {
    id: 'f1', name: '개인정보여부', target: 'column', type: 'select',
    options: ['Y', 'N'], required: true, defaultValue: null,
  })
  m = createCustomField(m, {
    id: 'f2', name: '암호화방식', target: 'column', type: 'text',
    options: [], required: false, defaultValue: null,
  })
  m = createCustomField(m, {
    id: 'f3', name: '업무구분', target: 'table', type: 'text',
    options: [], required: false, defaultValue: null,
  })
  m = setCustomValue(m, 'column', 'c1', 'f1', 'Y')
  useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
}

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('CustomFieldPanel', () => {
  it('대상별로 항목을 나눠 보여주고 사용 건수를 표시한다', async () => {
    loadModelWithFields()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /커스텀 항목/ }))
    expect(screen.getByText('개인정보여부')).toBeInTheDocument()
    expect(screen.getByText('암호화방식')).toBeInTheDocument()
    expect(screen.getByText('업무구분')).toBeInTheDocument()
    expect(screen.getByText('값 1건')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '항목 추가' })).toBeInTheDocument()
  })

  it('첫 항목의 위로 버튼과 마지막 항목의 아래로 버튼이 비활성이다', async () => {
    loadModelWithFields()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /커스텀 항목/ }))
    expect(screen.getByRole('button', { name: '개인정보여부 위로' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '암호화방식 아래로' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '암호화방식 위로' })).toBeEnabled()
  })

  it('순서 이동 버튼이 모델의 order를 바꾼다', async () => {
    loadModelWithFields()
    renderPanel()
    await userEvent.click(screen.getByRole('button', { name: /커스텀 항목/ }))
    await userEvent.click(screen.getByRole('button', { name: '암호화방식 위로' }))
    const m = useEditorStore.getState().model
    expect(m.customFields['f2']!.order).toBeLessThan(m.customFields['f1']!.order)
  })
})

import { CustomFieldEditDialog } from './custom-field-edit-dialog.js'

function renderDialog(field: Parameters<typeof CustomFieldEditDialog>[0]['field']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const trpcClient = createTRPCClient<AppRouter>({ links: [httpBatchLink({ url: '/trpc' })] })
  const w = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
  render(
    <CustomFieldEditDialog projectId={PROJECT_ID} field={field} open onOpenChange={() => {}} />,
    { wrapper: w },
  )
}

describe('CustomFieldEditDialog', () => {
  it('수정 모드에서는 타입·대상 선택이 잠긴다', () => {
    loadModelWithFields()
    renderDialog(useEditorStore.getState().model.customFields['f1']!)
    expect(screen.getByLabelText('타입')).toBeDisabled()
    expect(screen.getByLabelText('적용 대상')).toBeDisabled()
  })

  it('추가 모드에서는 타입·대상을 고를 수 있고 boolean이면 필수가 잠긴다', async () => {
    loadModelWithFields()
    renderDialog(null)
    expect(screen.getByLabelText('타입')).toBeEnabled()
    expect(screen.getByLabelText('필수')).toBeEnabled()
    await userEvent.selectOptions(screen.getByLabelText('타입'), 'boolean')
    expect(screen.getByLabelText('필수')).toBeDisabled()
  })

  it('추가 모드에서 저장하면 모델에 항목이 생긴다', async () => {
    loadModelWithFields()
    renderDialog(null)
    await userEvent.type(screen.getByLabelText('이름'), '보존기간')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    const names = Object.values(useEditorStore.getState().model.customFields).map((f) => f.name)
    expect(names).toContain('보존기간')
  })

  it('select 타입에 선택지가 없으면 저장 버튼이 비활성이고 안내 문구가 보인다', async () => {
    loadModelWithFields()
    renderDialog(null)
    await userEvent.type(screen.getByLabelText('이름'), '보존기간')
    await userEvent.selectOptions(screen.getByLabelText('타입'), 'select')
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
    expect(screen.getByText('선택형은 선택지를 하나 이상 입력해야 합니다')).toBeInTheDocument()
  })

  it('select 타입에 선택지를 입력하면 저장 버튼이 활성화된다', async () => {
    loadModelWithFields()
    renderDialog(null)
    await userEvent.type(screen.getByLabelText('이름'), '보존기간')
    await userEvent.selectOptions(screen.getByLabelText('타입'), 'select')
    await userEvent.type(screen.getByLabelText('선택지 (쉼표로 구분)'), 'Y, N')
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled()
  })

  it('select 타입의 기본값이 선택지에 없으면 저장 버튼이 비활성이다', async () => {
    loadModelWithFields()
    renderDialog(null)
    await userEvent.type(screen.getByLabelText('이름'), '보존기간')
    await userEvent.selectOptions(screen.getByLabelText('타입'), 'select')
    await userEvent.type(screen.getByLabelText('선택지 (쉼표로 구분)'), 'Y, N')
    await userEvent.type(screen.getByLabelText('기본값'), 'Z')
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
    expect(screen.getByText('기본값은 선택지 중 하나여야 합니다')).toBeInTheDocument()
  })

  it('boolean 타입의 기본값이 true/false가 아니면 저장 버튼이 비활성이고, true면 활성이다', async () => {
    loadModelWithFields()
    renderDialog(null)
    await userEvent.type(screen.getByLabelText('이름'), '삭제여부')
    await userEvent.selectOptions(screen.getByLabelText('타입'), 'boolean')
    await userEvent.type(screen.getByLabelText('기본값'), 'yes')
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled()
    expect(screen.getByText('불리언 기본값은 true 또는 false여야 합니다')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('기본값'))
    await userEvent.type(screen.getByLabelText('기본값'), 'true')
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled()
  })

  it('중복 선택지를 저장하면 모델의 options에 중복이 제거된다', async () => {
    loadModelWithFields()
    renderDialog(null)
    await userEvent.type(screen.getByLabelText('이름'), '등급')
    await userEvent.selectOptions(screen.getByLabelText('타입'), 'select')
    await userEvent.type(screen.getByLabelText('선택지 (쉼표로 구분)'), 'Y, N, Y')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    const created = Object.values(useEditorStore.getState().model.customFields)
      .find((f) => f.name === '등급')
    expect(created?.options).toEqual(['Y', 'N'])
  })
})
