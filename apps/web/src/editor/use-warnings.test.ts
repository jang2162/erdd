import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'
import { createEmptyModel } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useWarnings } from './use-warnings.js'

const PROJECT_ID = '018f6b0e-0000-7000-8000-0000000000cc'

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('useWarnings', () => {
  it('예약어 물리명에 경고를 낸다', () => {
    const m = createEmptyModel()
    m.terms['term1'] = {
      id: 'term1', logicalName: '주문', physicalName: 'ORDER',
      domainId: null, description: null, origin: null,
    }
    m.tables['t1'] = {
      id: 't1', logicalName: '주문', physicalName: 'ORDER', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    useEditorStore.getState().setLoaded(m, 1, PROJECT_ID)
    // 예약어 경고는 dialect가 있어야 계산된다(core warnings.ts).
    useEditorStore.getState().setProjectConfig(
      { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30 }, ['postgresql'], null)

    const { result } = renderHook(() => useWarnings())

    expect(result.current.some((w) => w.kind === 'reserved')).toBe(true)
  })

  it('모델이 비어 있으면 빈 배열이다', () => {
    useEditorStore.getState().setLoaded(createEmptyModel(), 1, PROJECT_ID)

    const { result } = renderHook(() => useWarnings())

    expect(result.current).toEqual([])
  })
})
