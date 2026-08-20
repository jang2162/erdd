import { describe, expect, it } from 'vitest'
import { applyLayout, layoutFromModel, type LayoutData } from './layout.js'
import { createEmptyModel, type ProjectModel, type Table } from './model.js'
import { LOCAL_PROJECT_ID } from './local.js'

function tbl(id: string, physicalName: string, over: Partial<Table> = {}): Table {
  return {
    id, logicalName: id, physicalName, comment: null, groupId: null,
    position: { x: 0, y: 0 }, groupPosition: null, custom: {}, ...over,
  }
}

function model(): ProjectModel {
  const m = createEmptyModel()
  m.tables['t2'] = tbl('t2', 'ORD', { position: { x: 300, y: 40 }, groupPosition: { x: 12, y: 34 } })
  m.tables['t1'] = tbl('t1', 'MBR', { position: { x: 100, y: 20 } })
  m.notes['n1'] = { id: 'n1', content: '정산 배치는 매일 02:00', position: { x: 400, y: 200 }, color: '#fde68a' }
  return m
}

describe('layoutFromModel', () => {
  it('테이블 좌표와 메모를 모은다', () => {
    const layout = layoutFromModel(model())
    expect(layout.tables).toEqual([
      { id: 't1', name: 'MBR', position: { x: 100, y: 20 }, groupPosition: null },
      { id: 't2', name: 'ORD', position: { x: 300, y: 40 }, groupPosition: { x: 12, y: 34 } },
    ])
    expect(layout.notes).toEqual([
      { id: 'n1', content: '정산 배치는 매일 02:00', position: { x: 400, y: 200 }, color: '#fde68a' },
    ])
  })

  // 정렬이 흔들리면 아무것도 안 바꿔도 git diff 가 뜬다.
  it('물리명 오름차순으로 정렬해 diff 를 안정시킨다', () => {
    const m = createEmptyModel()
    m.tables['z'] = tbl('z', 'AAA')
    m.tables['a'] = tbl('a', 'ZZZ')
    expect(layoutFromModel(m).tables.map((t) => t.name)).toEqual(['AAA', 'ZZZ'])
  })

  it('물리명이 같으면 id 로 갈라 결정적으로 정렬한다', () => {
    const m = createEmptyModel()
    m.tables['b'] = tbl('b', 'SAME')
    m.tables['a'] = tbl('a', 'SAME')
    expect(layoutFromModel(m).tables.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('applyLayout', () => {
  it('좌표와 메모를 모델에 되꽂는다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = tbl('t1', 'MBR')
    const layout: LayoutData = {
      tables: [{ id: 't1', name: 'MBR', position: { x: 7, y: 8 }, groupPosition: { x: 1, y: 2 } }],
      notes: [{ id: 'n9', content: '메모', position: { x: 5, y: 6 }, color: '#fff' }],
    }
    const next = applyLayout(m, layout)
    expect(next.tables['t1']!.position).toEqual({ x: 7, y: 8 })
    expect(next.tables['t1']!.groupPosition).toEqual({ x: 1, y: 2 })
    expect(next.notes['n9']).toEqual(layout.notes[0])
  })

  // 테이블이 지워진 뒤 layout 에 남은 잔재.
  it('모델에 없는 테이블 항목은 버린다', () => {
    const m = createEmptyModel()
    const next = applyLayout(m, {
      tables: [{ id: 'gone', name: 'GONE', position: { x: 1, y: 1 }, groupPosition: null }],
      notes: [],
    })
    expect(next.tables).toEqual({})
  })

  // filesToModel 이 전부 (0,0) 을 주므로, 이게 없으면 pull 직후 모든 테이블이 한 점에 겹친다.
  it('layout 에 없는 테이블은 서로 겹치지 않게 놓는다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = tbl('t1', 'AAA')
    m.tables['t2'] = tbl('t2', 'BBB')
    const next = applyLayout(m, { tables: [], notes: [] })
    expect(next.tables['t1']!.position).not.toEqual(next.tables['t2']!.position)
  })

  it('배치가 결정적이다 — 두 번 불러도 같다', () => {
    const m = createEmptyModel()
    m.tables['z'] = tbl('z', 'AAA')
    m.tables['a'] = tbl('a', 'ZZZ')
    const once = applyLayout(m, { tables: [], notes: [] })
    const twice = applyLayout(m, { tables: [], notes: [] })
    expect(once.tables['z']!.position).toEqual(twice.tables['z']!.position)
    expect(once.tables['a']!.position).toEqual(twice.tables['a']!.position)
  })

  it('layout 에 있는 테이블은 덮어쓰지 않고, 없는 것은 그 아래에 놓는다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = tbl('t1', 'AAA')
    m.tables['t2'] = tbl('t2', 'BBB')
    const next = applyLayout(m, {
      tables: [{ id: 't1', name: 'AAA', position: { x: 100, y: 100 }, groupPosition: null }],
      notes: [],
    })
    expect(next.tables['t1']!.position).toEqual({ x: 100, y: 100 })
    // gridPositions 는 기존 테이블의 아래(최대 y + 간격)에서 시작한다 — 겹치지 않는다.
    expect(next.tables['t2']!.position.y).toBeGreaterThan(100)
  })

  it('입력 모델을 변형하지 않는다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = tbl('t1', 'MBR')
    applyLayout(m, { tables: [{ id: 't1', name: 'MBR', position: { x: 7, y: 8 }, groupPosition: null }], notes: [] })
    expect(m.tables['t1']!.position).toEqual({ x: 0, y: 0 })
  })
})

describe('왕복', () => {
  it('layoutFromModel → applyLayout 이 좌표·메모를 보존한다', () => {
    const m = model()
    const back = applyLayout(model(), layoutFromModel(m))
    expect(back.tables['t1']!.position).toEqual(m.tables['t1']!.position)
    expect(back.tables['t2']!.groupPosition).toEqual(m.tables['t2']!.groupPosition)
    expect(back.notes).toEqual(m.notes)
  })
})

describe('LOCAL_PROJECT_ID', () => {
  it('uuid 형식이다 — 웹 라우트와 프로시저 입력이 uuid 를 요구한다', () => {
    expect(LOCAL_PROJECT_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })
})
