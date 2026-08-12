import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const zoomIn = vi.fn()
const zoomOut = vi.fn()
const zoomTo = vi.fn()
const fitView = vi.fn()
let currentZoom = 1

// React Flow 컨텍스트 없이 렌더하기 위해 두 훅만 갈아끼운다. 실제 뷰포트가 없어도 배율 표시와
// 버튼 배선을 검증할 수 있다.
vi.mock('@xyflow/react', () => ({
  useReactFlow: () => ({ zoomIn, zoomOut, zoomTo, fitView }),
  useStore: (selector: (s: { transform: [number, number, number] }) => unknown) =>
    selector({ transform: [0, 0, currentZoom] }),
}))

const { ZoomControls } = await import('./zoom-controls.js')

afterEach(() => {
  cleanup()
  currentZoom = 1
  ;[zoomIn, zoomOut, zoomTo, fitView].forEach((f) => f.mockClear())
})

describe('ZoomControls', () => {
  it('현재 배율을 백분율로 보여준다', () => {
    currentZoom = 0.755
    render(<ZoomControls />)
    expect(screen.getByRole('button', { name: '배율 100%로' })).toHaveTextContent('76%')
  })

  it('줌 인·줌 아웃·화면 맞춤이 각각 React Flow API를 부른다', async () => {
    render(<ZoomControls />)
    await userEvent.click(screen.getByRole('button', { name: '확대' }))
    await userEvent.click(screen.getByRole('button', { name: '축소' }))
    await userEvent.click(screen.getByRole('button', { name: '화면에 맞춤' }))
    expect(zoomIn).toHaveBeenCalledTimes(1)
    expect(zoomOut).toHaveBeenCalledTimes(1)
    expect(fitView).toHaveBeenCalledTimes(1)
  })

  it('배율 표시를 누르면 100%로 되돌린다', async () => {
    currentZoom = 2
    render(<ZoomControls />)
    await userEvent.click(screen.getByRole('button', { name: '배율 100%로' }))
    expect(zoomTo).toHaveBeenCalledWith(1)
  })
})
