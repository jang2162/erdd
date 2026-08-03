import { describe, expect, it } from 'vitest'
import { createEmptyModel, generateDdl, parseDdl, planDdlImport, DEFAULT_NAMING_RULES } from '@erdd/core'
import { applyDdlImport } from './ddl-import-edits.js'

let seq = 0
const newId = () => `id-${++seq}`

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
