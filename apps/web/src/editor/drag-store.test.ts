import { afterEach, describe, expect, it } from 'vitest'
import { useDragStore } from './drag-store.js'

afterEach(() => { useDragStore.getState().end() })

describe('useDragStore', () => {
  it('start는 끌 대상을 담고 타깃을 비운다', () => {
    useDragStore.getState().moveOver({ groupId: 'g1' })
    useDragStore.getState().start(['t1', 't2'])
    expect(useDragStore.getState().tableIds).toEqual(['t1', 't2'])
    expect(useDragStore.getState().over).toBeNull()
  })

  it('end는 드래그 중이 아님으로 되돌린다', () => {
    useDragStore.getState().start(['t1'])
    useDragStore.getState().moveOver({ groupId: 'g1' })
    useDragStore.getState().end()
    expect(useDragStore.getState().tableIds).toEqual([])
    expect(useDragStore.getState().over).toBeNull()
  })

  it('같은 그룹 위에 머무르면 over 참조를 유지한다', () => {
    // pointermove마다 새 객체를 넣으면 over를 구독하는 컴포넌트가 커서 한 픽셀마다 리렌더된다.
    useDragStore.getState().start(['t1'])
    useDragStore.getState().moveOver({ groupId: 'g1' })
    const first = useDragStore.getState().over
    useDragStore.getState().moveOver({ groupId: 'g1' })   // 같은 값, 다른 객체
    expect(useDragStore.getState().over).toBe(first)
  })

  it('미분류 타깃과 "타깃 밖"은 다른 상태다', () => {
    // { groupId: null } 은 미분류 블록 위, null 은 어떤 드롭 타깃 위도 아님이다.
    // 둘을 같게 보면 미분류 위로 들어가도 하이라이트가 켜지지 않고 드롭이 무시된다.
    useDragStore.getState().start(['t1'])
    useDragStore.getState().moveOver({ groupId: null })
    expect(useDragStore.getState().over).toEqual({ groupId: null })
    useDragStore.getState().moveOver(null)
    expect(useDragStore.getState().over).toBeNull()
    useDragStore.getState().moveOver({ groupId: null })
    expect(useDragStore.getState().over).toEqual({ groupId: null })
  })

  it('start는 넘겨받은 배열을 복사한다 — 호출자의 선택 배열과 엮이지 않는다', () => {
    const ids = ['t1']
    useDragStore.getState().start(ids)
    expect(useDragStore.getState().tableIds).not.toBe(ids)
    expect(useDragStore.getState().tableIds).toEqual(['t1'])
  })
})
