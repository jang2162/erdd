import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { ExportDialog } from './export-dialog.js'

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

describe('ExportDialog', () => {
  it('opening the dialog renders a CREATE TABLE preview for the default dialect', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    render(<ExportDialog />)
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    const preview = screen.getByLabelText('DDL 미리보기')
    expect(preview.textContent).toContain('CREATE TABLE MBR_GRD')
    expect(preview.textContent).toContain('CREATE TABLE MBR')
  })

  it('switching the dialect to Oracle updates the preview to Oracle-specific types', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    render(<ExportDialog />)
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await userEvent.click(screen.getByRole('button', { name: 'Oracle' }))
    const preview = screen.getByLabelText('DDL 미리보기')
    expect(preview.textContent).toContain('VARCHAR2(100)')
    expect(preview.textContent).toContain('NUMBER(19)')
  })
})
