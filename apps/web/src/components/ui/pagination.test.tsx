import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Pagination } from './pagination'

afterEach(cleanup)

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
})
