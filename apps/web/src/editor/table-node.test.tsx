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

describe('TableNode — 앵커 핸들과 합성 행', () => {
  const handleIds = (c: HTMLElement) =>
    [...c.querySelectorAll('[data-handleid]')].map((el) => el.getAttribute('data-handleid'))

  it('단일 앵커 컬럼 행에 좌·우 핸들이 붙는다', () => {
    const { container } = renderNode({
      ...DATA, viewMode: 'physical',
      anchors: [{ key: 'c:c1', columnIds: ['c1'] }],
    })
    expect(handleIds(container)).toEqual(expect.arrayContaining(['l:c:c1', 'r:c:c1']))
  })

  it('앵커가 아닌 컬럼에는 핸들이 없다', () => {
    const { container } = renderNode({
      ...DATA, viewMode: 'physical',
      anchors: [{ key: 'c:c1', columnIds: ['c1'] }],
    })
    expect(handleIds(container)).not.toContain('l:c:c2')
  })

  it('기존 중앙 핸들은 그대로 남는다', () => {
    // 드래그 연결의 시작점이자 폴백 자리다 — 없어지면 관계를 만들 수 없다.
    const { container } = renderNode({ ...DATA, viewMode: 'physical', anchors: [] })
    expect(handleIds(container)).toEqual(expect.arrayContaining(['l', 'r']))
  })

  it('복합 앵커는 컬럼 목록 맨 아래에 합성 행으로 렌더된다', () => {
    const { container } = renderNode({
      ...DATA, viewMode: 'physical',
      anchors: [{ key: 's:c1+c2', columnIds: ['c1', 'c2'] }],
    })
    expect(screen.getByText('(MBR_NO, MBR_NM)')).toBeInTheDocument()
    expect(handleIds(container)).toEqual(expect.arrayContaining(['l:s:c1+c2', 'r:s:c1+c2']))
    // 맨 아래여야 한다 — 컬럼 행보다 뒤에 온다.
    const items = [...container.querySelectorAll('li')].map((el) => el.textContent ?? '')
    expect(items.at(-1)).toContain('(MBR_NO, MBR_NM)')
  })

  it('합성 행 라벨은 논리 모드에서 논리명을 쓴다', () => {
    renderNode({
      ...DATA, viewMode: 'logical',
      anchors: [{ key: 's:c1+c2', columnIds: ['c1', 'c2'] }],
    })
    expect(screen.getByText('(회원번호, 회원명)')).toBeInTheDocument()
  })

  it('혼합 모드에서 합성 행은 물리명만 쓴다', () => {
    // 컬럼 2~3개의 논리명·물리명을 한 줄에 다 넣으면 노드가 과하게 넓어진다(설계 D-4).
    renderNode({
      ...DATA, viewMode: 'mixed',
      anchors: [{ key: 's:c1+c2', columnIds: ['c1', 'c2'] }],
    })
    expect(screen.getByText('(MBR_NO, MBR_NM)')).toBeInTheDocument()
    expect(screen.queryByText('(회원번호, 회원명)')).not.toBeInTheDocument()
  })

  it('합성 행을 클릭해도 컬럼 선택이 일어나지 않는다', async () => {
    const onColumnClick = vi.fn()
    renderNode({
      ...DATA, viewMode: 'physical', onColumnClick,
      anchors: [{ key: 's:c1+c2', columnIds: ['c1', 'c2'] }],
    })
    await userEvent.click(screen.getByText('(MBR_NO, MBR_NM)'))
    expect(onColumnClick).not.toHaveBeenCalled()
  })

  it('앵커를 주지 않아도 렌더된다', () => {
    // anchors 는 optional 이다 — 이 컴포넌트를 직접 렌더하는 기존 테스트들이 깨지면 안 된다.
    const { container } = renderNode({ ...DATA, viewMode: 'physical' })
    expect(handleIds(container)).toEqual(['l', 'r'])
  })
})
