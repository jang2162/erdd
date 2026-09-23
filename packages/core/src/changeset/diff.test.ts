import { describe, expect, it } from 'vitest'
import { buildSampleModel } from '../testing/fixtures.js'
import { DEFAULT_NAMING_RULES } from '../naming.js'
import { deleteTableCascade } from '../relationship.js'
import type { Column, ProjectModel } from '../model.js'
import { projectSchema } from './projection.js'
import { diffProjection, longestCommonSubsequence } from './diff.js'
import { emptyProjection, type Statement } from './types.js'

const S = { rules: DEFAULT_NAMING_RULES, dialects: ['postgresql'] as const }
const proj = (m: ProjectModel) => projectSchema(m, S)
function diff(a: ProjectModel, b: ProjectModel): Statement[] {
  const r = diffProjection(proj(a), proj(b))
  if (!r.ok) throw new Error(r.message)
  return r.statements
}
const kinds = (st: Statement[]) => st.map((s) => s.kind)
const col = (over: Partial<Column> & Pick<Column, 'id' | 'tableId' | 'physicalName' | 'order'>): Column => ({
  logicalName: '', type: 'VARCHAR(10)', isPk: false, autoIncrement: false, nullable: true,
  defaultValue: null, comment: null, domainId: null, custom: {}, ...over,
})

describe('diffProjection', () => {
  it('같으면 빈 목록이다', () => {
    expect(diff(buildSampleModel(), buildSampleModel())).toEqual([])
  })

  it('빈 투영에서는 테이블 생성(이름순) → 인덱스 → FK 다', () => {
    const r = diffProjection(emptyProjection(), proj(buildSampleModel()))
    if (!r.ok) throw new Error(r.message)
    expect(kinds(r.statements)).toEqual(['createTable', 'createTable', 'addIndex', 'addForeignKey'])
    expect(r.statements[0]).toEqual({
      kind: 'createTable',
      table: {
        id: 't2', name: 'MBR', comment: '회원 - 서비스 가입 회원',
        columns: [
          { id: 'c2', name: 'MBR_NO', type: 'BIGINT', dialectTypes: {}, nullable: false, default: null, increment: true, comment: '회원번호', check: [] },
          { id: 'c3', name: 'MBR_NM', type: 'VARCHAR(100)', dialectTypes: {}, nullable: false, default: null, increment: false, comment: '회원명', check: [] },
          { id: 'c4', name: 'GRD_CD', type: 'CHAR(2)', dialectTypes: {}, nullable: false, default: null, increment: false, comment: '등급코드', check: [] },
        ],
        primaryKey: ['MBR_NO'],
        indexes: [],
      },
    })
  })

  it('컬럼 이름 변경은 rename 한 줄이다 — DROP+ADD 가 아니고, 그 컬럼을 쓰는 인덱스도 건드리지 않는다', () => {
    const b = buildSampleModel()
    b.columns['c3'] = { ...b.columns['c3']!, physicalName: 'MBR_NAME' }
    expect(diff(buildSampleModel(), b)).toEqual([
      { kind: 'alterTable', id: 't2', name: 'MBR', actions: [{ kind: 'renameColumn', id: 'c3', from: 'MBR_NM', to: 'MBR_NAME' }] },
    ])
  })

  it('컬럼 하나를 중간에 끼우면 add column 한 줄만 나온다 — 뒤쪽 컬럼의 position 변경이 없다', () => {
    const b = buildSampleModel()
    b.columns['c5'] = col({ id: 'c5', tableId: 't2', physicalName: 'MBR_EMAIL', logicalName: '이메일', type: 'VARCHAR(200)', order: 1 })
    b.columns['c3'] = { ...b.columns['c3']!, order: 2 }
    b.columns['c4'] = { ...b.columns['c4']!, order: 3 }
    expect(diff(buildSampleModel(), b)).toEqual([{
      kind: 'alterTable', id: 't2', name: 'MBR',
      actions: [{
        kind: 'addColumn', after: 'MBR_NO',
        column: { id: 'c5', name: 'MBR_EMAIL', type: 'VARCHAR(200)', dialectTypes: {}, nullable: true, default: null, increment: false, comment: '이메일', check: [] },
      }],
    }])
  })

  it('컬럼을 옮기면 옮긴 컬럼 하나의 position 만 나온다', () => {
    const b = buildSampleModel()
    b.columns['c4'] = { ...b.columns['c4']!, order: -1 }   // 맨 앞으로
    expect(diff(buildSampleModel(), b)).toEqual([{
      kind: 'alterTable', id: 't2', name: 'MBR',
      actions: [{ kind: 'modifyColumn', id: 'c4', name: 'GRD_CD', changes: [{ field: 'position', from: 'MBR_NM', to: null }] }],
    }])
  })

  it('도메인 타입 변경은 그 도메인을 쓰는 컬럼마다 modify 로 펼쳐진다', () => {
    const withDomain = (logicalType: string) => {
      const m = buildSampleModel()
      m.domains['d1'] = {
        id: 'd1', name: '명', category: null, logicalType,
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null, origin: null,
      }
      m.columns['c1'] = { ...m.columns['c1']!, domainId: 'd1' }
      m.columns['c3'] = { ...m.columns['c3']!, domainId: 'd1' }
      return m
    }
    const st = diff(withDomain('VARCHAR(100)'), withDomain('VARCHAR(200)'))
    expect(st.map((s) => s.kind === 'alterTable' ? [s.name, s.actions] : null)).toEqual([
      ['MBR', [{ kind: 'modifyColumn', id: 'c3', name: 'MBR_NM', changes: [{ field: 'type', from: 'VARCHAR(100)', to: 'VARCHAR(200)' }] }]],
      ['MBR_GRD', [{ kind: 'modifyColumn', id: 'c1', name: 'GRD_CD', changes: [{ field: 'type', from: 'VARCHAR(100)', to: 'VARCHAR(200)' }] }]],
    ])
  })

  it('문장 순서가 고정이다 — FK 삭제 → 인덱스 삭제 → 테이블 삭제 → 개명 → 생성 → 변경 → 인덱스 추가 → FK 추가', () => {
    const a = buildSampleModel()
    a.tables['t3'] = { id: 't3', logicalName: '', physicalName: 'TMP', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
    a.columns['c9'] = col({ id: 'c9', tableId: 't3', physicalName: 'TMP_NO', order: 0 })
    let b: ProjectModel = structuredClone(a)
    b = deleteTableCascade(b, 't3')
    delete b.relationships['r1']
    b.relationships['r2'] = {
      id: 'r2', parentTableId: 't1', childTableId: 't2',
      columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }], cardinality: '1:1', identifying: false, name: null,
    }
    delete b.indexes['i1']
    b.indexes['i2'] = { id: 'i2', tableId: 't2', name: 'IX_MBR_02', columns: [{ columnId: 'c4', direction: 'desc' }], unique: false }
    b.tables['t1'] = { ...b.tables['t1']!, physicalName: 'GRD' }
    b.tables['t4'] = { id: 't4', logicalName: '', physicalName: 'NEW_TB', comment: null, groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {} }
    b.columns['c8'] = col({ id: 'c8', tableId: 't4', physicalName: 'NEW_NO', order: 0 })
    b.columns['c3'] = { ...b.columns['c3']!, physicalName: 'MBR_NAME' }
    const st = diff(a, b)
    expect(kinds(st)).toEqual([
      'dropForeignKey', 'dropIndex', 'dropTable', 'renameTable', 'createTable', 'alterTable', 'addIndex', 'addForeignKey',
    ])
    // 1:1 FK 는 DDL 이 함께 내는 UNIQUE 이름을 싣는다.
    expect(st[7]).toMatchObject({ kind: 'addForeignKey', fk: { name: 'FK_MBR_GRD', cardinality: '1:1', uniqueName: 'UQ_MBR_GRD_CD', child: 'MBR', parent: 'GRD' } })
    // 인덱스 삭제는 옛 이름, 추가는 새 이름으로 쓴다.
    expect(st[1]).toMatchObject({ kind: 'dropIndex', index: { name: 'UX_MBR_01', columns: [{ name: 'MBR_NM', direction: 'asc' }] } })
  })

  it('drop table 은 삭제 직전의 정의 전부를 싣고, 그 테이블의 인덱스는 따로 drop index 하지 않는다', () => {
    const b = deleteTableCascade(buildSampleModel(), 't2')
    const st = diff(buildSampleModel(), b)
    expect(kinds(st)).toEqual(['dropForeignKey', 'dropTable'])
    expect(st[1]).toMatchObject({
      kind: 'dropTable',
      table: {
        id: 't2', name: 'MBR', primaryKey: ['MBR_NO'],
        indexes: [{ id: 'i1', name: 'UX_MBR_01', table: 'MBR', columns: [{ name: 'MBR_NM', direction: 'asc' }], unique: true }],
      },
    })
    if (st[1]?.kind === 'dropTable') expect(st[1].table.columns.map((c) => c.name)).toEqual(['MBR_NO', 'MBR_NM', 'GRD_CD'])
  })

  it('지운 컬럼과 같은 이름으로 새 컬럼을 만들면 drop 이 add 보다 먼저다', () => {
    const b = buildSampleModel()
    delete b.columns['c3']
    delete b.indexes['i1']
    b.columns['c9'] = col({ id: 'c9', tableId: 't2', physicalName: 'MBR_NM', order: 1 })
    const st = diff(buildSampleModel(), b)
    const alter = st.find((s) => s.kind === 'alterTable')
    expect(alter?.kind === 'alterTable' ? alter.actions.map((x) => x.kind) : null).toEqual(['dropColumn', 'addColumn'])
  })

  it('PK 변경은 primary key 한 줄이다', () => {
    const b = buildSampleModel()
    b.columns['c3'] = { ...b.columns['c3']!, isPk: true }
    const st = diff(buildSampleModel(), b)
    expect(st).toEqual([{ kind: 'alterTable', id: 't2', name: 'MBR', actions: [{ kind: 'primaryKey', from: ['MBR_NO'], to: ['MBR_NO', 'MBR_NM'] }] }])
  })

  it('같은 물리명의 테이블·컬럼, 다른 테이블로 옮긴 컬럼은 거절한다', () => {
    const dupTable = buildSampleModel()
    dupTable.tables['t1'] = { ...dupTable.tables['t1']!, physicalName: 'MBR' }
    const r1 = diffProjection(proj(buildSampleModel()), proj(dupTable))
    expect(r1).toMatchObject({ ok: false })
    if (!r1.ok) expect(r1.message).toContain('같은 물리명의 테이블')

    const dupColumn = buildSampleModel()
    dupColumn.columns['c3'] = { ...dupColumn.columns['c3']!, physicalName: 'MBR_NO' }
    const r2 = diffProjection(proj(buildSampleModel()), proj(dupColumn))
    if (r2.ok) throw new Error('거절해야 한다')
    expect(r2.message).toContain('같은 물리명의 컬럼')

    const moved = buildSampleModel()
    moved.columns['c3'] = { ...moved.columns['c3']!, tableId: 't1', order: 5 }
    delete moved.indexes['i1']
    const r3 = diffProjection(proj(buildSampleModel()), proj(moved))
    if (r3.ok) throw new Error('거절해야 한다')
    expect(r3.message).toContain('다른 테이블')
  })
})

describe('longestCommonSubsequence', () => {
  it('최장 공통 부분열을 순서대로 돌려준다', () => {
    expect(longestCommonSubsequence(['a', 'b', 'c', 'd'], ['b', 'a', 'c', 'd'])).toHaveLength(3)
    expect(longestCommonSubsequence(['x', 'a', 'b'], ['a', 'b', 'x'])).toEqual(['a', 'b'])
    expect(longestCommonSubsequence([], ['a'])).toEqual([])
  })
})
