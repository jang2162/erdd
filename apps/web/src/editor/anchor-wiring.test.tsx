import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import { createEmptyModel, type Column, type ProjectModel, type Table } from '@erdd/core'
import { buildAnchors } from './anchors.js'
import { buildEdges } from './edges.js'
import { buildNodes } from './nodes.js'
import { buildGhostNodes } from './ghost-nodes.js'
import { TableNode } from './table-node.js'
import { GhostNode } from './ghost-node.js'

afterEach(() => { cleanup() })

function tbl(id: string, x: number, groupId: string | null): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId,
    position: { x, y: 0 }, groupPosition: null, custom: {} }
}
function col(id: string, tableId: string, order: number): Column {
  return { id, tableId, logicalName: id, physicalName: id, type: 'INT',
    isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
    order, comment: null, domainId: null, custom: {} }
}

/**
 * 첨부 이미지의 4테이블 모델을 축약한 것. 단일 FK · 복합 FK · 빈 매핑 관계 · 그룹 경계를
 * 넘는 관계(고스트)를 전부 담는다.
 */
function fixture(): ProjectModel {
  const m = createEmptyModel()
  m.tableGroups['g1'] = { id: 'g1', name: '주문', color: '#4A90D9', comment: null }
  m.tables['orders'] = tbl('orders', 0, 'g1')
  m.tables['products'] = tbl('products', 0, null)      // 그룹 밖 → 고스트로 나온다
  m.tables['items'] = tbl('items', 400, 'g1')
  m.tables['options'] = tbl('options', 800, 'g1')
  m.columns['o_id'] = col('o_id', 'orders', 0)
  m.columns['p_id'] = col('p_id', 'products', 0)
  m.columns['i_o'] = col('i_o', 'items', 0)
  m.columns['i_p'] = col('i_p', 'items', 1)
  m.columns['x_o'] = col('x_o', 'options', 1)
  m.columns['x_p'] = col('x_p', 'options', 2)
  m.relationships['r_o'] = { id: 'r_o', parentTableId: 'orders', childTableId: 'items',
    columnMappings: [{ childColumnId: 'i_o', parentColumnId: 'o_id' }],
    cardinality: '1:N', identifying: false, name: null }
  m.relationships['r_p'] = { id: 'r_p', parentTableId: 'products', childTableId: 'items',
    columnMappings: [{ childColumnId: 'i_p', parentColumnId: 'p_id' }],
    cardinality: '1:N', identifying: false, name: null }
  m.relationships['r_x'] = { id: 'r_x', parentTableId: 'items', childTableId: 'options',
    columnMappings: [
      { childColumnId: 'x_o', parentColumnId: 'i_o' },
      { childColumnId: 'x_p', parentColumnId: 'i_p' },
    ],
    cardinality: '1:N', identifying: false, name: null }
  m.tables['orphan'] = tbl('orphan', 1200, 'g1')
  m.relationships['r_empty'] = { id: 'r_empty', parentTableId: 'orders', childTableId: 'orphan',
    columnMappings: [], cardinality: '1:N', identifying: false, name: null }
  return m
}

/** 노드 하나를 렌더해 DOM 에 실제로 나온 handle id 를 모은다. */
function renderedHandleIds(element: ReactElement): string[] {
  const { container, unmount } = render(<ReactFlowProvider>{element}</ReactFlowProvider>)
  const ids = [...container.querySelectorAll('[data-handleid]')]
    .map((el) => el.getAttribute('data-handleid')!)
  unmount()
  return ids
}

describe('앵커 배선 교차 검증', () => {
  it('전체 뷰: buildEdges 가 가리키는 핸들은 전부 실제로 렌더된다', () => {
    const m = fixture()
    const anchors = buildAnchors(m)
    const wanted = buildEdges(m, undefined, undefined, anchors)
      .flatMap((e) => [e.sourceHandle, e.targetHandle])
      .filter((h): h is string => typeof h === 'string')
    expect(wanted.length).toBeGreaterThan(0)

    const rendered = new Set<string>()
    for (const node of buildNodes(m, 'physical', new Set<string>(), [], undefined, undefined, {}, anchors)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const id of renderedHandleIds(<TableNode data={node.data as any} />)) rendered.add(id)
    }
    for (const h of wanted) expect([...rendered]).toContain(h)
  })

  it('그룹 뷰: 고스트로 가는 엣지의 핸들도 전부 실제로 렌더된다', () => {
    const m = fixture()
    const anchors = buildAnchors(m)
    const ghosts = buildGhostNodes(m, 'g1', anchors)
    expect(ghosts.length).toBeGreaterThan(0) // products 가 고스트로 나와야 한다
    const visible = new Set([
      ...Object.values(m.tables).filter((t) => t.groupId === 'g1').map((t) => t.id),
      ...ghosts.map((g) => g.data.table.id),
    ])
    const wanted = buildEdges(m, visible, undefined, anchors)
      .flatMap((e) => [e.sourceHandle, e.targetHandle])
      .filter((h): h is string => typeof h === 'string')

    const rendered = new Set<string>()
    for (const node of buildNodes(m, 'physical', new Set<string>(), [],
      { kind: 'group', groupId: 'g1' }, undefined, {}, anchors)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const id of renderedHandleIds(<TableNode data={node.data as any} />)) rendered.add(id)
    }
    for (const g of ghosts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const id of renderedHandleIds(<GhostNode {...({ data: g.data } as any)} />)) rendered.add(id)
    }
    for (const h of wanted) expect([...rendered]).toContain(h)
  })
})
