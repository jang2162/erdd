import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createEmptyModel } from '@erdd/core'
import { useEditorStore } from './store.js'
import { NamingCheck } from './naming-check.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000aa'

// 논리명 '주문'과 물리명이 정확히 일치하는 용어를 등록해 둔다 — 용어 완전일치 경로로
// unknown-word(단어사전 미등록)·term-mismatch를 피하면서도 논리명·물리명을 모두 채워
// required-empty 노이즈 없이 케이스를 단순화한다.
function loadWith(physicalName: string) {
  const m = createEmptyModel()
  m.terms['term1'] = {
    id: 'term1', logicalName: '주문', physicalName, domainId: null, description: null, origin: null,
  }
  m.tables['t1'] = {
    id: 't1', logicalName: '주문', physicalName, comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
  useEditorStore.getState().setProjectConfig(
    { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30, tablePhysicalTemplate: '' }, ['postgresql'], null)
}

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('NamingCheck', () => {
  it('예약어 물리명 경고를 보여주고 클릭 시 해당 테이블을 선택한다', async () => {
    loadWith('ORDER') // 예약어
    render(<NamingCheck projectId={PROJECT_ID} open onOpenChange={() => {}} />)
    expect(screen.getByText('예약어 (1)')).toBeInTheDocument()
    await userEvent.click(screen.getByText('ORDER'))
    await waitFor(() => expect(useEditorStore.getState().selectedTableIds).toEqual(['t1']))
  })

  it('규칙에 부합하면 경고 없음을 표시한다', async () => {
    loadWith('ORD') // 안전한 물리명(예약어 아님, 길이 제한 이내), 용어 완전일치로 명명 경고도 없음
    render(<NamingCheck projectId={PROJECT_ID} open onOpenChange={() => {}} />)
    expect(screen.getByText(/경고가 없습니다/)).toBeInTheDocument()
  })

  it('필수 커스텀 항목 미입력을 그룹으로 보여주고 클릭 시 해당 테이블을 선택한다', async () => {
    const m = createEmptyModel()
    m.customFields['cf1'] = {
      id: 'cf1', name: '업무구분', target: 'table', type: 'text',
      options: [], required: true, defaultValue: null, order: 0, origin: null,
    }
    m.terms['term1'] = {
      id: 'term1', logicalName: '주문', physicalName: 'ORD', domainId: null, description: null, origin: null,
    }
    m.tables['t1'] = {
      id: 't1', logicalName: '주문', physicalName: 'ORD', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    useEditorStore.getState().setProjectConfig(
      { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30, tablePhysicalTemplate: '' }, ['postgresql'], null)
    render(<NamingCheck projectId={PROJECT_ID} open onOpenChange={() => {}} />)

    expect(screen.getByText('필수 항목 미입력 (1)')).toBeInTheDocument()
    await userEvent.click(screen.getByText('ORD'))
    await waitFor(() => expect(useEditorStore.getState().selectedTableIds).toEqual(['t1']))
  })
})
