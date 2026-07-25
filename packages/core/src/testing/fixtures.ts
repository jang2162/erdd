import type { ProjectModel } from '../model.js'

/** 그룹 1, 테이블 2(MBR_GRD, MBR), 컬럼 4, 관계 1, 인덱스 1, 메모 1인 유효한 샘플 모델. */
export function buildSampleModel(): ProjectModel {
  return {
    tableGroups: {
      g1: { id: 'g1', name: '회원관리', color: '#4A90D9', comment: null },
    },
    tables: {
      t1: {
        id: 't1', logicalName: '회원등급', physicalName: 'MBR_GRD', comment: null,
        groupId: 'g1', position: { x: 0, y: 0 }, groupPosition: { x: 10, y: 10 },
      },
      t2: {
        id: 't2', logicalName: '회원', physicalName: 'MBR', comment: '서비스 가입 회원',
        groupId: 'g1', position: { x: 300, y: 0 }, groupPosition: { x: 310, y: 10 },
      },
    },
    columns: {
      c1: {
        id: 'c1', tableId: 't1', logicalName: '등급코드', physicalName: 'GRD_CD',
        type: 'CHAR(2)', isPk: true, autoIncrement: false, nullable: false,
        defaultValue: null, order: 0, comment: null, domainId: null,
      },
      c2: {
        id: 'c2', tableId: 't2', logicalName: '회원번호', physicalName: 'MBR_NO',
        type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
        defaultValue: null, order: 0, comment: null, domainId: null,
      },
      c3: {
        id: 'c3', tableId: 't2', logicalName: '회원명', physicalName: 'MBR_NM',
        type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: false,
        defaultValue: null, order: 1, comment: null, domainId: null,
      },
      c4: {
        id: 'c4', tableId: 't2', logicalName: '등급코드', physicalName: 'GRD_CD',
        type: 'CHAR(2)', isPk: false, autoIncrement: false, nullable: false,
        defaultValue: null, order: 2, comment: null, domainId: null,
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
  }
}
