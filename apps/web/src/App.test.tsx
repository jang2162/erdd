import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { App } from './App.js'

describe('App', () => {
  it('renders the ERDD heading', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'ERDD' })).toBeDefined()
  })
})
