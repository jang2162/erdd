import { describe, expect, it } from 'vitest'
import { createEmptyModel, type Column, type ProjectModel, type Table } from '@erdd/core'
import {
  anchorSignatures, buildAnchors, changedAnchorTables, handleId,
} from './anchors.js'

function tbl(id: string): Table {
  return { id, logicalName: id, physicalName: id, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
}
function col(id: string, tableId: string, order: number): Column {
  return { id, tableId, logicalName: id, physicalName: id, type: 'VARCHAR(10)',
    isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
    order, comment: null, domainId: null, custom: {} }
}

/** 부모 P(p1, p2) · 자식 C(c1, c2). 관계는 테스트마다 따로 넣는다. */
function model(): ProjectModel {
  const m = createEmptyModel()
  m.tables['P'] = tbl('P')
  m.tables['C'] = tbl('C')
  m.columns['p1'] = col('p1', 'P', 0)
  m.columns['p2'] = col('p2', 'P', 1)
  m.columns['c1'] = col('c1', 'C', 0)
  m.columns['c2'] = col('c2', 'C', 1)
  return m
}

function withRel(m: ProjectModel, mappings: { childColumnId: string; parentColumnId: string }[]) {
  m.relationships['R'] = {
    id: 'R', parentTableId: 'P', childTableId: 'C',
    columnMappings: mappings, cardinality: '1:N', identifying: false, name: null,
  }
  return m
}

describe('buildAnchors', () => {
  it('단일 매핑은 양 끝 모두 c: 키를 낸다', () => {
    const a = buildAnchors(withRel(model(), [{ childColumnId: 'c1', parentColumnId: 'p1' }]))
    expect(a.byRelationship.get('R')).toEqual({ childKey: 'c:c1', parentKey: 'c:p1' })
    expect(a.byTable.get('C')).toEqual([{ key: 'c:c1', columnIds: ['c1'] }])
    expect(a.byTable.get('P')).toEqual([{ key: 'c:p1', columnIds: ['p1'] }])
  })

  it('복합 매핑은 s: 키를 내고 컬럼은 order 순으로 고정 정렬된다', () => {
    // 매핑 배열을 일부러 역순으로 준다 — 입력 순서가 키에 새면 안 된다.
    const a = buildAnchors(withRel(model(), [
      { childColumnId: 'c2', parentColumnId: 'p2' },
      { childColumnId: 'c1', parentColumnId: 'p1' },
    ]))
    expect(a.byRelationship.get('R')).toEqual({ childKey: 's:c1+c2', parentKey: 's:p1+p2' })
    expect(a.byTable.get('C')).toEqual([{ key: 's:c1+c2', columnIds: ['c1', 'c2'] }])
  })

  it('order가 같으면 컬럼 id 사전순으로 결정된다', () => {
    const m = model()
    m.columns['c2']!.order = 0 // c1과 동률
    const a = buildAnchors(withRel(m, [
      { childColumnId: 'c2', parentColumnId: 'p2' },
      { childColumnId: 'c1', parentColumnId: 'p1' },
    ]))
    expect(a.byRelationship.get('R')!.childKey).toBe('s:c1+c2')
  })

  it('같은 childColumnId가 두 번 담겨도 단일 앵커로 남는다', () => {
    // remapRelationshipChildColumn이 실제로 이런 매핑을 만든다.
    const a = buildAnchors(withRel(model(), [
      { childColumnId: 'c1', parentColumnId: 'p1' },
      { childColumnId: 'c1', parentColumnId: 'p2' },
    ]))
    expect(a.byRelationship.get('R')!.childKey).toBe('c:c1')
    expect(a.byRelationship.get('R')!.parentKey).toBe('s:p1+p2')
  })

  it('빈 columnMappings는 양 끝이 null이다', () => {
    const a = buildAnchors(withRel(model(), []))
    expect(a.byRelationship.get('R')).toEqual({ childKey: null, parentKey: null })
    expect(a.byTable.size).toBe(0)
  })

  it('모델에 없는 컬럼을 가리키면 그 끝만 null이다', () => {
    const a = buildAnchors(withRel(model(), [{ childColumnId: 'GONE', parentColumnId: 'p1' }]))
    expect(a.byRelationship.get('R')).toEqual({ childKey: null, parentKey: 'c:p1' })
  })

  it('매핑 컬럼이 그 관계의 테이블 소속이 아니면 걸러진다', () => {
    // c1은 C 소속인데 부모(P) 쪽 매핑에 들어왔다 — 잘못된 모델에서 엉뚱한 행에 붙지 않게 한다.
    const a = buildAnchors(withRel(model(), [{ childColumnId: 'c1', parentColumnId: 'c1' }]))
    expect(a.byRelationship.get('R')).toEqual({ childKey: 'c:c1', parentKey: null })
  })

  it('두 관계가 같은 조합을 쓰면 그 테이블의 앵커는 하나다', () => {
    const m = withRel(model(), [
      { childColumnId: 'c1', parentColumnId: 'p1' },
      { childColumnId: 'c2', parentColumnId: 'p2' },
    ])
    m.tables['C2'] = tbl('C2')
    m.relationships['R2'] = {
      id: 'R2', parentTableId: 'C', childTableId: 'C2',
      // 부모(C) 쪽이 R과 같은 조합이다.
      columnMappings: [
        { childColumnId: 'c1', parentColumnId: 'c1' },
        { childColumnId: 'c2', parentColumnId: 'c2' },
      ],
      cardinality: '1:N', identifying: false, name: null,
    }
    const a = buildAnchors(m)
    expect(a.byTable.get('C')).toHaveLength(1)
    expect(a.byTable.get('C')![0]!.key).toBe('s:c1+c2')
  })

  it('한 테이블의 앵커 목록은 단일 먼저·복합 나중으로 고정 정렬된다', () => {
    const m = withRel(model(), [
      { childColumnId: 'c1', parentColumnId: 'p1' },
      { childColumnId: 'c2', parentColumnId: 'p2' },
    ])
    m.tables['P2'] = tbl('P2')
    m.columns['q1'] = col('q1', 'P2', 0)
    m.relationships['R2'] = {
      id: 'R2', parentTableId: 'P2', childTableId: 'C',
      columnMappings: [{ childColumnId: 'c2', parentColumnId: 'q1' }],
      cardinality: '1:N', identifying: false, name: null,
    }
    const a = buildAnchors(m)
    expect(a.byTable.get('C')!.map((x) => x.key)).toEqual(['c:c2', 's:c1+c2'])
  })
})

describe('handleId', () => {
  it('키가 있으면 side:key, 없으면 side만 낸다(중앙 폴백)', () => {
    expect(handleId('l', 'c:c1')).toBe('l:c:c1')
    expect(handleId('r', 's:c1+c2')).toBe('r:s:c1+c2')
    expect(handleId('l', null)).toBe('l')
    expect(handleId('r', null)).toBe('r')
  })
})

describe('anchorSignatures / changedAnchorTables', () => {
  it('앵커가 그대로면 바뀐 테이블이 없다', () => {
    const m = withRel(model(), [{ childColumnId: 'c1', parentColumnId: 'p1' }])
    const sig = anchorSignatures(buildAnchors(m))
    expect(changedAnchorTables(sig, anchorSignatures(buildAnchors(m)))).toEqual([])
  })

  it('관계가 생기면 두 테이블이 바뀐 것으로 나온다', () => {
    const before = anchorSignatures(buildAnchors(model()))
    const after = anchorSignatures(buildAnchors(
      withRel(model(), [{ childColumnId: 'c1', parentColumnId: 'p1' }])))
    expect(changedAnchorTables(before, after).sort()).toEqual(['C', 'P'])
  })

  it('관계가 사라져 앵커가 0개가 된 테이블도 바뀐 것으로 나온다', () => {
    const before = anchorSignatures(buildAnchors(
      withRel(model(), [{ childColumnId: 'c1', parentColumnId: 'p1' }])))
    const after = anchorSignatures(buildAnchors(model()))
    expect(changedAnchorTables(before, after).sort()).toEqual(['C', 'P'])
  })
})
