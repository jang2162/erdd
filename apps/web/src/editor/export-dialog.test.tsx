import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
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
      <ExportDialog open onOpenChange={() => {}} />
    </ReactFlowProvider>,
  )
}

describe('ExportDialog', () => {
  it('opening the dialog renders a CREATE TABLE preview for the default dialect', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    const preview = screen.getByLabelText('DDL 미리보기')
    expect(preview.textContent).toContain('CREATE TABLE MBR_GRD')
    expect(preview.textContent).toContain('CREATE TABLE MBR')
  })

  it('switching the dialect to Oracle updates the preview to Oracle-specific types', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
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
    await userEvent.click(screen.getByRole('button', { name: 'Oracle' }))
    const warnings = screen.getByLabelText('DDL 경고')
    expect(warnings.textContent).toContain('MBR.MBR_NM')
    expect(warnings.textContent).toContain('TIME')
  })

  it('switching to the 이미지 section renders format controls and a download button', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: '이미지' }))
    expect(screen.getByRole('button', { name: 'PNG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'SVG' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다운로드' })).toBeInTheDocument()
  })

  it('Excel 섹션으로 전환하면 시트 체크박스 5개를 보여준다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }))
    for (const name of ['테이블 목록', '테이블정의서', '단어사전', '용어사전', '도메인정의서']) {
      expect(screen.getByRole('checkbox', { name })).toBeChecked()
    }
  })

  it('Excel 시트를 전부 해제하면 다운로드 버튼이 비활성된다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
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
    await userEvent.selectOptions(screen.getByLabelText('그룹 선택'), 'g1')
    const preview = screen.getByLabelText('DDL 미리보기')
    expect(preview.textContent).toContain('CREATE TABLE MBR_GRD')
    expect(preview.textContent).not.toContain('MBR_NM')   // t2 전용 컬럼이 빠졌다
  })

  it('Excel 다운로드가 선택한 시트만 담아 빌더를 호출한다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '테이블 목록' }))
    await userEvent.click(screen.getByRole('checkbox', { name: '용어사전' }))
    await userEvent.click(screen.getByRole('button', { name: /다운로드/ }))

    expect(downloadExcelWorkbook).toHaveBeenCalledTimes(1)
    const [sheets, fileName] = downloadExcelWorkbook.mock.calls[0]!
    expect(sheets.map((s) => s.key)).toEqual(['tableSpec', 'words', 'domains'])
    expect(fileName).toBe('erdd_정의서.xlsx')
  })

  // ⚠️ 「구성 단어」는 분해 결과라 프로젝트 규칙에 따라 달라진다. rules 를 안 넘기면
  // buildExcelSheets 가 DEFAULT 로 조용히 떨어져 통과하므로(리뷰 실측: 되돌려도 web 전건 초록)
  // store 규칙이 실제로 흘러가는지를 **결과 값**으로 본다.
  it('Excel 내보내기는 store 의 namingRules 로 구성 단어를 분해한다', async () => {
    const m = buildSampleModel()
    m.words = {
      w1: { id:'w1', logicalName:'회원', abbreviation:'MBR', englishName:null, description:null, origin:null },
      w2: { id:'w2', logicalName:'번호', abbreviation:'NO', englishName:null, description:null, origin:null },
    }
    m.terms = {
      tm1: { id:'tm1', logicalName:'회원_번호', physicalName:'MBR_NO',
             domainId:null, description:null, origin:null },
    }
    useEditorStore.getState().setLoaded(m, 1, 'p1')
    useEditorStore.setState({
      namingRules: { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '', maxLengthBytes: 30, tablePhysicalTemplate: '' },
    })
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }))
    await userEvent.click(screen.getByRole('button', { name: /다운로드/ }))

    const [sheets] = downloadExcelWorkbook.mock.calls[0]!
    // 구분자를 끈 규칙에서는 '_' 가 단어의 일부라 미매칭 세그먼트로 남는다.
    // 규칙이 안 흘러가면(DEFAULT 로 떨어지면) '회원, 번호' 가 나온다.
    expect(sheets.find((sh) => sh.key === 'terms')!.rows[0]![1]).toBe('회원, _, 번호')
  })

  it('그룹 범위 Excel 다운로드는 그 그룹만 담고 파일명의 금지문자를 치환한다', async () => {
    // 샘플 모델은 두 테이블이 모두 g1이므로, t2를 미배정으로 돌려 범위가 실제로 좁혀지는지 본다.
    const m = buildSampleModel()
    useEditorStore.getState().setLoaded(
      {
        ...m,
        tableGroups: { g1: { ...m.tableGroups['g1']!, name: '회원/관리' } },
        tables: { ...m.tables, t2: { ...m.tables['t2']!, groupId: null } },
      }, 1, 'p1',
    )
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'Excel' }))
    await userEvent.selectOptions(screen.getByLabelText('그룹 선택'), 'g1')
    await userEvent.click(screen.getByRole('button', { name: /다운로드/ }))

    const [sheets, fileName] = downloadExcelWorkbook.mock.calls[0]!
    expect(fileName).toBe('erdd_정의서_회원_관리.xlsx')
    const rows = sheets.find((s) => s.key === 'tableList')!.rows
    expect(rows.map((r) => r[2])).toEqual(['MBR_GRD'])          // 범위 밖 t2(MBR)는 빠졌다
    expect(rows.every((r) => r[0] === '회원/관리')).toBe(true)
  })

  it('DBML 섹션에서 미리보기와 다운로드 이름을 낸다', async () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: 'DBML' }))
    expect(screen.getByLabelText('DBML 미리보기').textContent).toContain('Table "MBR"')
  })
})

/**
 * 범위는 **열릴 때만** 현재 그룹 뷰에 맞춘다. 제어형 전환에서 `onOpenChange` 가 부모 것이 되며
 * 이 부수 효과가 `useEffect` 로 옮겨졌는데, 의존성에 `activeGroupView` 를 넣으면 **열려 있는 동안**
 * 그룹 뷰가 바뀔 때도 범위가 재설정되어 사용자가 고른 범위를 덮는다. 아래 둘째 케이스가 그 회귀를
 * 잠근다.
 */
describe('ExportDialog — 범위 초기화', () => {
  const scopeSelect = () => screen.getByLabelText('그룹 선택') as HTMLSelectElement

  it('그룹 뷰가 활성인 상태에서 열면 범위가 그 그룹으로 잡힌다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    useEditorStore.getState().enterGroupView('g1')
    renderDialog()

    expect(scopeSelect().value).toBe('g1')
  })

  it('열어 둔 채 그룹 뷰가 바뀌어도 범위는 그대로다', () => {
    useEditorStore.getState().setLoaded(buildSampleModel(), 1, 'p1')
    renderDialog()
    expect(scopeSelect().value).toBe('')                      // 전체 뷰에서 열었다

    act(() => { useEditorStore.getState().enterGroupView('g1') })

    expect(scopeSelect().value).toBe('')
  })
})
