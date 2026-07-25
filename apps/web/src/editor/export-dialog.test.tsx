import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { ExportDialog } from './export-dialog.js'

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

// ExportDialog는 이미지 내보내기를 위해 useReactFlow를 사용하므로 React Flow 컨텍스트가 필요하다.
function renderDialog() {
  return render(
    <ReactFlowProvider>
      <ExportDialog />
    </ReactFlowProvider>,
  )
}

describe('ExportDialog', () => {
  it('opening the dialog renders a CREATE TABLE preview for the default dialect', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    const preview = screen.getByLabelText('DDL 미리보기')
    expect(preview.textContent).toContain('CREATE TABLE MBR_GRD')
    expect(preview.textContent).toContain('CREATE TABLE MBR')
  })

  it('switching the dialect to Oracle updates the preview to Oracle-specific types', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await userEvent.click(screen.getByRole('button', { name: 'Oracle' }))
    const preview = screen.getByLabelText('DDL 미리보기')
    expect(preview.textContent).toContain('VARCHAR2(100)')
    expect(preview.textContent).toContain('NUMBER(19)')
  })

  it('switching to the 이미지 section renders format controls and a download button', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await userEvent.click(screen.getByRole('button', { name: '이미지' }))
    expect(screen.getByRole('button', { name: 'PNG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SVG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다운로드' })).toBeInTheDocument()
  })
})
