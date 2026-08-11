import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FieldLabel } from './field-label.js'

afterEach(() => { cleanup() })

describe('FieldLabel', () => {
  it('required면 별표를 붙이고 스크린리더용 텍스트를 준다', () => {
    render(<FieldLabel htmlFor="x" required>논리명</FieldLabel>)
    expect(screen.getByText('논리명')).toBeInTheDocument()
    expect(screen.getByText('*')).toBeInTheDocument()
    expect(screen.getByText('(필수)')).toBeInTheDocument()
  })

  it('required가 없으면 별표를 붙이지 않는다', () => {
    render(<FieldLabel htmlFor="x">설명</FieldLabel>)
    expect(screen.getByText('설명')).toBeInTheDocument()
    expect(screen.queryByText('*')).toBeNull()
    expect(screen.queryByText('(필수)')).toBeNull()
  })

  it('htmlFor를 그대로 넘긴다', () => {
    render(
      <>
        <FieldLabel htmlFor="fld" required>논리명</FieldLabel>
        <input id="fld" />
      </>,
    )
    expect(screen.getByLabelText(/논리명/)).toBeInTheDocument()
  })
})
