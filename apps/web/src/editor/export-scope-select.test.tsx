import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ExportScope, ProjectModel } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'
import { ExportScopeSelect } from './export-scope-select.js'

afterEach(() => { cleanup(); useEditorStore.getState().reset() })

function loadWithGroups() {
  const m = buildSampleModel()
  const withTwo: ProjectModel = {
    ...m,
    tableGroups: {
      ...m.tableGroups,
      g2: { id: 'g2', name: '주문관리', color: '#E58F65', comment: null },
    },
  }
  useEditorStore.getState().setLoaded(withTwo, 1, 'p1')
}

describe('ExportScopeSelect', () => {
  it('그룹을 고르면 group 범위를 낸다', async () => {
    loadWithGroups()
    const onChange = vi.fn()
    render(<ExportScopeSelect value={{ kind: 'all' }} onChange={onChange} />)
    await userEvent.selectOptions(screen.getByLabelText('그룹 선택'), 'g2')
    expect(onChange).toHaveBeenCalledWith({ kind: 'group', groupId: 'g2' })
  })

  it('전체 버튼을 누르면 all 범위를 낸다', async () => {
    loadWithGroups()
    const onChange = vi.fn()
    const value: ExportScope = { kind: 'group', groupId: 'g1' }
    render(<ExportScopeSelect value={value} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: '전체' }))
    expect(onChange).toHaveBeenCalledWith({ kind: 'all' })
  })

  it('현재 group 범위가 드롭다운에 선택되어 보인다', () => {
    loadWithGroups()
    render(<ExportScopeSelect value={{ kind: 'group', groupId: 'g2' }} onChange={vi.fn()} />)
    expect(screen.getByLabelText<HTMLSelectElement>('그룹 선택').value).toBe('g2')
  })

  it('그룹이 하나도 없으면 드롭다운을 그리지 않는다', () => {
    useEditorStore.getState().setLoaded({ ...buildSampleModel(), tableGroups: {} }, 1, 'p1')
    render(<ExportScopeSelect value={{ kind: 'all' }} onChange={vi.fn()} />)
    expect(screen.queryByLabelText('그룹 선택')).not.toBeInTheDocument()
  })
})
