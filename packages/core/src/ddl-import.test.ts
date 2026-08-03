import { describe, expect, it } from 'vitest'
import { createEmptyModel } from './model.js'
import { DEFAULT_NAMING_RULES } from './naming.js'
import { parseDdl } from './ddl-parse.js'
import { planDdlImport } from './ddl-import.js'
import { generateDdl } from './ddl.js'
import { DIALECTS, type Dialect } from './dialect.js'
import type { ProjectModel, Word } from './model.js'

const plan = (ddl: string, model: ProjectModel = createEmptyModel(), dialect: Dialect = 'postgresql') =>
  planDdlImport(model, parseDdl(ddl), dialect, DEFAULT_NAMING_RULES)

describe('planDdlImport', () => {
  it('테이블·컬럼·PK·관계·인덱스를 계획으로 만든다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint NOT NULL, MBR_NM varchar(100), PRIMARY KEY (MBR_NO));
      CREATE TABLE ORD (
        ORD_NO bigint NOT NULL, MBR_NO bigint NOT NULL,
        PRIMARY KEY (ORD_NO),
        FOREIGN KEY (MBR_NO) REFERENCES MBR (MBR_NO)
      );
      CREATE INDEX IX_MBR_01 ON MBR (MBR_NM);`)
    expect(p.tables.map((t) => t.physicalName)).toEqual(['MBR', 'ORD'])
    expect(p.tables[0]!.columns[0]).toMatchObject({
      physicalName: 'MBR_NO', type: 'BIGINT', isPk: true, nullable: false,
    })
    expect(p.tables[0]!.columns[1]).toMatchObject({ physicalName: 'MBR_NM', type: 'VARCHAR(100)', nullable: true })
    expect(p.tables[0]!.indexes).toEqual([{ name: 'IX_MBR_01', columnPhysicalNames: ['MBR_NM'], unique: false }])
    expect(p.relationships).toEqual([{
      childPhysicalName: 'ORD', parentPhysicalName: 'MBR',
      columnPairs: [{ child: 'MBR_NO', parent: 'MBR_NO' }], identifying: false,
    }])
  })

  it('자식의 FK 컬럼이 전부 자식 PK면 식별 관계다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint, PRIMARY KEY (MBR_NO));
      CREATE TABLE MBR_ROLE (
        MBR_NO bigint, ROLE_CD varchar(10),
        PRIMARY KEY (MBR_NO, ROLE_CD),
        FOREIGN KEY (MBR_NO) REFERENCES MBR (MBR_NO)
      );`)
    expect(p.relationships[0]!.identifying).toBe(true)
  })

  it('코멘트를 논리명으로 쓰고 첫 구분자에서 한 번만 쪼갠다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint);
      COMMENT ON TABLE MBR IS '회원';
      COMMENT ON COLUMN MBR.MBR_NO IS '회원번호 - 앞 - 뒤';`)
    expect(p.tables[0]!.logicalName).toBe('회원')
    expect(p.tables[0]!.columns[0]).toMatchObject({ logicalName: '회원번호', comment: '앞 - 뒤' })
    expect(p.warnings.filter((w) => w.kind === 'unknown-word')).toEqual([])
  })

  it('구분자가 없는 코멘트는 전체가 논리명이고 설명은 null이다', () => {
    const p = plan("CREATE TABLE MBR (MBR_NO bigint);\nCOMMENT ON COLUMN MBR.MBR_NO IS '회원번호';")
    expect(p.tables[0]!.columns[0]).toMatchObject({ logicalName: '회원번호', comment: null })
  })

  it('코멘트가 없으면 사전으로 역매칭한다', () => {
    const words: Record<string, Word> = {
      w1: { id: 'w1', logicalName: '회원', abbreviation: 'MBR', englishName: null, description: null, origin: null },
      w2: { id: 'w2', logicalName: '번호', abbreviation: 'NO', englishName: null, description: null, origin: null },
    }
    const model = { ...createEmptyModel(), words }
    const p = plan('CREATE TABLE MBR (MBR_NO bigint);', model)
    expect(p.tables[0]!.columns[0]!.logicalName).toBe('회원번호')
  })

  it('코멘트도 사전도 없으면 물리명을 논리명으로 두고 경고한다', () => {
    const p = plan('CREATE TABLE MBR (MBR_NO bigint);')
    expect(p.tables[0]!.columns[0]!.logicalName).toBe('MBR_NO')
    expect(p.warnings.some((w) => w.kind === 'unknown-word' && w.target === 'MBR.MBR_NO')).toBe(true)
  })

  it('이름이 겹치는 테이블을 건너뛰고 그 테이블을 참조하는 FK도 뺀다', () => {
    const model = createEmptyModel()
    model.tables['t1'] = {
      id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint);
      CREATE TABLE ORD (MBR_NO bigint, FOREIGN KEY (MBR_NO) REFERENCES MBR (MBR_NO));`, model)
    expect(p.skippedTables).toEqual(['MBR'])
    expect(p.tables.map((t) => t.physicalName)).toEqual(['ORD'])
    expect(p.relationships).toEqual([])
    expect(p.warnings.some((w) => w.kind === 'table-conflict' && w.target === 'MBR')).toBe(true)
    expect(p.warnings.some((w) => w.kind === 'unresolved-fk')).toBe(true)
  })

  it('참조 컬럼을 생략한 FK는 부모 PK로 해석한다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint, PRIMARY KEY (MBR_NO));
      CREATE TABLE ORD (MBR_NO bigint, FOREIGN KEY (MBR_NO) REFERENCES MBR ON DELETE CASCADE);`)
    expect(p.relationships).toEqual([{
      childPhysicalName: 'ORD', parentPhysicalName: 'MBR',
      columnPairs: [{ child: 'MBR_NO', parent: 'MBR_NO' }], identifying: false,
    }])
    expect(p.warnings.some((w) => w.kind === 'unresolved-fk')).toBe(false)
  })

  it('참조 컬럼을 생략했는데 부모에 PK가 없으면 관계를 만들지 않고 경고한다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint);
      CREATE TABLE ORD (MBR_NO bigint, FOREIGN KEY (MBR_NO) REFERENCES MBR);`)
    expect(p.relationships).toEqual([])
    expect(p.warnings.some((w) => w.kind === 'unresolved-fk' && w.message.includes('참조 컬럼'))).toBe(true)
  })

  it('참조 대상이 없는 FK를 경고한다', () => {
    const p = plan('CREATE TABLE ORD (X bigint, FOREIGN KEY (X) REFERENCES NOPE (X));')
    expect(p.relationships).toEqual([])
    expect(p.warnings.some((w) => w.kind === 'unresolved-fk' && w.target === 'ORD')).toBe(true)
  })

  it('PK와 컬럼이 정확히 같은 유니크 인덱스는 만들지도 경고하지도 않는다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint, PRIMARY KEY (MBR_NO));
      CREATE UNIQUE INDEX PK_MBR ON MBR (MBR_NO);`)
    expect(p.tables[0]!.indexes).toEqual([])
    // 사전이 비어 unknown-word 경고는 나온다. 인덱스에 대한 경고만 없어야 한다.
    expect(p.warnings.some((w) => w.target.includes('PK_MBR'))).toBe(false)
  })

  it('PK와 겹치지만 일치하지 않는 유니크 인덱스는 만든다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint, MBR_NM varchar(10), PRIMARY KEY (MBR_NO));
      CREATE UNIQUE INDEX UX_MBR ON MBR (MBR_NO, MBR_NM);`)
    expect(p.tables[0]!.indexes).toHaveLength(1)
  })

  it('모호한 타입과 인식 실패를 각각 경고한다', () => {
    // CLOB→TEXT(대안 JSON) 모호 규칙은 오라클 전용(dialect.ts fromOracle)이다. 기본값인
    // postgresql로는 CLOB이 알려진 타입이 아니라 unknown-type이 나므로 방언을 명시한다.
    const p = plan('CREATE TABLE A (C1 CLOB, C2 GEOMETRY);', createEmptyModel(), 'oracle')
    expect(p.tables[0]!.columns[0]).toMatchObject({ type: 'TEXT' })
    expect(p.tables[0]!.columns[1]).toMatchObject({ type: 'GEOMETRY' })   // 원문 보존
    expect(p.warnings.some((w) => w.kind === 'ambiguous-type' && w.target === 'A.C1')).toBe(true)
    expect(p.warnings.some((w) => w.kind === 'unknown-type' && w.target === 'A.C2')).toBe(true)
  })

  it('건너뛴 문장을 경고로 옮긴다', () => {
    const p = plan('GRANT SELECT ON A TO B;')
    expect(p.warnings.some((w) => w.kind === 'skipped-statement' && w.target === '1행')).toBe(true)
  })

  it('opCountEstimate가 실제 만들 엔티티 수와 맞는다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint, MBR_NM varchar(10), PRIMARY KEY (MBR_NO));
      CREATE INDEX IX ON MBR (MBR_NM);`)
    // 테이블 1 + 컬럼 2 + 인덱스 1 + 관계 0
    expect(p.opCountEstimate).toBe(4)
  })
})

/** 도메인·허용값을 쓰지 않는 왕복 픽스처. */
function roundTripModel(): ProjectModel {
  const m = createEmptyModel()
  m.tables['t1'] = {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c2'] = {
    id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
    type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: true,
    defaultValue: null, order: 1, comment: '표시용 이름', domainId: null, custom: {},
  }
  return m
}

function assertRoundTrip(dialect: Dialect): void {
  const model = roundTripModel()
  const ddl = generateDdl(model, dialect)
  const p = planDdlImport(createEmptyModel(), parseDdl(ddl), dialect, DEFAULT_NAMING_RULES)

  expect(p.tables).toHaveLength(1)
  const t = p.tables[0]!
  expect(t.physicalName).toBe('MBR')
  expect(t.logicalName).toBe('회원')
  expect(t.columns.map((c) => c.physicalName)).toEqual(['MBR_NO', 'MBR_NM'])
  expect(t.columns[0]).toMatchObject({
    logicalName: '회원번호', type: 'BIGINT', isPk: true, nullable: false,
  })
  expect(t.columns[1]).toMatchObject({
    logicalName: '회원명', type: 'VARCHAR(100)', isPk: false, nullable: true,
    comment: '표시용 이름',
  })
}

describe('왕복 — 내보낸 DDL을 다시 읽으면 같은 계획이 나온다', () => {
  for (const dialect of DIALECTS.filter((d) => d !== 'mssql')) {
    it(`${dialect}`, () => { assertRoundTrip(dialect) })
  }

  it('mssql — 코멘트가 sp_addextendedproperty로 나가 논리명이 복원되지 않는다(알려진 한계)', () => {
    // EXEC sys.sp_addextendedproperty는 파싱 범위 밖이다(설계 §3). 코멘트가 없으므로
    // 논리명은 사전 → 물리명 순으로 떨어지고, 구조(테이블·컬럼·타입·PK)는 정상 왕복한다.
    const model = roundTripModel()
    const ddl = generateDdl(model, 'mssql')
    const p = planDdlImport(createEmptyModel(), parseDdl(ddl), 'mssql', DEFAULT_NAMING_RULES)

    const t = p.tables[0]!
    expect(t.physicalName).toBe('MBR')
    expect(t.columns.map((c) => c.physicalName)).toEqual(['MBR_NO', 'MBR_NM'])
    expect(t.columns[0]).toMatchObject({ type: 'BIGINT', isPk: true, nullable: false })
    expect(t.columns[1]).toMatchObject({ type: 'VARCHAR(100)', nullable: true })
    // 논리명은 물리명으로 떨어지고 경고가 남는다.
    expect(t.logicalName).toBe('MBR')
    expect(p.warnings.some((w) => w.kind === 'unknown-word')).toBe(true)
  })
})
