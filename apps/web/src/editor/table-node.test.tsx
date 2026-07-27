import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { TableNode } from './table-node.js'

afterEach(() => {
  cleanup()
})

// TableNode는 좌/우 연결 Handle을 렌더하므로 React Flow 컨텍스트가 필요하다.
function renderNode(data: Parameters<typeof TableNode>[0]['data']) {
  return render(
    <ReactFlowProvider>
      <TableNode data={data} />
    </ReactFlowProvider>,
  )
}

const DATA = {
  table: {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  },
  columns: [
    { id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
      type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
      defaultValue: null, order: 0, comment: null, domainId: null, custom: {} },
    { id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
      type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: true,
      defaultValue: null, order: 1, comment: null, domainId: null, custom: {} },
  ],
  selected: false,
}

describe('TableNode', () => {
  it('shows physical names in physical mode', () => {
    renderNode({ ...DATA, viewMode: 'physical' })
    expect(screen.getByText('MBR')).toBeInTheDocument()
    expect(screen.getByText('MBR_NO')).toBeInTheDocument()
    expect(screen.getByText('VARCHAR(100)')).toBeInTheDocument()
  })

  it('shows logical names in logical mode', () => {
    renderNode({ ...DATA, viewMode: 'logical' })
    expect(screen.getByText('회원')).toBeInTheDocument()
    expect(screen.getByText('회원번호')).toBeInTheDocument()
  })

  it('shows both names in mixed mode and marks the PK column', () => {
    renderNode({ ...DATA, viewMode: 'mixed' })
    expect(screen.getByText('MBR')).toBeInTheDocument()
    expect(screen.getByText('회원')).toBeInTheDocument()
    // PK 컬럼은 접근성 레이블로 표시
    expect(screen.getByLabelText('기본 키')).toBeInTheDocument()
  })
})
