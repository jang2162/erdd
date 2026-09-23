import { describe, expect, it, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
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
})
