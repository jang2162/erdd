import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { GroupViewSelect } from './group-view-select.js'

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('GroupViewSelect', () => {
  it('활성 그룹이 존재하면 해당 그룹을 선택 상태로 보여준다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    useEditorStore.getState().enterGroupView('g1')
    render(<GroupViewSelect />)

    const select = screen.getByLabelText('뷰 전환') as HTMLSelectElement
    expect(select.value).toBe('g1')
  })

  it('활성 그룹이 삭제된 상태(더 이상 존재하지 않음)면 "전체 뷰"로 되돌린다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    // 목록이 비지 않도록 g2를 추가해 둔 채, 활성 뷰였던 g1만 삭제되는 상황을 재현한다.
    useEditorStore.setState((s) => ({
      model: {
        ...s.model,
        tableGroups: { ...s.model.tableGroups, g2: { id: 'g2', name: '주문', color: '#000', comment: null } },
      },
    }))
    useEditorStore.getState().enterGroupView('g1')
    useEditorStore.setState((s) => {
      const tableGroups = { ...s.model.tableGroups }
      delete tableGroups['g1']
      return { model: { ...s.model, tableGroups } }
    })
    render(<GroupViewSelect />)

    const select = screen.getByLabelText('뷰 전환') as HTMLSelectElement
    expect(select.value).toBe('')
  })
})
