import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PagedSection } from './paged-section'

type Row = { id: string; name: string; code: string | null }
const FIELDS = (r: Row) => [r.name, r.code]
const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `이름${String(i).padStart(2, '0')}`, code: `C${i}` }))

function renderSection(list: Row[], onAll = vi.fn()) {
  render(
    <PagedSection title="신규 추가" rows={list} fields={FIELDS}
      renderRow={(r) => <li key={r.id}>{r.name}</li>}
      actions={<button type="button" onClick={onAll}>모두 선택</button>} />,
  )
  return within(screen.getByRole('region', { name: '신규 추가' }))
}

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('PagedSection', () => {
  it('제목에 구역 전체 건수를 적고 50건씩 보이며 다음 쪽으로 넘긴다', async () => {
    const section = renderSection(rows(60))
    expect(section.getByText('신규 추가 (60)')).toBeInTheDocument()
    expect(section.getByText('이름49')).toBeInTheDocument()
    expect(section.queryByText('이름50')).toBeNull()
    await userEvent.click(section.getByRole('button', { name: '다음' }))
    expect(section.getByText('이름50')).toBeInTheDocument()
  })

  it('검색은 1쪽으로 돌아가고 논리명·물리명 칸 어느 쪽으로도 찾는다', async () => {
    const section = renderSection(rows(60))
    await userEvent.click(section.getByRole('button', { name: '다음' }))
    await userEvent.type(section.getByRole('textbox', { name: '신규 추가 검색' }), 'c5')
    expect(section.getByText('이름05')).toBeInTheDocument()
    expect(section.getByText('이름50')).toBeInTheDocument()
    expect(section.queryByRole('button', { name: '다음' })).toBeNull()
  })

  it('검색 중이거나 쪽이 여럿이면 일괄 버튼 옆에 「구역 전체 N건에 적용」을 보인다', async () => {
    const small = renderSection(rows(3))
    expect(small.queryByText(/구역 전체/)).toBeNull()
    await userEvent.type(small.getByRole('textbox', { name: '신규 추가 검색' }), '이름0')
    expect(small.getByText('구역 전체 3건에 적용')).toBeInTheDocument()
    cleanup()
    expect(renderSection(rows(60)).getByText('구역 전체 60건에 적용')).toBeInTheDocument()
  })

  it('행이 없으면 일괄 버튼과 검색창을 숨긴다', () => {
    const section = renderSection([])
    expect(section.getByText('신규 추가 (0)')).toBeInTheDocument()
    expect(section.queryByRole('button', { name: '모두 선택' })).toBeNull()
    expect(section.queryByRole('textbox')).toBeNull()
  })

  it('쪽을 넘길 때 구역 머리가 바깥 스크롤 영역 위로 벗어나 있으면 머리를 영역 위에 맞춘다', async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {})
    render(
      <div data-testid="scroller" style={{ overflowY: 'auto' }}>
        <PagedSection title="신규 추가" rows={rows(60)} fields={FIELDS} renderRow={(r) => <li key={r.id}>{r.name}</li>} />
      </div>,
    )
    const region = screen.getByRole('region', { name: '신규 추가' })
    vi.spyOn(screen.getByTestId('scroller'), 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
    vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({ top: -900 } as DOMRect)   // 끝까지 내려 머리가 위로 벗어났다
    await userEvent.click(within(region).getByRole('button', { name: '다음' }))
    expect(within(region).getByText('이름50')).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(region)
  })
})
