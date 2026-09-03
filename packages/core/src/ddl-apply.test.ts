import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from './naming.js'
import { generateDdl as generateDdlRaw, type DdlScope } from './ddl.js'
import { generateDbml as generateDbmlRaw } from './dbml.js'
import { parseDdl } from './ddl-parse.js'
import { parseDbml } from './dbml-parse.js'
import { planDdlImport, type DdlImportPlan } from './ddl-import.js'
import type { Dialect } from './dialect.js'
import { applyDdlImport, type LayoutFn } from './ddl-apply.js'

// 이 파일의 기존 케이스는 「템플릿 없는 규칙」을 전제한다 — 심으로 그 전제를 한 줄에 적는다.
const generateDdl = (
  model: ProjectModel, dialect: Dialect,
  scope: DdlScope = { kind: 'all' }, rules: NamingRules = DEFAULT_NAMING_RULES,
) => generateDdlRaw(model, dialect, scope, rules)
const generateDbml = (
  model: ProjectModel, dialect: Dialect, scope: DdlScope = { kind: 'all' },
  opts: { projectName?: string } = {}, rules: NamingRules = DEFAULT_NAMING_RULES,
) => generateDbmlRaw(model, dialect, scope, opts, rules)

let seq = 0
const newId = () => `id-${++seq}`

/** 테스트마다 독립된 id 발급기. 계획을 직접 만들어 넣는 케이스에서 쓴다. */
function mkNewId(): () => string {
  let n = 0
  return () => `id${++n}`
}

const build = (ddl: string) => {
  seq = 0
  const model = createEmptyModel()
  const plan = planDdlImport(model, parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
  return { before: model, after: applyDdlImport(model, plan, newId), plan }
}

const DDL = `
  CREATE TABLE MBR (MBR_NO bigint NOT NULL, MBR_NM varchar(100), PRIMARY KEY (MBR_NO));
  CREATE TABLE ORD (
    ORD_NO bigint NOT NULL, MBR_NO bigint NOT NULL,
    PRIMARY KEY (ORD_NO),
    FOREIGN KEY (MBR_NO) REFERENCES MBR (MBR_NO)
  );
  CREATE INDEX IX_MBR_01 ON MBR (MBR_NM);`

describe('applyDdlImport', () => {
  it('테이블·컬럼·인덱스·관계를 만든다', () => {
    const { after } = build(DDL)
    expect(Object.values(after.tables).map((t) => t.physicalName).sort()).toEqual(['MBR', 'ORD'])
    expect(Object.values(after.columns)).toHaveLength(4)
    expect(Object.values(after.indexes)).toHaveLength(1)
    expect(Object.values(after.relationships)).toHaveLength(1)
  })

  it('PK·NOT NULL·컬럼 순서를 보존한다', () => {
    const { after } = build(DDL)
    const mbr = Object.values(after.tables).find((t) => t.physicalName === 'MBR')!
    const cols = Object.values(after.columns)
      .filter((c) => c.tableId === mbr.id).sort((a, b) => a.order - b.order)
    expect(cols.map((c) => c.physicalName)).toEqual(['MBR_NO', 'MBR_NM'])
    expect(cols[0]).toMatchObject({ isPk: true, nullable: false, order: 0 })
    expect(cols[1]).toMatchObject({ isPk: false, nullable: true, order: 1 })
  })

  it('모든 테이블에 좌표를 배정하고 겹치지 않게 둔다', () => {
    const { after } = build(DDL)
    const positions = Object.values(after.tables).map((t) => `${t.position.x},${t.position.y}`)
    expect(new Set(positions).size).toBe(positions.length)
    for (const t of Object.values(after.tables)) {
      expect(Number.isFinite(t.position.x)).toBe(true)
      expect(Number.isFinite(t.position.y)).toBe(true)
    }
  })

  it('기존 테이블 아래쪽에 배치한다', () => {
    seq = 0
    const model = createEmptyModel()
    model.tables['old'] = {
      id: 'old', logicalName: '기존', physicalName: 'OLD', comment: null,
      groupId: null, position: { x: 0, y: 500 }, groupPosition: null, custom: {},
    }
    const plan = planDdlImport(model, parseDdl(DDL), 'postgresql', DEFAULT_NAMING_RULES)
    const after = applyDdlImport(model, plan, newId)
    for (const t of Object.values(after.tables)) {
      if (t.id === 'old') continue
      expect(t.position.y).toBeGreaterThan(500)
    }
  })

  it('기존 모델을 제자리에서 바꾸지 않는다', () => {
    const { before, after } = build(DDL)
    expect(Object.keys(before.tables)).toHaveLength(0)
    expect(after).not.toBe(before)
  })

  it('빈 계획이면 모델이 그대로다', () => {
    seq = 0
    const model = createEmptyModel()
    const plan = planDdlImport(model, parseDdl(''), 'postgresql', DEFAULT_NAMING_RULES)
    expect(applyDdlImport(model, plan, newId)).toEqual(model)
  })

  // 브리프 원안은 `generateDdl(original)`(인자 1개)이었으나 실제 시그니처는
  // `generateDdl(model: ProjectModel, dialect: Dialect, scope?: DdlScope)`로 dialect가
  // 필수다(기본값 없음, packages/core/src/ddl.ts:193). 인자 1개로는 컴파일이 안 되므로
  // 이 테스트에서 이미 쓰는 dialect인 'postgresql'을 명시했다. 자세한 내용은
  // task-7-report.md 참고.
  // 브리프의 회귀 방어 픽스처 — 부모·자식 테이블과 관계 1개, PK와 다른 컬럼의 인덱스 1개,
  // 테이블 comment, autoIncrement 컬럼, defaultValue 컬럼을 포함한다(packages/core의
  // ddl-import.test.ts roundTripModel과 같은 모양). shape()도 관계·인덱스까지 비교하도록
  // 넓혔다 — 원래는 테이블·컬럼만 비교해 관계·인덱스 왕복 손상을 놓쳤다.
  it('왕복 — 내보낸 DDL을 다시 가져오면 같은 모델이 나온다(id·좌표 제외)', () => {
    seq = 0
    const original = createEmptyModel()
    original.tables['t1'] = {
      id: 't1', logicalName: '회원', physicalName: 'MBR', comment: '회원 기본 정보',
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    original.tables['t2'] = {
      id: 't2', logicalName: '주문', physicalName: 'ORD', comment: null,
      groupId: null, position: { x: 300, y: 0 }, groupPosition: null, custom: {},
    }
    original.columns['c1'] = {
      id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
      type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
      defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
    }
    original.columns['c2'] = {
      id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
      type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: true,
      defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
    }
    original.columns['c3'] = {
      id: 'c3', tableId: 't2', logicalName: '주문번호', physicalName: 'ORD_NO',
      type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
      defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
    }
    original.columns['c4'] = {
      id: 'c4', tableId: 't2', logicalName: '회원번호', physicalName: 'MBR_NO',
      type: 'BIGINT', isPk: false, autoIncrement: false, nullable: false,
      defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
    }
    original.columns['c5'] = {
      id: 'c5', tableId: 't2', logicalName: '주문상태', physicalName: 'ORD_STTUS',
      type: 'VARCHAR(20)', isPk: false, autoIncrement: false, nullable: false,
      defaultValue: "'PENDING'", order: 2, comment: null, domainId: null, custom: {},
    }
    original.indexes['ix1'] = {
      id: 'ix1', tableId: 't1', name: 'IX_MBR_NM', unique: false,
      columns: [{ columnId: 'c2', direction: 'asc' }],
    }
    original.relationships['r1'] = {
      id: 'r1', parentTableId: 't1', childTableId: 't2',
      columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
      cardinality: '1:N', identifying: false, name: null,
    }

    const ddl = generateDdl(original, 'postgresql')
    const empty = createEmptyModel()
    const plan = planDdlImport(empty, parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    const restored = applyDdlImport(empty, plan, newId)

    const shape = (m: typeof original) => ({
      tables: Object.values(m.tables)
        .map((t) => ({ logicalName: t.logicalName, physicalName: t.physicalName, comment: t.comment }))
        .sort((a, b) => a.physicalName.localeCompare(b.physicalName)),
      columns: Object.values(m.columns)
        .map((c) => ({
          table: m.tables[c.tableId]?.physicalName ?? c.tableId,
          logicalName: c.logicalName, physicalName: c.physicalName, type: c.type,
          isPk: c.isPk, nullable: c.nullable, autoIncrement: c.autoIncrement,
          defaultValue: c.defaultValue, comment: c.comment, order: c.order,
        }))
        .sort((a, b) => (a.table + a.physicalName).localeCompare(b.table + b.physicalName)),
      indexes: Object.values(m.indexes)
        .map((ix) => ({
          table: m.tables[ix.tableId]?.physicalName ?? ix.tableId,
          name: ix.name, unique: ix.unique,
          columns: ix.columns.map((c) => m.columns[c.columnId]?.physicalName ?? c.columnId),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      relationships: Object.values(m.relationships)
        .map((r) => ({
          parent: m.tables[r.parentTableId]?.physicalName ?? r.parentTableId,
          child: m.tables[r.childTableId]?.physicalName ?? r.childTableId,
          cardinality: r.cardinality, identifying: r.identifying,
          columnMappings: r.columnMappings
            .map((cm) => ({
              child: m.columns[cm.childColumnId]?.physicalName ?? cm.childColumnId,
              parent: m.columns[cm.parentColumnId]?.physicalName ?? cm.parentColumnId,
            })),
        }))
        .sort((a, b) => (a.parent + a.child).localeCompare(b.parent + b.child)),
    })

    expect(shape(restored)).toEqual(shape(original))
  })
})

describe('applyDdlImport — DBML 확장', () => {
  const planWith = (over: Partial<DdlImportPlan>): DdlImportPlan => ({
    tables: [{
      physicalName: 'MBR', logicalName: '회원', comment: null, custom: {},
      columns: [{
        physicalName: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT', isPk: true,
        nullable: false, autoIncrement: false, defaultValue: null, comment: null, custom: {},
      }],
      indexes: [],
    }],
    relationships: [], skippedTables: [], warnings: [], groups: [],
    tableOptions: null, opCountEstimate: 2,
    ...over,
  })

  it('새 그룹을 만들고 테이블을 넣는다', () => {
    const next = applyDdlImport(createEmptyModel(), planWith({
      groups: [{
        name: '회원 관리', color: '#0E7A6C', comment: '회원 도메인', alias: '',
        tablePhysicalNames: ['MBR'], existingId: null,
      }],
    }), mkNewId())
    const group = Object.values(next.tableGroups)[0]!
    expect(group).toMatchObject({ name: '회원 관리', color: '#0E7A6C', comment: '회원 도메인' })
    expect(Object.values(next.tables)[0]!.groupId).toBe(group.id)
  })

  it('색이 null 이면 팔레트에서 고른다', () => {
    const next = applyDdlImport(createEmptyModel(), planWith({
      groups: [{
        name: 'G', color: null, comment: null, alias: '',
        tablePhysicalNames: ['MBR'], existingId: null,
      }],
    }), mkNewId())
    expect(Object.values(next.tableGroups)[0]!.color).toMatch(/^#[0-9a-fA-F]{6}$/)
  })

  it('새로 만드는 그룹에 계획의 별칭을 꽂는다', () => {
    const plan: DdlImportPlan = {
      tables: [], relationships: [], skippedTables: [], warnings: [],
      tableOptions: null, opCountEstimate: 1,
      groups: [{
        name: '회원관리', color: '#4A90D9', comment: null, alias: 'MBR',
        tablePhysicalNames: [], existingId: null,
      }],
    }
    const out = applyDdlImport(createEmptyModel(), plan, mkNewId())
    expect(Object.values(out.tableGroups)[0]!.alias).toBe('MBR')
  })

  it('existingId 가 있으면 새로 만들지 않고 색·설명도 덮어쓰지 않는다', () => {
    const m = createEmptyModel()
    m.tableGroups['g1'] = { id: 'g1', name: '회원 관리', color: '#111', comment: '원래 설명', alias: '' }
    const next = applyDdlImport(m, planWith({
      groups: [{
        name: '회원 관리', color: '#0E7A6C', comment: '가져온 설명', alias: '가져온별칭',
        tablePhysicalNames: ['MBR'], existingId: 'g1',
      }],
    }), mkNewId())
    expect(Object.keys(next.tableGroups)).toEqual(['g1'])
    // ⚠️ 별칭도 덮어쓰지 않는다 — 계획이 '가져온별칭' 을 실어 와도 기존 그룹의 빈 별칭이 남는다.
    expect(next.tableGroups['g1'])
      .toMatchObject({ color: '#111', comment: '원래 설명', alias: '' })
    expect(Object.values(next.tables)[0]!.groupId).toBe('g1')
  })

  it('커스텀 값을 테이블·컬럼에 옮긴다', () => {
    const plan = planWith({})
    plan.tables[0]!.custom = { f1: '2' }
    plan.tables[0]!.columns[0]!.custom = { f2: 'Y' }
    const next = applyDdlImport(createEmptyModel(), plan, mkNewId())
    expect(Object.values(next.tables)[0]!.custom).toEqual({ f1: '2' })
    expect(Object.values(next.columns)[0]!.custom).toEqual({ f2: 'Y' })
  })

  it('카디널리티와 관계 이름을 계획대로 만든다', () => {
    const plan = planWith({
      relationships: [{
        childPhysicalName: 'MBR', parentPhysicalName: 'MBR',
        columnPairs: [{ child: 'MBR_NO', parent: 'MBR_NO' }],
        identifying: false, cardinality: '1:1', name: 'FK_X',
      }],
    })
    const next = applyDdlImport(createEmptyModel(), plan, mkNewId())
    expect(Object.values(next.relationships)[0]).toMatchObject({ cardinality: '1:1', name: 'FK_X' })
  })
})

/**
 * core 의 `dbml-roundtrip.test.ts` 와 같은 픽스처다(계획이 복제를 지정했다). 그쪽은 계획
 * 수준까지만 보고, 이 파일은 `applyDdlImport` 까지 돌려 groupId·custom 배선을 잠근다.
 */
function roundTripModel(): ProjectModel {
  const m = createEmptyModel()
  m.customFields['f1'] = {
    id: 'f1', name: '보안등급', target: 'table', type: 'text', options: [],
    required: false, defaultValue: null, order: 0, origin: null,
  }
  m.customFields['f2'] = {
    id: 'f2', name: '개인정보', target: 'column', type: 'text', options: [],
    required: false, defaultValue: null, order: 0, origin: null,
  }
  m.tableGroups['g1'] = { id: 'g1', name: '회원 관리', color: '#0E7A6C', comment: '회원 도메인', alias: '' }
  m.tables['t1'] = {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: "it's 회원\n두 줄 설명",
    groupId: 'g1', position: { x: 0, y: 0 }, groupPosition: null, custom: { f1: '2' },
  }
  m.tables['t2'] = {
    id: 't2', logicalName: '주문', physicalName: 'ORD', comment: null,
    groupId: 'g1', position: { x: 300, y: 0 }, groupPosition: null, custom: {},
  }
  m.tables['t3'] = {
    id: 't3', logicalName: '회원상세', physicalName: 'MBR_DTL', comment: null,
    groupId: null, position: { x: 600, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c2'] = {
    id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
    type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: false,
    defaultValue: "'익명'", order: 1, comment: '표시용 이름', domainId: null,
    custom: { f2: 'Y' },
  }
  m.columns['c3'] = {
    id: 'c3', tableId: 't2', logicalName: '주문번호', physicalName: 'ORD_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c4'] = {
    id: 'c4', tableId: 't2', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
  }
  m.columns['c5'] = {
    id: 'c5', tableId: 't3', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.indexes['ix1'] = {
    id: 'ix1', tableId: 't1', name: 'IX_MBR_NM', unique: false,
    columns: [{ columnId: 'c2', direction: 'asc' }],
  }
  m.relationships['r1'] = {
    id: 'r1', parentTableId: 't1', childTableId: 't2',
    columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
    cardinality: '1:N', identifying: true, name: null,
  }
  m.relationships['r2'] = {
    id: 'r2', parentTableId: 't1', childTableId: 't3',
    columnMappings: [{ childColumnId: 'c5', parentColumnId: 'c1' }],
    cardinality: '1:1', identifying: true, name: 'FK_MBR_DTL_MBR',
  }
  return m
}

describe('DBML 왕복 — 모델까지', () => {
  it('내보낸 DBML 을 되읽으면 같은 모델이 나온다', () => {
    const model = roundTripModel()
    const dbml = generateDbml(model, 'postgresql')
    const target = createEmptyModel()
    target.customFields = model.customFields
    const plan = planDdlImport(target, parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)
    const next = applyDdlImport(target, plan, mkNewId())

    const byName = (m: ProjectModel) => Object.fromEntries(
      Object.values(m.tables).map((t) => [t.physicalName, {
        logicalName: t.logicalName, comment: t.comment, custom: t.custom,
        group: t.groupId === null ? null : {
          name: m.tableGroups[t.groupId]!.name,
          color: m.tableGroups[t.groupId]!.color,
          comment: m.tableGroups[t.groupId]!.comment,
        },
      }]),
    )
    expect(byName(next)).toEqual(byName(model))
    // 객체 배열의 기본 정렬은 전부 "[object Object]" 로 비교해 순서를 바꾸지 않는다(no-op).
    // 자식 테이블 이름을 키로 안정 정렬해 순서에 기대지 않고 비교한다.
    const rels = (m: ProjectModel) => Object.values(m.relationships)
      .map((r) => ({
        child: m.tables[r.childTableId]!.physicalName,
        cardinality: r.cardinality, name: r.name, identifying: r.identifying,
      }))
      .sort((a, b) => a.child.localeCompare(b.child))
    expect(rels(next)).toEqual(rels(model))
  })
})

/**
 * 배치는 주입 지점이다. core 는 dagre 를 의존하지 않으므로 기본값이 격자(`gridPositions`)이고,
 * web 은 `computeAutoLayout`(dagre) 을 주입해 지금까지의 계층 배치를 그대로 유지한다.
 */
describe('applyDdlImport — 배치 주입', () => {
  it('기본 배치는 core 의 격자다 — 두 테이블이 같은 행에 가로로 놓인다', () => {
    const { after } = build(DDL)
    const pos = Object.fromEntries(
      Object.values(after.tables).map((t) => [t.physicalName, t.position]),
    )
    expect(pos['MBR']).toEqual({ x: 0, y: 0 })
    expect(pos['ORD']).toEqual({ x: 320, y: 0 })
  })

  it('layout 을 주면 그 좌표를 쓴다', () => {
    seq = 0
    const model = createEmptyModel()
    const plan = planDdlImport(model, parseDdl(DDL), 'postgresql', DEFAULT_NAMING_RULES)
    const layout: LayoutFn = (nodes) =>
      new Map(nodes.map((n, i) => [n.id, { x: i * 1000, y: i * 7 }]))
    const after = applyDdlImport(model, plan, newId, { layout })
    const pos = Object.fromEntries(
      Object.values(after.tables).map((t) => [t.physicalName, t.position]),
    )
    expect(pos['MBR']).toEqual({ x: 0, y: 0 })
    expect(pos['ORD']).toEqual({ x: 1000, y: 7 })
  })

  it('주입한 배치에 노드 크기와 간선을 넘긴다', () => {
    seq = 0
    const model = createEmptyModel()
    const plan = planDdlImport(model, parseDdl(DDL), 'postgresql', DEFAULT_NAMING_RULES)
    let seen: { nodes: unknown; edges: unknown } | null = null
    const layout: LayoutFn = (nodes, edges) => {
      seen = { nodes, edges }
      return new Map(nodes.map((n) => [n.id, { x: 0, y: 0 }]))
    }
    applyDdlImport(model, plan, newId, { layout })
    expect(seen).toEqual({
      // 높이는 컬럼 수 기반 추정(40 + 컬럼수 * 28)이다 — 렌더 전이라 실측 크기가 없다.
      nodes: [
        { id: 'MBR', width: 260, height: 96 },
        { id: 'ORD', width: 260, height: 96 },
      ],
      edges: [{ source: 'MBR', target: 'ORD' }],
    })
  })

  it('주입한 배치가 좌표를 안 준 테이블도 기존 테이블 아래로 민다', () => {
    seq = 0
    const model = createEmptyModel()
    model.tables['old'] = {
      id: 'old', logicalName: '기존', physicalName: 'OLD', comment: null,
      groupId: null, position: { x: 0, y: 500 }, groupPosition: null, custom: {},
    }
    const plan = planDdlImport(model, parseDdl(DDL), 'postgresql', DEFAULT_NAMING_RULES)
    const layout: LayoutFn = () => new Map()
    const after = applyDdlImport(model, plan, newId, { layout })
    for (const t of Object.values(after.tables)) {
      if (t.id === 'old') continue
      expect(t.position).toEqual({ x: 0, y: 700 })
    }
  })
})
