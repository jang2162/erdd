import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createEmptyModel } from '@erdd/core'
import { useEditorStore } from './store.js'
import { NamingCheck } from './naming-check.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

// 논리명은 비워둔다(단어사전 미등록으로 인한 unknown-word 경고를 배제해 케이스를 단순화).
function loadWith(physicalName: string) {
  const m = createEmptyModel()
  m.tables['t1'] = {
    id: 't1', logicalName: '', physicalName, comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
  useEditorStore.getState().setProjectConfig(
    { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 }, ['postgresql'])
}

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('NamingCheck', () => {
  it('예약어 물리명 경고를 보여주고 클릭 시 해당 테이블을 선택한다', async () => {
    loadWith('ORDER') // 예약어
    render(<NamingCheck projectId={PROJECT_ID} />)
    await userEvent.click(screen.getByRole('button', { name: /모델 검사/ }))
    expect(screen.getByText('예약어 (1)')).toBeInTheDocument()
    await userEvent.click(screen.getByText('ORDER'))
    await waitFor(() => expect(useEditorStore.getState().selectedTableId).toBe('t1'))
  })

  it('규칙에 부합하면 경고 없음을 표시한다', async () => {
    loadWith('ORD') // 안전한 물리명, 논리명 비어 unknown-word도 없음
    render(<NamingCheck projectId={PROJECT_ID} />)
    await userEvent.click(screen.getByRole('button', { name: /모델 검사/ }))
    expect(screen.getByText(/경고가 없습니다/)).toBeInTheDocument()
  })

  it('필수 커스텀 항목 미입력을 그룹으로 보여주고 클릭 시 해당 테이블을 선택한다', async () => {
    const m = createEmptyModel()
    m.customFields['cf1'] = {
      id: 'cf1', name: '업무구분', target: 'table', type: 'text',
      options: [], required: true, defaultValue: null, order: 0,
    }
    m.tables['t1'] = {
      id: 't1', logicalName: '', physicalName: 'ORD', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    useEditorStore.getState().setProjectConfig(
      { case: 'UPPER_SNAKE', separator: '_', maxLengthBytes: 30 }, ['postgresql'])
    render(<NamingCheck projectId={PROJECT_ID} />)

    await userEvent.click(screen.getByRole('button', { name: /모델 검사/ }))
    expect(screen.getByText('필수 항목 미입력 (1)')).toBeInTheDocument()
    await userEvent.click(screen.getByText('ORD'))
    await waitFor(() => expect(useEditorStore.getState().selectedTableId).toBe('t1'))
  })
})
