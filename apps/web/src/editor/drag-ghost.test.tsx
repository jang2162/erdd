import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useDragStore } from './drag-store.js'
import { DragGhost } from './drag-ghost.js'

afterEach(() => { cleanup(); vi.restoreAllMocks(); useDragStore.getState().end() })

describe('DragGhost', () => {
  it('드래그 중이 아니면 아무것도 그리지 않는다', () => {
    render(<DragGhost />)
    expect(screen.queryByTestId('drag-ghost')).toBeNull()
  })

  it('드래그 중에는 끌고 있는 개수를 보여준다', () => {
    render(<DragGhost />)
    act(() => { useDragStore.getState().start(['t1', 't2', 't3'], 'sidebar') })
    expect(screen.getByTestId('drag-ghost')).toHaveTextContent('3개 테이블')
  })

  it('캔버스 드래그에서는 뜨지 않는다', () => {
    // 캔버스는 ReactFlow가 **노드 자체를** 끌고 다닌다. 거기에 고스트까지 겹쳐 떠다니면 무엇을
    // 조준하고 있는지 오히려 가려진다 — 고스트는 끄는 것이 안 보이는 사이드바 전용 표시다(설계 5.3).
    render(<DragGhost />)
    act(() => { useDragStore.getState().start(['t1', 't2'], 'canvas') })
    expect(screen.queryByTestId('drag-ghost')).toBeNull()
  })

  it('드래그가 끝나면 사라진다', () => {
    render(<DragGhost />)
    act(() => { useDragStore.getState().start(['t1'], 'sidebar') })
    expect(screen.getByTestId('drag-ghost')).toBeInTheDocument()
    act(() => { useDragStore.getState().end() })
    expect(screen.queryByTestId('drag-ghost')).toBeNull()
  })

  it('pointer-events를 받지 않는다 — 받으면 elementFromPoint가 고스트를 집어 드롭이 통째로 죽는다', () => {
    // 이 계약이 깨지면 `dropTargetAt`이 커서 아래에서 언제나 고스트를 찾아 `over`가 영원히 null이
    // 되고, 드래그는 되는데 놓아도 아무 일이 없다. jsdom은 히트 테스트를 못 하므로 여기서는
    // 선언 자체를 잠근다(실제 조준은 브라우저 스모크가 본다).
    render(<DragGhost />)
    act(() => { useDragStore.getState().start(['t1'], 'sidebar') })
    expect(screen.getByTestId('drag-ghost')).toHaveStyle({ pointerEvents: 'none' })
  })

  it('커서를 따라간다 — 리렌더가 아니라 자기 DOM의 transform만 고친다', () => {
    // pointermove마다 React state를 갱신하면 사이드바 전체가 커서 한 픽셀마다 리렌더된다(설계 5.2).
    render(<DragGhost />)
    act(() => { useDragStore.getState().start(['t1'], 'sidebar') })
    const ghost = screen.getByTestId('drag-ghost')
    fireEvent.pointerMove(window, { clientX: 100, clientY: 200 })
    expect(ghost.style.transform).toBe('translate(112px, 212px)')
    fireEvent.pointerMove(window, { clientX: 150, clientY: 40 })
    expect(ghost.style.transform).toBe('translate(162px, 52px)')
  })

  it('드래그가 끝나면 window 리스너를 뗀다', () => {
    // 떼지 않으면 드래그할 때마다 하나씩 쌓여, 오래 연 세션에서 커서를 움직일 때마다 죽은
    // 리스너 수십 개가 detach된 노드의 style을 만진다.
    const remove = vi.spyOn(window, 'removeEventListener')
    render(<DragGhost />)
    act(() => { useDragStore.getState().start(['t1'], 'sidebar') })
    act(() => { useDragStore.getState().end() })
    expect(remove).toHaveBeenCalledWith('pointermove', expect.any(Function))
  })
})
