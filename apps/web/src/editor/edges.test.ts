import { describe, expect, it } from 'vitest'
import { buildEdges, planConnection, planJunction } from './edges.js'
import type { NamingRules, ProjectModel } from '@erdd/core'
import { createEmptyModel, deleteGroup } from '@erdd/core'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { nextTablePhysicalName } from './model-edits.js'

function model(): ProjectModel {
  const m = createEmptyModel()
  m.tables['P'] = { id: 'P', logicalName: 'P', physicalName: 'P', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
  m.tables['C'] = { id: 'C', logicalName: 'C', physicalName: 'C', comment: null, groupId: null, position: { x: 400, y: 0 }, groupPosition: null, custom: {} }
  m.relationships['R'] = { id: 'R', parentTableId: 'P', childTableId: 'C', columnMappings: [], cardinality: '1:N', identifying: false, name: null }
  return m
}

describe('buildEdges', () => {
  it('관계마다 엣지를 만들고 id는 관계 id다', () => {
    const edges = buildEdges(model())
    expect(edges).toHaveLength(1)
    expect(edges[0]!.id).toBe('R')
    expect(edges[0]!.type).toBe('relationship')
  })
  it('source=자식, target=부모', () => {
    const edges = buildEdges(model())
    expect(edges[0]!.source).toBe('C')
    expect(edges[0]!.target).toBe('P')
  })
  it('엣지 data에 카디널리티·식별 여부를 담는다', () => {
    const edges = buildEdges(model())
    expect(edges[0]!.data).toMatchObject({ cardinality: '1:N', identifying: false })
  })

  it('단일 FK 는 양 끝 모두 컬럼 앵커 핸들에 붙는다', () => {
    const m = model()
    m.columns['pc'] = { id: 'pc', tableId: 'P', logicalName: 'pc', physicalName: 'pc',
      type: 'INT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {} }
    m.columns['cc'] = { id: 'cc', tableId: 'C', logicalName: 'cc', physicalName: 'cc',
      type: 'INT', isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {} }
    m.relationships['R']!.columnMappings = [{ childColumnId: 'cc', parentColumnId: 'pc' }]
    const e = buildEdges(m)[0]!
    // 자식 C(x=400)가 부모 P(x=0)보다 오른쪽 → 자식은 왼쪽, 부모는 오른쪽.
    expect(e.sourceHandle).toBe('l:c:cc')
    expect(e.targetHandle).toBe('r:c:pc')
  })

  it('복합 FK 는 양 끝 모두 합성 앵커 핸들에 붙는다', () => {
    const m = model()
    for (const [id, tableId, order] of [
      ['p1', 'P', 0], ['p2', 'P', 1], ['c1', 'C', 0], ['c2', 'C', 1],
    ] as const) {
      m.columns[id] = { id, tableId, logicalName: id, physicalName: id, type: 'INT',
        isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
        order, comment: null, domainId: null, custom: {} }
    }
    m.relationships['R']!.columnMappings = [
      { childColumnId: 'c1', parentColumnId: 'p1' },
      { childColumnId: 'c2', parentColumnId: 'p2' },
    ]
    const e = buildEdges(m)[0]!
    expect(e.sourceHandle).toBe('l:s:c1+c2')
    expect(e.targetHandle).toBe('r:s:p1+p2')
  })

  it('빈 매핑 관계는 양 끝 모두 중앙 핸들로 폴백한다', () => {
    // DDL/DBML 가져오기가 이런 관계를 만든다 — 예외가 아니라 정상 경로다(설계 3.5).
    const e = buildEdges(model())[0]!
    expect(e.sourceHandle).toBe('l')
    expect(e.targetHandle).toBe('r')
  })

  it('한쪽 매핑만 깨졌으면 그 끝만 중앙으로 폴백한다', () => {
    const m = model()
    m.columns['pc'] = { id: 'pc', tableId: 'P', logicalName: 'pc', physicalName: 'pc',
      type: 'INT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {} }
    m.relationships['R']!.columnMappings = [{ childColumnId: 'GONE', parentColumnId: 'pc' }]
    const e = buildEdges(m)[0]!
    expect(e.sourceHandle).toBe('l')          // 자식 끝만 폴백
    expect(e.targetHandle).toBe('r:c:pc')     // 부모 끝은 앵커
  })

  it('부모가 자식보다 오른쪽이면 좌우가 뒤집힌다', () => {
    const m = model()
    m.tables['P']!.position = { x: 800, y: 0 } // 부모를 오른쪽으로
    m.columns['pc'] = { id: 'pc', tableId: 'P', logicalName: 'pc', physicalName: 'pc',
      type: 'INT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {} }
    m.columns['cc'] = { id: 'cc', tableId: 'C', logicalName: 'cc', physicalName: 'cc',
      type: 'INT', isPk: false, autoIncrement: false, nullable: true, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {} }
    m.relationships['R']!.columnMappings = [{ childColumnId: 'cc', parentColumnId: 'pc' }]
    const e = buildEdges(m)[0]!
    expect(e.sourceHandle).toBe('r:c:cc')
    expect(e.targetHandle).toBe('l:c:pc')
  })
})

describe('buildEdges 핸들 휴리스틱', () => {
  it('자식이 부모 오른쪽이면 source=l,target=r', () => {
    const edges = buildEdges(model()) // model(): C.x(400) >= P.x(0)
    expect(edges[0]!.sourceHandle).toBe('l')
    expect(edges[0]!.targetHandle).toBe('r')
  })
  it('참조 테이블이 없어도 throw하지 않는다', () => {
    const m = createEmptyModel()
    m.relationships['R'] = { id: 'R', parentTableId: 'GONE', childTableId: 'ALSO_GONE', columnMappings: [], cardinality: '1:N', identifying: false, name: null }
    expect(() => buildEdges(m)).not.toThrow()
    expect(buildEdges(m)).toHaveLength(1)
  })
  it('visibleTableIds가 주어지면 양 끝이 모두 포함된 엣지만 반환한다', () => {
    const m = model() // P(부모)·C(자식) 관계 R 하나
    expect(buildEdges(m, new Set(['P', 'C']))).toHaveLength(1)
    expect(buildEdges(m, new Set(['C']))).toHaveLength(0)     // 부모 미포함 → 제외
    expect(buildEdges(m, new Set())).toHaveLength(0)
  })
})

describe('planConnection', () => {
  const gen = () => { let n = 0; return () => `id${++n}` }
  it('source=자식, target=부모로 매핑하고 부모 PK 수만큼 컬럼 id를 만든다', () => {
    const m = model() // P(부모)·C(자식). model()의 P에는 기본적으로 PK 컬럼이 없으므로 여기서 추가.
    m.columns['PPK'] = { id: 'PPK', tableId: 'P', logicalName: 'PPK', physicalName: 'ID', type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0, comment: null, domainId: null, custom: {} }
    const plan = planConnection(m, { source: 'C', target: 'P' }, gen())
    expect(plan.ok).toBe(true)
    if (plan.ok) {
      expect(plan.parentTableId).toBe('P')
      expect(plan.childTableId).toBe('C')
      expect(plan.newColumnIds).toHaveLength(1)
    }
  })
  it('자기 연결은 거부한다', () => {
    expect(planConnection(model(), { source: 'A', target: 'A' }, gen())).toEqual({ ok: false, reason: 'self' })
  })
  it('source/target 누락은 invalid', () => {
    expect(planConnection(model(), { source: null, target: 'P' }, gen())).toEqual({ ok: false, reason: 'invalid' })
  })
  it('부모 PK가 없으면 no-parent-pk', () => {
    const plan = planConnection(model(), { source: 'C', target: 'P' }, gen()) // model()의 P에 PK 없음
    expect(plan).toEqual({ ok: false, reason: 'no-parent-pk' })
  })
  it('복합 PK면 컬럼 id를 그 수만큼 만든다', () => {
    const m = model()
    m.columns['PPK1'] = { id: 'PPK1', tableId: 'P', logicalName: 'a', physicalName: 'A', type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0, comment: null, domainId: null, custom: {} }
    m.columns['PPK2'] = { id: 'PPK2', tableId: 'P', logicalName: 'b', physicalName: 'B', type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 1, comment: null, domainId: null, custom: {} }
    const plan = planConnection(m, { source: 'C', target: 'P' }, gen())
    if (plan.ok) expect(plan.newColumnIds).toHaveLength(2)
    else throw new Error('expected ok')
  })
})

describe('nextTablePhysicalName', () => {
  it('사용 중이지 않은 가장 작은 TABLE_n 을 준다', () => {
    const m = buildSampleModel()
    expect(nextTablePhysicalName(m)).toBe('TABLE_1')
  })

  it('이미 쓰이는 번호를 건너뛴다', () => {
    const base = buildSampleModel()
    const m = { ...base, tables: {
      ...base.tables,
      x1: { ...base.tables['t1']!, id: 'x1', physicalName: 'TABLE_1' },
      x2: { ...base.tables['t1']!, id: 'x2', physicalName: 'TABLE_2' },
    } }
    expect(nextTablePhysicalName(m)).toBe('TABLE_3')
  })
})

const RULES: NamingRules = { case: 'UPPER_SNAKE', separator: '_', logicalSeparator: '_', maxLengthBytes: 30 }
const CTX = { namingRules: RULES, activeGroupView: null }

/**
 * buildSampleModel 에 배송 t3 를 더한 3단 모델 — r1 의 FK c4 가 자식 PK 이면서
 * 하위 관계 r2 의 부모 컬럼이다(회원등급 →(1:N) 회원 →(1:N) 배송).
 */
function buildSampleModelWithDownstream(): ProjectModel {
  const base = buildSampleModel()
  return {
    ...base,
    tables: { ...base.tables,
      t3: { ...base.tables['t2']!, id: 't3', logicalName: '배송', physicalName: 'DLV' } },
    columns: { ...base.columns,
      c4: { ...base.columns['c4']!, isPk: true },
      c5: { ...base.columns['c2']!, id: 'c5', tableId: 't3', isPk: false, autoIncrement: false },
      c6: { ...base.columns['c4']!, id: 'c6', tableId: 't3', isPk: false, order: 1 } },
    relationships: { ...base.relationships,
      r2: { id: 'r2', parentTableId: 't2', childTableId: 't3', cardinality: '1:N',
            identifying: false, name: null,
            columnMappings: [{ childColumnId: 'c5', parentColumnId: 'c2' },
                             { childColumnId: 'c6', parentColumnId: 'c4' }] } },
  }
}

describe('planJunction', () => {
  function ids() {
    let n = 0
    return () => `gen${++n}`
  }

  it('사전이 비어 있으면 물리명이 TABLE_n 으로 떨어진다', () => {
    const plan = planJunction(buildSampleModel(), 'r1', ids(), CTX)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.junction.logicalName).toBe('회원등급회원')
    expect(plan.junction.physicalName).toBe('TABLE_1')
  })

  it('용어 사전에 완전일치가 있으면 그 물리명을 쓴다', () => {
    const base = buildSampleModel()
    const m = { ...base, terms: {
      tm1: { id: 'tm1', logicalName: '회원등급회원', physicalName: 'MBR_GRD_MBR',
             domainId: null, description: null, origin: null },
    } }
    const plan = planJunction(m, 'r1', ids(), CTX)
    expect(plan.ok && plan.junction.physicalName).toBe('MBR_GRD_MBR')
  })

  it('단어 사전이 일부만 알면 아는 부분으로 물리명을 만든다', () => {
    const base = buildSampleModel()
    const m = { ...base, words: {
      w1: { id: 'w1', logicalName: '회원', abbreviation: 'MBR',
            englishName: null, description: null, origin: null },
    } }
    const plan = planJunction(m, 'r1', ids(), CTX)
    // '회원등급회원' 을 최장일치로 분해하면 회원(MBR) · 등급(모름) · 회원(MBR) 이라
    // 아는 것만 이어 붙는다. '등급' 은 기존 미등록 단어 경고가 따로 알린다.
    expect(plan.ok && plan.junction.physicalName).toBe('MBR_MBR')
  })

  it('두 부모의 중점에 놓는다', () => {
    const plan = planJunction(buildSampleModel(), 'r1', ids(), CTX)
    // t1 (0,0) 과 t2 (300,0) 의 중점
    expect(plan.ok && plan.junction.position).toEqual({ x: 150, y: 0 })
  })

  it('부모 PK 개수만큼 FK 컬럼 id 를 발급한다', () => {
    const plan = planJunction(buildSampleModel(), 'r1', ids(), CTX)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.a.newColumnIds).toHaveLength(1) // t1 의 PK 는 c1 하나
    expect(plan.b.newColumnIds).toHaveLength(1) // t2 의 PK 는 c2 하나
    const all = [plan.junction.id, plan.a.relationshipId, plan.b.relationshipId,
                 ...plan.a.newColumnIds, ...plan.b.newColumnIds]
    expect(new Set(all).size).toBe(all.length) // 모두 서로 다르다
  })

  it('자식 PK 가 2개이고 그중 1개가 FK 면 삭제 뒤 남는 수만큼만 발급한다', () => {
    // FK c4 를 PK 로 → t2 의 PK 는 c2·c4 둘. 그중 c4 는 교차 테이블 변환에서 삭제되므로
    // 자식이 교차 테이블에 넘길 PK 는 c2 하나뿐이다. 삭제 '전' 개수로 세면 2개가 나오는데,
    // createRelationshipFromParentPk 는 남는 id 를 조용히 버려 다른 곳에서는 드러나지 않는다.
    const base = buildSampleModel()
    const m = { ...base, columns: {
      ...base.columns, c4: { ...base.columns['c4']!, isPk: true },
    } }
    const plan = planJunction(m, 'r1', ids(), CTX)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.b.newColumnIds).toHaveLength(1)
  })

  it('활성 그룹뷰가 있으면 교차 테이블을 그 그룹에 넣는다', () => {
    const plan = planJunction(buildSampleModel(), 'r1', ids(),
      { namingRules: RULES, activeGroupView: 'g1' })
    expect(plan.ok && plan.junction.groupId).toBe('g1')
    // t1 groupPosition (10,10), t2 (310,10) 의 중점
    expect(plan.ok && plan.junction.groupPosition).toEqual({ x: 160, y: 10 })
  })

  it('활성 그룹뷰가 이미 삭제된 그룹이면 그룹에 넣지 않는다', () => {
    // 원격 resync 는 activeGroupView 를 유지하므로 협업자가 그룹을 지우면 죽은 id 가 남는다.
    // 그 id 를 그대로 쓰면 '존재하지 않는 그룹 참조' 무결성 위반이 되어 mutation 이 거부된다 —
    // 버튼은 활성인데 누르면 에러가 되므로 core 의 setTableGroup 처럼 미배정으로 떨군다.
    const m = deleteGroup(buildSampleModel(), 'g1')
    const plan = planJunction(m, 'r1', ids(), { namingRules: RULES, activeGroupView: 'g1' })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.junction.groupId).toBeNull()
    expect(plan.junction.groupPosition).toBeNull()
  })

  it('부모 PK 가 2개면 a 쪽 FK 컬럼 id 를 2개 발급한다', () => {
    // b 와 대칭인 단언이다. a 를 과소 발급하면 createRelationshipFromParentPk 가
    // 'FK 컬럼 id가 부족합니다' 로 throw 한다 — b 의 과다 발급(조용히 무시)보다 나쁘다.
    const base = buildSampleModel()
    const m = { ...base, columns: {
      ...base.columns,
      c5: { ...base.columns['c1']!, id: 'c5', logicalName: '등급명', physicalName: 'GRD_NM', order: 1 },
    } }
    const plan = planJunction(m, 'r1', ids(), CTX)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.a.newColumnIds).toHaveLength(2) // t1 의 PK 는 c1·c5 둘
  })

  it('부모에 PK 가 없으면 no-pk 다', () => {
    const base = buildSampleModel()
    // t1 의 PK c1 을 비-PK 로 → 교차 테이블에 넘겨줄 PK 가 없다.
    // 가드가 없으면 core 가 모델을 그대로 돌려줘 diff 0건 → 토스트조차 없이 아무 일도 없다.
    const m = { ...base, columns: {
      ...base.columns, c1: { ...base.columns['c1']!, isPk: false },
    } }
    expect(planJunction(m, 'r1', ids(), CTX)).toEqual({ ok: false, reason: 'no-pk' })
  })

  it('없는 관계는 missing 이다', () => {
    expect(planJunction(buildSampleModel(), 'nope', ids(), CTX))
      .toEqual({ ok: false, reason: 'missing' })
  })

  it('식별 관계는 identifying 이다', () => {
    const base = buildSampleModel()
    const m = { ...base, relationships: {
      ...base.relationships, r1: { ...base.relationships['r1']!, identifying: true },
    } }
    expect(planJunction(m, 'r1', ids(), CTX)).toEqual({ ok: false, reason: 'identifying' })
  })

  it('FK 가 자식의 유일한 PK면 no-pk 다', () => {
    const base = buildSampleModel()
    // t2 의 PK c2 를 비-PK 로, FK c4 를 PK 로 → 지우면 t2 의 PK 가 0개가 된다
    const m = { ...base, columns: {
      ...base.columns,
      c2: { ...base.columns['c2']!, isPk: false },
      c4: { ...base.columns['c4']!, isPk: true },
    } }
    expect(planJunction(m, 'r1', ids(), CTX)).toEqual({ ok: false, reason: 'no-pk' })
  })

  // 매핑은 같은 childColumnId 를 두 번 담을 수 있다 — 공개 함수 remapRelationshipChildColumn 이
  // 그렇게 만들고, 관계 패널의 매핑 select 도 이미 매핑된 컬럼을 제외하지 않는다.
  it('매핑이 중복돼도 FK 가 자식의 유일한 PK면 no-pk 다', () => {
    const base = buildSampleModel()
    const m = {
      ...base,
      columns: {
        ...base.columns,
        c2: { ...base.columns['c2']!, isPk: false },
        c4: { ...base.columns['c4']!, isPk: true },
      },
      relationships: {
        ...base.relationships,
        r1: { ...base.relationships['r1']!, columnMappings: [
          { childColumnId: 'c4', parentColumnId: 'c1' },
          { childColumnId: 'c4', parentColumnId: 'c1' },
        ] },
      },
    }
    // 중복을 세면 droppedPk 가 2가 되어 1 - 2 = -1 이 되고, '=== 0' 비교를 빠져나가
    // ok:true 를 준다. 그러면 버튼은 활성인데 core 가 no-op 이라 눌러도 아무 일이 없다.
    expect(planJunction(m, 'r1', ids(), CTX)).toEqual({ ok: false, reason: 'no-pk' })
  })

  it('중복 매핑을 한 번만 센다 — 남는 PK 가 있으면 계획을 만든다', () => {
    const base = buildSampleModel()
    // t2 의 PK 는 c2·c4 둘. 삭제되는 FK 는 c4 하나뿐인데 매핑에 두 번 담겼다.
    const m = {
      ...base,
      columns: { ...base.columns, c4: { ...base.columns['c4']!, isPk: true } },
      relationships: {
        ...base.relationships,
        r1: { ...base.relationships['r1']!, columnMappings: [
          { childColumnId: 'c4', parentColumnId: 'c1' },
          { childColumnId: 'c4', parentColumnId: 'c1' },
        ] },
      },
    }
    // 중복을 세면 2 - 2 = 0 이 되어 있지도 않은 no-pk 로 막는다(dedup 단독 구분력).
    const plan = planJunction(m, 'r1', ids(), CTX)
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.b.newColumnIds).toHaveLength(1)
  })

  it('삭제량이 자식 PK 수를 넘어도 no-pk 로 막는다', () => {
    // 매핑이 자식 밖 컬럼(c1 = 부모 t1 의 PK)을 가리키는 무결성 위반 모델이다 —
    // remapRelationshipChildColumn 이 자식 테이블 밖 컬럼을 거부하므로 공개 함수로는
    // 도달할 수 없다. dedup 으로는 막지 못하는(중복이 없다) 경우라 '<= 0' 이중 방어를
    // 단독으로 잠근다: '=== 0' 이면 1 - 2 = -1 이 비교를 빠져나가 ok:true 가 된다.
    const base = buildSampleModel()
    const m = { ...base, relationships: {
      ...base.relationships,
      r1: { ...base.relationships['r1']!, columnMappings: [
        { childColumnId: 'c1', parentColumnId: 'c1' },
        { childColumnId: 'c2', parentColumnId: 'c1' },
      ] },
    } }
    expect(planJunction(m, 'r1', ids(), CTX)).toEqual({ ok: false, reason: 'no-pk' })
  })

  it('지울 FK 컬럼을 부모로 삼는 다른 관계가 있으면 downstream 이다', () => {
    // r1 은 identifying:false 인데 FK c4 의 isPk 만 true 인 불일치 상태다 — 편집 패널의 PK
    // 체크박스나 DDL 역설계로 도달한다. c4 를 지우면 그것을 부모로 삼는 r2 의 매핑이 조용히
    // 사라지고 t3 에 고아 FK 컬럼이 남는데, 무결성 검사도 경고도 그것을 잡지 못한다.
    const m = buildSampleModelWithDownstream()
    expect(m.relationships['r1']?.identifying).toBe(false) // identifying 가드에 먼저 걸리지 않는다
    expect(planJunction(m, 'r1', ids(), CTX)).toEqual({ ok: false, reason: 'downstream' })
  })

  it('그룹뷰 소속인데 groupPosition 이 없는 부모는 position 으로 대신 센다', () => {
    // toolbar.tsx 의 addTable + setTableGroup 조합이 만드는 상태다 — setTableGroup 은
    // groupPosition 을 건드리지 않으므로 그룹에 든 테이블의 groupPosition 이 null 로 남는다.
    // 폴백이 없으면 중점이 NaN 이 되어 교차 테이블이 그룹뷰에서 사라진다.
    const base = buildSampleModel()
    const m = { ...base, tables: {
      ...base.tables, t1: { ...base.tables['t1']!, groupPosition: null },
    } }
    const plan = planJunction(m, 'r1', ids(), { namingRules: RULES, activeGroupView: 'g1' })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    // t1 은 position (0,0) 으로 대신 세고, t2 는 groupPosition (310,10) 을 그대로 쓴다.
    expect(plan.junction.groupPosition).toEqual({ x: 155, y: 5 })
  })
})
