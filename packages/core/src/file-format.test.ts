import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { modelToFiles, TREE_ROOT, TOP_LEVEL_FILES } from './file-format.js'

/** 9개 컬렉션을 전부 채운 픽스처. 왕복이 실제로 모든 경로를 지나가게 한다. */
export function fullModel(): ProjectModel {
  const m = createEmptyModel()
  m.tableGroups['g1'] = { id: 'g1', name: '회원관리', color: '#eef', comment: '회원 도메인' }
  m.domains['d1'] = {
    id: 'd1', name: '명', category: '문자', logicalType: 'VARCHAR(100)',
    dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
    defaultValue: null, allowedValues: [], description: '이름류', origin: null,
  }
  m.words['w1'] = { id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: 'MEMBER', description: null, origin: null }
  m.terms['t1'] = { id: 't1', logicalName: '회원번호', physicalName: 'MBR_NO', domainId: 'd1', description: null, origin: null }
  m.customFields['cf1'] = {
    id: 'cf1', name: '개인정보여부', target: 'column', type: 'boolean',
    options: [], required: false, defaultValue: 'false', order: 0, origin: null,
  }
  m.tables['tb1'] = {
    id: 'tb1', logicalName: '회원', physicalName: 'MBR', comment: '서비스 가입 회원',
    groupId: 'g1', position: { x: 10, y: 20 }, groupPosition: { x: 1, y: 2 }, custom: {},
  }
  m.tables['tb2'] = {
    id: 'tb2', logicalName: '주문', physicalName: 'ORD', comment: null,
    groupId: null, position: { x: 30, y: 40 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 'tb1', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT',
    isPk: true, autoIncrement: true, nullable: false, defaultValue: null, order: 0,
    comment: '회원 식별자', domainId: null, custom: {},
  }
  m.columns['c2'] = {
    id: 'c2', tableId: 'tb1', logicalName: '회원명', physicalName: 'MBR_NM', type: 'VARCHAR(100)',
    isPk: false, autoIncrement: false, nullable: false, defaultValue: "''", order: 1,
    comment: null, domainId: 'd1', custom: { '개인정보여부': 'true' },
  }
  m.columns['c3'] = {
    id: 'c3', tableId: 'tb2', logicalName: '주문번호', physicalName: 'ORD_NO', type: 'BIGINT',
    isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0,
    comment: null, domainId: null, custom: {},
  }
  m.columns['c4'] = {
    id: 'c4', tableId: 'tb2', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT',
    isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 1,
    comment: null, domainId: null, custom: {},
  }
  m.indexes['ix1'] = {
    id: 'ix1', tableId: 'tb1', name: 'UX_MBR_01',
    columns: [{ columnId: 'c2', direction: 'asc' }], unique: true,
  }
  m.indexes['ix2'] = {
    id: 'ix2', tableId: 'tb2', name: 'IX_ORD_01',
    columns: [{ columnId: 'c4', direction: 'desc' }], unique: false,
  }
  m.relationships['r1'] = {
    id: 'r1', parentTableId: 'tb1', childTableId: 'tb2',
    columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
    cardinality: '1:N', identifying: true, name: 'FK_ORD_MBR',
  }
  m.notes['n1'] = { id: 'n1', content: '메모', position: { x: 0, y: 0 }, color: '#ff0' }
  return m
}

describe('modelToFiles', () => {
  it('테이블마다 파일 하나와 최상위 파일 5개를 만든다', () => {
    const { tree, issues } = modelToFiles(fullModel())
    expect(issues).toEqual([])
    expect(Object.keys(tree).sort()).toEqual([
      `${TREE_ROOT}/custom-fields.yaml`,
      `${TREE_ROOT}/domains.yaml`,
      `${TREE_ROOT}/groups.yaml`,
      `${TREE_ROOT}/tables/MBR.yaml`,
      `${TREE_ROOT}/tables/ORD.yaml`,
      `${TREE_ROOT}/terms.yaml`,
      `${TREE_ROOT}/words.yaml`,
    ].sort())
    expect(TOP_LEVEL_FILES).toHaveLength(5)
  })

  it('컬럼·인덱스·관계를 테이블 파일 안에 이름으로 적는다', () => {
    const { tree } = modelToFiles(fullModel())
    expect(tree[`${TREE_ROOT}/tables/MBR.yaml`]).toEqual({
      id: 'tb1', name: 'MBR', logicalName: '회원', group: '회원관리', comment: '서비스 가입 회원',
      columns: [
        { id: 'c1', name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT', pk: true, autoIncrement: true, nullable: false, comment: '회원 식별자' },
        { id: 'c2', name: 'MBR_NM', logicalName: '회원명', domain: '명', type: 'VARCHAR(100)', nullable: false, default: "''", custom: { '개인정보여부': 'true' } },
      ],
      indexes: [{ id: 'ix1', name: 'UX_MBR_01', columns: ['MBR_NM'], unique: true }],
    })
    expect(tree[`${TREE_ROOT}/tables/ORD.yaml`]).toEqual({
      id: 'tb2', name: 'ORD', logicalName: '주문',
      columns: [
        { id: 'c3', name: 'ORD_NO', logicalName: '주문번호', type: 'BIGINT', pk: true, nullable: false },
        { id: 'c4', name: 'MBR_NO', logicalName: '회원번호', type: 'BIGINT', pk: true, nullable: false },
      ],
      indexes: [{ id: 'ix2', name: 'IX_ORD_01', columns: ['MBR_NO DESC'] }],
      relations: [{
        id: 'r1', name: 'FK_ORD_MBR', to: 'MBR',
        columns: { MBR_NO: 'MBR_NO' }, identifying: true,
      }],
    })
  })

  it('notes·position·origin은 어느 파일에도 나타나지 않는다', () => {
    const { tree } = modelToFiles(fullModel())
    const dumped = JSON.stringify(tree)
    expect(dumped).not.toContain('position')
    expect(dumped).not.toContain('origin')
    expect(dumped).not.toContain('메모')
  })

  it('물리명이 대소문자만 다르면 두 파일 모두에 id 접미사를 붙이고 경고한다', () => {
    const m = fullModel()
    // 컬렉션 키는 반드시 id와 같아야 한다(op.ts:90이 강제하는 리포 전역 불변식).
    m.tables['tb3abcdef-0000'] = {
      id: 'tb3abcdef-0000', logicalName: '회원소문자', physicalName: 'mbr', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const { tree, issues } = modelToFiles(m)
    expect(Object.keys(tree)).toContain(`${TREE_ROOT}/tables/MBR.tb1.yaml`)
    expect(Object.keys(tree)).toContain(`${TREE_ROOT}/tables/mbr.def-0000.yaml`)
    expect(Object.keys(tree)).not.toContain(`${TREE_ROOT}/tables/MBR.yaml`)
    expect(issues.some((i) => i.message.includes('대소문자'))).toBe(true)
  })

  it('id 앞부분이 같아도(같은 65초 창에 생성) 파일명이 갈린다', () => {
    const m = createEmptyModel()
    // uuidv7의 앞 12자는 48비트 ms 타임스탬프 — 같은 65초 창이면 앞 8자가 동일하다.
    const idA = '019fc671-b1ef-7e97-958b-4a888c73a323'
    const idB = '019fc671-c2aa-7000-8000-000000000001'
    expect(idA.slice(0, 8)).toBe(idB.slice(0, 8))   // 전제 확인
    m.tables[idA] = {
      id: idA, logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.tables[idB] = {
      id: idB, logicalName: '회원소문자', physicalName: 'mbr', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const names = Object.keys(modelToFiles(m).tree).filter((p) => p.startsWith(`${TREE_ROOT}/tables/`))
    expect(names).toHaveLength(2)
    // 대소문자를 구분하지 않는 파일시스템에서도 서로 다른 경로여야 한다.
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(2)
  })

  it('뒤 8자까지 같으면 id 전체를 접미사로 쓴다', () => {
    const m = createEmptyModel()
    const idA = '019fc671-0000-7000-8000-4a888c73a323'
    const idB = '019fc671-1111-7000-8000-4a888c73a323'
    expect(idA.slice(-8)).toBe(idB.slice(-8))   // 전제 확인
    m.tables[idA] = {
      id: idA, logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.tables[idB] = {
      id: idB, logicalName: '회원소문자', physicalName: 'mbr', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const names = Object.keys(modelToFiles(m).tree)
    expect(names).toContain(`${TREE_ROOT}/tables/MBR.${idA}.yaml`)
    expect(names).toContain(`${TREE_ROOT}/tables/mbr.${idB}.yaml`)
  })
})
