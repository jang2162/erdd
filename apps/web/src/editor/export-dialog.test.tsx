import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ReactFlowProvider } from '@xyflow/react'
import type { SheetData } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { ExportDialog } from './export-dialog.js'

const { downloadExcelWorkbook } = vi.hoisted(() => ({
  downloadExcelWorkbook: vi.fn<(sheets: SheetData[], fileName: string) => Promise<void>>(
    () => Promise.resolve(),
  ),
}))
vi.mock('./excel-file.js', () => ({ downloadExcelWorkbook }))

afterEach(() => { cleanup(); useEditorStore.getState().reset(); downloadExcelWorkbook.mockClear() })

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

  it('switching the dialect to Oracle shows a conversion warning for a TIME column', async () => {
    const model = buildSampleModel()
    model.columns.c3!.type = 'TIME'
    useEditorStore.getState().setLoaded(model, 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await userEvent.click(screen.getByRole('button', { name: 'Oracle' }))
    const warnings = screen.getByLabelText('DDL 경고')
    expect(warnings.textContent).toContain('MBR.MBR_NM')
    expect(warnings.textContent).toContain('TIME')
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

  it('Excel 섹션으로 전환하면 시트 체크박스 5개를 보여준다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }))
    for (const name of ['테이블 목록', '테이블정의서', '단어사전', '용어사전', '도메인정의서']) {
      expect(screen.getByRole('checkbox', { name })).toBeChecked()
    }
  })

  it('Excel 시트를 전부 해제하면 다운로드 버튼이 비활성된다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }))
    for (const name of ['테이블 목록', '테이블정의서', '단어사전', '용어사전', '도메인정의서']) {
      await userEvent.click(screen.getByRole('checkbox', { name }))
    }
    expect(screen.getByRole('button', { name: /다운로드/ })).toBeDisabled()
  })

  it('DDL 섹션의 범위를 그룹 드롭다운으로 좁히면 미리보기가 그 그룹만 담는다', async () => {
    // 샘플 모델은 두 테이블이 모두 g1이므로, t2를 미배정으로 돌려 범위 효과가 보이게 한다.
    const m = buildSampleModel()
    useEditorStore.getState().setLoaded(
      { ...m, tables: { ...m.tables, t2: { ...m.tables['t2']!, groupId: null } } }, 1, 'p1',
    )
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await userEvent.selectOptions(screen.getByLabelText('그룹 선택'), 'g1')
    const preview = screen.getByLabelText('DDL 미리보기')
    expect(preview.textContent).toContain('CREATE TABLE MBR_GRD')
    expect(preview.textContent).not.toContain('MBR_NM')   // t2 전용 컬럼이 빠졌다
  })

  it('Excel 다운로드가 선택한 시트만 담아 빌더를 호출한다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '테이블 목록' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '용어사전' }))
    await userEvent.click(screen.getByRole('button', { name: /다운로드/ }))

    expect(downloadExcelWorkbook).toHaveBeenCalledTimes(1)
    const [sheets, fileName] = downloadExcelWorkbook.mock.calls[0]!
    expect(sheets.map((s) => s.key)).toEqual(['tableSpec', 'words', 'domains'])
    expect(fileName).toBe('erdd_정의서.xlsx')
  })

  it('그룹 범위 Excel 다운로드는 파일명에 그룹명을 붙이고 금지문자를 치환한다', async () => {
    const m = buildSampleModel()
    useEditorStore.getState().setLoaded(
      { ...m, tableGroups: { g1: { ...m.tableGroups['g1']!, name: '회원/관리' } } }, 1, 'p1',
    )
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '내보내기' }))
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }))
    await userEvent.selectOptions(screen.getByLabelText('그룹 선택'), 'g1')
    await userEvent.click(screen.getByRole('button', { name: /다운로드/ }))

    const [sheets, fileName] = downloadExcelWorkbook.mock.calls[0]!
    expect(fileName).toBe('erdd_정의서_회원_관리.xlsx')
    expect(sheets.find((s) => s.key === 'tableList')!.rows.every((r) => r[0] === '회원/관리')).toBe(true)
  })
})
