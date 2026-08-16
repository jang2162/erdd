import { createEmptyModel, type ProjectModel } from '../model.js'

/** 그룹 1, 테이블 2(MBR_GRD, MBR), 컬럼 4, 관계 1, 인덱스 1, 메모 1인 유효한 샘플 모델. */
export function buildSampleModel(): ProjectModel {
  return {
    tableGroups: {
      g1: { id: 'g1', name: '회원관리', color: '#4A90D9', comment: null, alias: '' },
    },
    tables: {
      t1: {
        id: 't1', logicalName: '회원등급', physicalName: 'MBR_GRD', comment: null,
        groupId: 'g1', position: { x: 0, y: 0 }, groupPosition: { x: 10, y: 10 }, custom: {},
      },
      t2: {
        id: 't2', logicalName: '회원', physicalName: 'MBR', comment: '서비스 가입 회원',
        groupId: 'g1', position: { x: 300, y: 0 }, groupPosition: { x: 310, y: 10 }, custom: {},
      },
    },
    columns: {
      c1: {
        id: 'c1', tableId: 't1', logicalName: '등급코드', physicalName: 'GRD_CD',
        type: 'CHAR(2)', isPk: true, autoIncrement: false, nullable: false,
        defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
      },
      c2: {
        id: 'c2', tableId: 't2', logicalName: '회원번호', physicalName: 'MBR_NO',
        type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
        defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
      },
      c3: {
        id: 'c3', tableId: 't2', logicalName: '회원명', physicalName: 'MBR_NM',
        type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: false,
        defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
      },
      c4: {
        id: 'c4', tableId: 't2', logicalName: '등급코드', physicalName: 'GRD_CD',
        type: 'CHAR(2)', isPk: false, autoIncrement: false, nullable: false,
        defaultValue: null, order: 2, comment: null, domainId: null, custom: {},
      },
    },
    relationships: {
      r1: {
        id: 'r1', parentTableId: 't1', childTableId: 't2',
        columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
        cardinality: '1:N', identifying: false, name: null,
      },
    },
    indexes: {
      i1: {
        id: 'i1', tableId: 't2', name: 'UX_MBR_01',
        columns: [{ columnId: 'c3', direction: 'asc' }], unique: true,
      },
    },
    notes: {
      n1: { id: 'n1', content: '회원 도메인 메모', position: { x: 600, y: 0 }, color: '#FFF3B0' },
    },
    domains: {},
    words: {},
    terms: {},
    customFields: {},
  }
}

/** 9개 컬렉션을 전부 채운 픽스처. 왕복이 실제로 모든 경로를 지나가게 한다. */
export function fullModel(): ProjectModel {
  const m = createEmptyModel()
  m.tableGroups['g1'] = { id: 'g1', name: '회원관리', color: '#eef', comment: '회원 도메인', alias: '' }
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
  // identifying:false · cardinality:'1:1' · name:null · nullable:true를 덮는다.
  // 이 값들이 없으면 해당 복원 분기가 왕복에서 한 번도 실행되지 않는다.
  m.tables['tb3'] = {
    id: 'tb3', logicalName: '회원상세', physicalName: 'MBR_DTL', comment: null,
    groupId: 'g1', position: { x: 50, y: 60 }, groupPosition: null, custom: {},
  }
  m.columns['c5'] = {
    id: 'c5', tableId: 'tb3', logicalName: '회원번호', physicalName: 'MBR_NO', type: 'BIGINT',
    isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0,
    comment: null, domainId: null, custom: {},
  }
  m.columns['c6'] = {
    id: 'c6', tableId: 'tb3', logicalName: '비고', physicalName: 'RMK', type: 'TEXT',
    isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 1,
    comment: null, domainId: null, custom: {},
  }
  m.relationships['r2'] = {
    id: 'r2', parentTableId: 'tb1', childTableId: 'tb3',
    columnMappings: [{ childColumnId: 'c5', parentColumnId: 'c1' }],
    cardinality: '1:1', identifying: false, name: null,
  }
  m.notes['n1'] = { id: 'n1', content: '메모', position: { x: 0, y: 0 }, color: '#ff0' }
  return m
}
