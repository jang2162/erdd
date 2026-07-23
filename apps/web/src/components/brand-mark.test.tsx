import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BrandWordmark } from './brand-mark.js'

describe('BrandWordmark', () => {
  it('renders the ERDD wordmark with the table glyph', () => {
    render(<BrandWordmark />)
    expect(screen.getByText('ERDD')).toBeDefined()
  })
})
