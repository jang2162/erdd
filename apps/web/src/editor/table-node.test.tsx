import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

describe('peer 선택 하이라이트', () => {
  it('peer가 선택한 테이블에 참여자 이름 라벨을 그린다', () => {
    renderNode({
      ...DATA, viewMode: 'physical',
      peers: [{ userId: 'u2', name: '동료', color: '#DB2777' }],
    })
    expect(screen.getByText('동료')).toBeInTheDocument()
  })

  it('peer가 없으면 라벨을 그리지 않는다(회귀)', () => {
    renderNode({ ...DATA, viewMode: 'physical' })
    expect(screen.queryByText('동료')).not.toBeInTheDocument()
  })
})

// DATA 픽스처의 c1 = 회원번호/MBR_NO(order 0, isPk), c2 = 회원명/MBR_NM(order 1).
// 브리프 원안은 이 텍스트가 c2에 있다고 가정했지만 실제로는 c1이다 — 아래 단언은 c1로 정정했다.
describe('컬럼 클릭 → 선택', () => {
  it('컬럼을 클릭하면 replace 모드로 콜백이 불린다', async () => {
    const onColumnClick = vi.fn()
    renderNode({ ...DATA, viewMode: 'physical', onColumnClick })
    await userEvent.click(screen.getByRole('button', { name: /회원번호|MBR_NO/ }))
    expect(onColumnClick).toHaveBeenCalledWith('c1', 'replace')
  })

  it('Cmd/Ctrl+클릭은 toggle 모드다', async () => {
    // held-key 상태는 userEvent 인스턴스에 귀속된다 — 브리프처럼 최상위 userEvent.keyboard/click을
    // 따로 호출하면 각각 별도 세션이 생겨 Meta가 눌린 채로 넘어가지 않는다(실측: mode가 'replace'로
    // 관찰됨). setup()으로 만든 단일 인스턴스를 재사용하도록 정정했다.
    const user = userEvent.setup()
    const onColumnClick = vi.fn()
    renderNode({ ...DATA, viewMode: 'physical', onColumnClick })
    await user.keyboard('{Meta>}')
    await user.click(screen.getByRole('button', { name: /회원번호|MBR_NO/ }))
    await user.keyboard('{/Meta}')
    expect(onColumnClick).toHaveBeenCalledWith('c1', 'toggle')
  })

  it('Shift+클릭은 range 모드다', async () => {
    // 위와 같은 이유로 단일 userEvent 인스턴스를 재사용한다.
    const user = userEvent.setup()
    const onColumnClick = vi.fn()
    renderNode({ ...DATA, viewMode: 'physical', onColumnClick })
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: /회원번호|MBR_NO/ }))
    await user.keyboard('{/Shift}')
    expect(onColumnClick).toHaveBeenCalledWith('c1', 'range')
  })

  it('선택된 컬럼에 aria-selected가 붙는다', () => {
    renderNode({ ...DATA, viewMode: 'physical', selectedColumnIds: ['c1'] })
    const row = screen.getByRole('button', { name: /회원번호|MBR_NO/ })
    expect(row).toHaveAttribute('aria-selected', 'true')
  })

  it('선택되지 않은 컬럼에는 aria-selected가 false다', () => {
    renderNode({ ...DATA, viewMode: 'physical', selectedColumnIds: [] })
    const row = screen.getByRole('button', { name: /회원번호|MBR_NO/ })
    expect(row).toHaveAttribute('aria-selected', 'false')
  })
})
