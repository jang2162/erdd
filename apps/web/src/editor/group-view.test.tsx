import { beforeEach, describe, expect, it } from 'vitest'
import { act } from '@testing-library/react'
import { createEmptyModel } from '@erdd/core'
import { moveTableGroupPosition } from './model-edits.js'
import { useEditorStore } from './store.js'
import type { Table } from '@erdd/core'

beforeEach(() => { act(() => useEditorStore.getState().reset()) })

function tbl(id: string): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId: null,
    position: { x: 10, y: 20 }, groupPosition: null, custom: {} }
}

describe('store activeGroupView', () => {
  it('enterGroupView는 뷰를 설정하고 선택을 해제한다', () => {
    act(() => { useEditorStore.getState().select('T'); useEditorStore.getState().enterGroupView('G1') })
    const s = useEditorStore.getState()
    expect(s.activeGroupView).toBe('G1')
    expect(s.selectedTableId).toBeNull()
  })
  it('exitGroupView는 전체 뷰로 되돌린다', () => {
    act(() => { useEditorStore.getState().enterGroupView('G1'); useEditorStore.getState().exitGroupView() })
    expect(useEditorStore.getState().activeGroupView).toBeNull()
  })
  it('setLoaded는 activeGroupView를 null로 초기화한다', () => {
    act(() => {
      useEditorStore.getState().enterGroupView('G1')
      useEditorStore.getState().setLoaded(createEmptyModel(), 1, 'p1')
    })
    expect(useEditorStore.getState().activeGroupView).toBeNull()
  })
})

describe('moveTableGroupPosition', () => {
  it('groupPosition만 설정하고 position은 유지한다', () => {
    const m = createEmptyModel()
    m.tables['T'] = tbl('T')
    const next = moveTableGroupPosition(m, 'T', { x: 500, y: 600 })
    expect(next.tables['T']!.groupPosition).toEqual({ x: 500, y: 600 })
    expect(next.tables['T']!.position).toEqual({ x: 10, y: 20 })
  })
  it('없는 테이블은 no-op', () => {
    const m = createEmptyModel()
    expect(moveTableGroupPosition(m, 'X', { x: 0, y: 0 })).toBe(m)
  })
})
