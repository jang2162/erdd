import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { Warning } from '@erdd/core'
import { WarningBadge } from './warning-badge.js'

afterEach(() => {
  cleanup()
})

describe('WarningBadge', () => {
  it('renders nothing when there are no warnings', () => {
    const { container } = render(<WarningBadge warnings={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the count and an aria-label listing the messages when there are warnings', () => {
    const warnings: Warning[] = [
      { kind: 'duplicate-physical', scope: 'column', entityId: 'c1', tableId: 't1', message: '물리명 중복' },
      { kind: 'incomplete-mapping', scope: 'relationship', entityId: 'r1', message: '매핑 불완전' },
    ]
    render(<WarningBadge warnings={warnings} />)
    expect(screen.getByText('2')).toBeInTheDocument()
    // aria-label의 개행은 testing-library 정규화 시 공백으로 합쳐지므로 정규식으로 매칭하고
    // 실제 속성값(개행 포함)은 별도로 검증한다.
    const badge = screen.getByLabelText(/경고 2건: 물리명 중복/)
    expect(badge.getAttribute('aria-label')).toBe('경고 2건: 물리명 중복\n매핑 불완전')
  })

  it('경고 수를 천 단위로 끊는다 — 배지 숫자와 aria-label 모두', () => {
    const warnings: Warning[] = Array.from({ length: 1234 }, (_, i) => (
      { kind: 'duplicate-physical', scope: 'column', entityId: `c${i}`, tableId: 't1', message: '물리명 중복' }
    ))
    render(<WarningBadge warnings={warnings} />)
    expect(screen.getByText('1,234')).toBeInTheDocument()
    expect(screen.getByLabelText(/^경고 1,234건: /)).toBeInTheDocument()
  })
})
