import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PromoteEntry } from '@erdd/core'
import { PromoteEntryList } from './promote-entry-list'

const ENTRY: PromoteEntry = {
  kind: 'word', entityId: 'w1', name: '회원', status: 'new',
  targetItemId: null, targetVersion: null, payload: {}, changedFields: [], domainRef: null,
  sourceBehind: false,
}

afterEach(cleanup)

describe('PromoteEntryList', () => {
  it('구역 일괄 버튼이 onSetAll을 그 구역의 상태로 부른다', async () => {
    const onSetAll = vi.fn()
    render(
      <PromoteEntryList audience="promote" entries={[ENTRY]} selected={new Set()}
        onToggle={vi.fn()} onSetAll={onSetAll} />,
    )
    await userEvent.click(screen.getByRole('button', { name: '모두 선택' }))
    expect(onSetAll).toHaveBeenCalledWith('new', true)
    await userEvent.click(screen.getByRole('button', { name: '모두 해제' }))
    expect(onSetAll).toHaveBeenCalledWith('new', false)
  })

  it('syncedCount를 주면 유지 섹션을 보여준다', () => {
    render(
      <PromoteEntryList audience="promote" entries={[ENTRY]} selected={new Set()}
        onToggle={vi.fn()} onSetAll={vi.fn()} syncedCount={3} />,
    )
    expect(screen.getByText(/이미 이 라이브러리와 같은 항목 3건/)).toBeTruthy()
  })

  it('syncedCount를 주지 않으면 유지 섹션이 없다', () => {
    render(
      <PromoteEntryList audience="promote" entries={[ENTRY]} selected={new Set()}
        onToggle={vi.fn()} onSetAll={vi.fn()} />,
    )
    expect(screen.queryByText(/유지/)).toBeNull()
  })

  const entries = (n: number): PromoteEntry[] => Array.from({ length: n }, (_, i) => ({
    ...ENTRY, entityId: `w${i}`, name: `단어${String(i).padStart(3, '0')}`,
    payload: { logicalName: `단어${String(i).padStart(3, '0')}`, abbreviation: `W${String(i).padStart(3, '0')}` },
  }))

  it('구역이 50건씩 나뉘고 체크 표시는 쪽과 무관하게 selected 를 따른다 — 행에 물리명이 보인다', async () => {
    render(
      <PromoteEntryList audience="promote" entries={entries(60)} selected={new Set(['w55'])}
        onToggle={vi.fn()} onSetAll={vi.fn()} />,
    )
    const section = within(screen.getByRole('region', { name: '신규 추가' }))
    expect(section.getByText('W000')).toBeInTheDocument()
    expect(section.queryByRole('checkbox', { name: '단어055 선택' })).toBeNull()
    await userEvent.click(section.getByRole('button', { name: '다음' }))
    expect(section.getByRole('checkbox', { name: '단어055 선택' })).toBeChecked()
  })

  it('검색 중 「모두 선택」도 구역 단위로 부른다 — 구역 전체 안내가 붙는다', async () => {
    const onSetAll = vi.fn()
    render(
      <PromoteEntryList audience="promote" entries={entries(60)} selected={new Set()}
        onToggle={vi.fn()} onSetAll={onSetAll} />,
    )
    const section = within(screen.getByRole('region', { name: '신규 추가' }))
    await userEvent.type(section.getByRole('textbox', { name: '신규 추가 검색' }), 'w05')
    expect(section.getByText('구역 전체 60건에 적용')).toBeInTheDocument()
    await userEvent.click(section.getByRole('button', { name: '모두 선택' }))
    expect(onSetAll).toHaveBeenCalledWith('new', true)
  })
})
