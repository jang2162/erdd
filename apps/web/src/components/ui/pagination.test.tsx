import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { Pagination } from './pagination'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** 스크롤 영역(`scroller`) 안의 목록(`list`)과 그 아래 페이지 버튼. 목록 쪽이 넘어가도 목록 요소는 그대로다. */
function ScrollFixture({ onPageChange, withRef = true, parentScrolls = false }: {
  onPageChange: (page: number) => void; withRef?: boolean; parentScrolls?: boolean
}) {
  const listRef = useRef<HTMLUListElement>(null)
  return (
    <div data-testid="scroller" style={parentScrolls ? { overflowY: 'auto' } : undefined}>
      <ul ref={listRef} data-testid="list" style={{ overflowY: 'auto' }}><li>행</li></ul>
      <Pagination page={1} pageCount={3} total={120} onPageChange={onPageChange}
        listRef={withRef ? listRef : undefined} />
    </div>
  )
}

function rectTop(el: HTMLElement, top: number) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top } as DOMRect)
}

describe('Pagination', () => {
  it('한 쪽뿐이면 아무것도 그리지 않는다', () => {
    const { container } = render(<Pagination page={1} pageCount={1} total={30} onPageChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('「이전 · 3 / 263 · 다음」과 전체 건수를 천 단위로 보인다', () => {
    render(<Pagination page={3} pageCount={263} total={13159} onPageChange={vi.fn()} />)
    expect(screen.getByText('3 / 263')).toBeInTheDocument()
    expect(screen.getByText('전체 13,159건')).toBeInTheDocument()
  })
  it('첫 쪽에서는 이전이, 끝 쪽에서는 다음이 잠기고 누르면 이웃 쪽을 알린다', async () => {
    const onPageChange = vi.fn()
    const { rerender } = render(<Pagination page={1} pageCount={3} total={120} onPageChange={onPageChange} />)
    expect(screen.getByRole('button', { name: '이전' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(onPageChange).toHaveBeenLastCalledWith(2)
    rerender(<Pagination page={3} pageCount={3} total={120} onPageChange={onPageChange} />)
    expect(screen.getByRole('button', { name: '다음' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '이전' }))
    expect(onPageChange).toHaveBeenLastCalledWith(2)
  })

  it('쪽을 넘기면 스스로 스크롤하는 목록을 맨 위로 올린다 — 끝까지 내려 「다음」을 눌러도 다음 쪽의 처음부터 보인다', async () => {
    const onPageChange = vi.fn()
    render(<ScrollFixture onPageChange={onPageChange} />)
    const list = screen.getByTestId('list')
    list.scrollTop = 400
    expect(list.scrollTop).toBe(400)
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(onPageChange).toHaveBeenLastCalledWith(2)
    expect(list.scrollTop).toBe(0)
  })

  it('목록 머리가 바깥 스크롤 영역 위로 벗어나 있으면 머리를 영역 위에 맞추고, 보이고 있으면 건드리지 않는다', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    render(<ScrollFixture onPageChange={vi.fn()} parentScrolls />)
    const list = screen.getByTestId('list')
    rectTop(screen.getByTestId('scroller'), 100)
    rectTop(list, 120)
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(scrollIntoView).not.toHaveBeenCalled()
    rectTop(list, -300)
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(list)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
  })

  it('목록을 넘겨받지 않으면 스크롤을 건드리지 않는다', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    render(<ScrollFixture onPageChange={vi.fn()} withRef={false} parentScrolls />)
    const list = screen.getByTestId('list')
    list.scrollTop = 400
    rectTop(list, -300)
    await userEvent.click(screen.getByRole('button', { name: '다음' }))
    expect(list.scrollTop).toBe(400)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })
})
