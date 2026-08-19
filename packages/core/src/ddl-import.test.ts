import { describe, expect, it } from 'vitest'
import { createEmptyModel } from './model.js'
import { buildSampleModel } from './testing/fixtures.js'
import { DEFAULT_NAMING_RULES } from './naming.js'
import { parseDdl } from './ddl-parse.js'
import { planDdlImport } from './ddl-import.js'
import { generateDdl as generateDdlRaw, type DdlScope } from './ddl.js'
import { generateDbml as generateDbmlRaw } from './dbml.js'
import { parseDbml } from './dbml-parse.js'
import { DIALECTS, type Dialect } from './dialect.js'
import type { NamingRules } from './naming.js'
import type { ProjectModel, Word } from './model.js'
import type { ParsedDdl } from './ddl-parse.js'
import type { ParsedDbml } from './dbml-parse.js'

// 이 파일의 기존 케이스는 「템플릿 없는 규칙」을 전제한다 — 심으로 그 전제를 한 줄에 적는다.
const generateDdl = (
  model: ProjectModel, dialect: Dialect,
  scope: DdlScope = { kind: 'all' }, rules: NamingRules = DEFAULT_NAMING_RULES,
) => generateDdlRaw(model, dialect, scope, rules)

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
      cardinality: '1:N', name: null,
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
    // 복원된 논리명은 프로젝트의 논리명 구분자 형식으로 들어온다(설계 D2 — 저장값 자체에
    // 구분자가 든다). DDL 경로는 논리명을 그대로 실을 뿐이라 코드는 그대로고 값만 바뀐다.
    expect(p.tables[0]!.columns[0]!.logicalName).toBe('회원_번호')
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
    // ⚠️ 문구까지 못 박는다 — 머릿말이 이름을 되돌린 경우와 갈라야 하는 자리다.
    expect(p.warnings).toContainEqual({
      kind: 'table-conflict', target: 'MBR',
      message: '같은 이름의 테이블이 이미 있어 건너뜁니다',
    })
    expect(p.warnings.some((w) => w.kind === 'unresolved-fk')).toBe(true)
  })

  it('참조 컬럼을 생략한 FK는 부모 PK로 해석한다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint, PRIMARY KEY (MBR_NO));
      CREATE TABLE ORD (MBR_NO bigint, FOREIGN KEY (MBR_NO) REFERENCES MBR ON DELETE CASCADE);`)
    expect(p.relationships).toEqual([{
      childPhysicalName: 'ORD', parentPhysicalName: 'MBR',
      columnPairs: [{ child: 'MBR_NO', parent: 'MBR_NO' }], identifying: false,
      cardinality: '1:N', name: null,
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

  // I-3: 계획이 내보내는 인덱스·관계의 컬럼 이름은 실제 컬럼 physicalName으로 정규화돼야
  // 한다 — 그래야 ddl-import-edits.ts의 columnIdByKey.get(...)! 가 참인 불변식이 된다.
  it('인덱스 컬럼 이름의 대소문자가 달라도 실제 컬럼으로 정규화한다', () => {
    const p = plan(`
      CREATE TABLE mbr (mbr_no bigint, mbr_nm varchar(10));
      CREATE INDEX IX ON MBR (MBR_NM);`)
    expect(p.tables[0]!.indexes).toEqual([
      { name: 'IX', columnPhysicalNames: ['mbr_nm'], unique: false },
    ])
    expect(p.warnings.some((w) => w.kind === 'unresolved-index')).toBe(false)
  })

  it('참조 컬럼 생략 FK의 부모 PK 표기가 컬럼 정의와 대소문자만 달라도 해소한다', () => {
    const p = plan(`
      CREATE TABLE mbr (mbr_no bigint, PRIMARY KEY (MBR_NO));
      CREATE TABLE ord (mbr_no bigint, FOREIGN KEY (MBR_NO) REFERENCES MBR);`)
    expect(p.relationships).toEqual([{
      childPhysicalName: 'ord', parentPhysicalName: 'mbr',
      columnPairs: [{ child: 'mbr_no', parent: 'mbr_no' }], identifying: false,
      cardinality: '1:N', name: null,
    }])
  })

  it('존재하지 않는 컬럼을 가리키는 인덱스는 만들지 않고 경고한다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint);
      CREATE INDEX IX ON MBR (NOPE);`)
    expect(p.tables[0]!.indexes).toEqual([])
    expect(p.warnings.some((w) => w.kind === 'unresolved-index' && w.message.includes('NOPE'))).toBe(true)
  })

  it('존재하지 않는 부모 컬럼을 가리키는 FK는 만들지 않고 경고한다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint);
      CREATE TABLE ORD (X bigint, FOREIGN KEY (X) REFERENCES MBR (NOPE));`)
    expect(p.relationships).toEqual([])
    expect(p.warnings.some((w) => w.kind === 'unresolved-fk')).toBe(true)
  })

  it('함수 인덱스처럼 컬럼이 아닌 표현식은 인덱스를 만들지 않고 경고한다', () => {
    const p = plan(`
      CREATE TABLE MBR (NM varchar(10));
      CREATE INDEX IX ON MBR (LOWER(NM));`)
    expect(p.tables[0]!.indexes).toEqual([])
    expect(p.warnings.some((w) => w.kind === 'unresolved-index')).toBe(true)
  })

  // I-2(a): UNIQUE 제약을 유니크 인덱스로 합류시킨다.
  it('UNIQUE 제약을 유니크 인덱스로 만든다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint, MBR_NM varchar(10), PRIMARY KEY (MBR_NO));
      ALTER TABLE MBR ADD CONSTRAINT UX_MBR UNIQUE (MBR_NM);`)
    expect(p.tables[0]!.indexes).toContainEqual({
      name: 'UX_MBR', columnPhysicalNames: ['MBR_NM'], unique: true,
    })
  })

  it('PK와 컬럼이 같은 UNIQUE 제약은 조용히 제외한다', () => {
    const p = plan(`
      CREATE TABLE MBR (MBR_NO bigint, PRIMARY KEY (MBR_NO));
      ALTER TABLE MBR ADD CONSTRAINT UX_MBR UNIQUE (MBR_NO);`)
    expect(p.tables[0]!.indexes).toEqual([])
  })

  it('이름 없는 UNIQUE 제약에 이름을 붙인다', () => {
    const p = plan('CREATE TABLE MBR (A bigint, B bigint, UNIQUE (A), UNIQUE (B));')
    const names = p.tables[0]!.indexes.map((i) => i.name)
    expect(names).toHaveLength(2)
    expect(new Set(names).size).toBe(2)   // 서로 다른 이름
  })

  // I-2(b): alive에 없는 테이블의 인덱스를 조용히 버리지 않고 경고한다.
  it('소속 테이블이 없는 인덱스를 경고한다', () => {
    const p = plan('CREATE INDEX IX ON NOPE (X);')
    expect(p.warnings.some((w) => w.kind === 'unresolved-index')).toBe(true)
  })

  // ALTER TABLE로 오는 UNIQUE 제약은 CREATE TABLE이 없는 테이블을 가리킬 수 있다.
  // 인덱스와 같은 결함 클래스이므로 같은 규칙(조용히 버리지 않고 경고)이 적용돼야 한다.
  it('소속 테이블이 없는 UNIQUE 제약을 경고한다', () => {
    const p = plan(`
      CREATE TABLE ORD (X bigint);
      ALTER TABLE NOPE ADD CONSTRAINT UX1 UNIQUE (X);`)
    expect(p.tables[0]!.indexes).toEqual([])
    expect(p.warnings.some((w) => w.kind === 'unresolved-index' && w.target === 'NOPE.UX1')).toBe(true)
  })

  // I-2(c): 같은 이름의 CREATE TABLE이 두 번 오면 뒤엣것을 버리고 경고한다.
  // ⚠️ 문구까지 못 박는다 — 만들어질 이름이 겹치는 사유는 둘이고(진짜 중복 / 머릿말 복원이
  // 겹침) 각자 다른 문구를 내야 한다. kind 만 보면 두 갈래가 뒤바뀌어도 초록이다.
  it('DDL에 같은 이름의 테이블이 두 번 오면 뒤엣것을 건너뛰고 경고한다', () => {
    const p = plan(`
      CREATE TABLE MBR (A bigint);
      CREATE TABLE MBR (B bigint);`)
    expect(p.tables).toHaveLength(1)
    expect(p.tables[0]!.columns.map((c) => c.physicalName)).toEqual(['A'])
    expect(p.warnings).toContainEqual({
      kind: 'table-conflict', target: 'MBR',
      message: 'DDL에 같은 이름의 테이블이 두 번 있어 뒤엣것을 건너뜁니다',
    })
  })

  // A-2: 이 사유도 skippedTables 에 담긴다 — 기존 테이블과 부딪히는 쪽만 세면 미리보기의
  // 「건너뜀 N개」 가 같은 자리에서 어떤 건너뜀은 세고 어떤 건너뜀은 안 세게 된다.
  it('DDL에 같은 이름의 테이블이 두 번 오면 뒤엣것의 이름이 skippedTables 에 들어간다', () => {
    const p = plan(`
      CREATE TABLE MBR (A bigint);
      CREATE TABLE MBR (B bigint);`)
    expect(p.skippedTables).toEqual(['MBR'])
  })

  // I-4: 테이블 코멘트의 설명 부분이 계획에서 보존돼야 한다.
  it('테이블 코멘트의 설명 부분을 보존한다', () => {
    const p = plan("CREATE TABLE MBR (A bigint);\nCOMMENT ON TABLE MBR IS '회원 - 회원 기본 정보';")
    expect(p.tables[0]).toMatchObject({ logicalName: '회원', comment: '회원 기본 정보' })
  })
})

/**
 * 왕복 픽스처. 도메인·허용값은 여전히 쓰지 않는다(설계 §2 — 범위의 경계).
 * 부모(MBR)·자식(ORD) 테이블과 그 사이 관계 1개, PK와 다른 컬럼의 인덱스 1개, 테이블
 * comment, autoIncrement 컬럼, defaultValue 컬럼을 포함한다 — 이 브랜치가 새로 만든
 * FK·인덱스·테이블 코멘트 경로가 왕복에서 실제로 실행되게 하기 위해서다.
 */
function roundTripModel(): ProjectModel {
  const m = createEmptyModel()
  m.tables['t1'] = {
    id: 't1', logicalName: '회원', physicalName: 'MBR', comment: '회원 기본 정보',
    groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
  }
  m.tables['t2'] = {
    id: 't2', logicalName: '주문', physicalName: 'ORD', comment: null,
    groupId: null, position: { x: 300, y: 0 }, groupPosition: null, custom: {},
  }
  m.columns['c1'] = {
    id: 'c1', tableId: 't1', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c2'] = {
    id: 'c2', tableId: 't1', logicalName: '회원명', physicalName: 'MBR_NM',
    type: 'VARCHAR(100)', isPk: false, autoIncrement: false, nullable: true,
    defaultValue: null, order: 1, comment: '표시용 이름', domainId: null, custom: {},
  }
  m.columns['c3'] = {
    id: 'c3', tableId: 't2', logicalName: '주문번호', physicalName: 'ORD_NO',
    type: 'BIGINT', isPk: true, autoIncrement: false, nullable: false,
    defaultValue: null, order: 0, comment: null, domainId: null, custom: {},
  }
  m.columns['c4'] = {
    id: 'c4', tableId: 't2', logicalName: '회원번호', physicalName: 'MBR_NO',
    type: 'BIGINT', isPk: false, autoIncrement: false, nullable: false,
    defaultValue: null, order: 1, comment: null, domainId: null, custom: {},
  }
  m.columns['c5'] = {
    id: 'c5', tableId: 't2', logicalName: '주문상태', physicalName: 'ORD_STTUS',
    type: 'VARCHAR(20)', isPk: false, autoIncrement: false, nullable: false,
    defaultValue: "'PENDING'", order: 2, comment: null, domainId: null, custom: {},
  }
  m.indexes['ix1'] = {
    id: 'ix1', tableId: 't1', name: 'IX_MBR_NM', unique: false,
    columns: [{ columnId: 'c2', direction: 'asc' }],
  }
  m.relationships['r1'] = {
    id: 'r1', parentTableId: 't1', childTableId: 't2',
    columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
    cardinality: '1:N', identifying: false, name: null,
  }
  return m
}

function assertRoundTrip(dialect: Dialect): void {
  const model = roundTripModel()
  const ddl = generateDdl(model, dialect)
  const p = planDdlImport(createEmptyModel(), parseDdl(ddl), dialect, DEFAULT_NAMING_RULES)

  // 이 셋은 "미리보기가 통과시킨 걸 무결성 검사가 거절하는" I-3류 결함의 회귀 방어다.
  expect(p.warnings.filter((w) => w.kind === 'unresolved-index' || w.kind === 'unresolved-fk' || w.kind === 'table-conflict')).toEqual([])

  expect(p.tables).toHaveLength(2)
  const mbr = p.tables.find((t) => t.physicalName === 'MBR')!
  const ord = p.tables.find((t) => t.physicalName === 'ORD')!

  expect(mbr.logicalName).toBe('회원')
  expect(mbr.comment).toBe('회원 기본 정보')
  expect(mbr.columns.map((c) => c.physicalName)).toEqual(['MBR_NO', 'MBR_NM'])
  expect(mbr.columns[0]).toMatchObject({
    logicalName: '회원번호', type: 'BIGINT', isPk: true, nullable: false, autoIncrement: true,
  })
  expect(mbr.columns[1]).toMatchObject({
    logicalName: '회원명', type: 'VARCHAR(100)', isPk: false, nullable: true,
    comment: '표시용 이름',
  })
  expect(mbr.indexes).toEqual([{ name: 'IX_MBR_NM', columnPhysicalNames: ['MBR_NM'], unique: false }])

  expect(ord.logicalName).toBe('주문')
  expect(ord.columns.map((c) => c.physicalName)).toEqual(['ORD_NO', 'MBR_NO', 'ORD_STTUS'])
  expect(ord.columns[2]).toMatchObject({ defaultValue: "'PENDING'" })

  expect(p.relationships).toEqual([{
    childPhysicalName: 'ORD', parentPhysicalName: 'MBR',
    columnPairs: [{ child: 'MBR_NO', parent: 'MBR_NO' }], identifying: false,
    cardinality: '1:N', name: null,
  }])
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

describe('planDdlImport — 컬럼 인라인 제약', () => {
  it('참조 컬럼을 생략한 인라인 FK를 부모 PK로 해소해 관계를 만든다', () => {
    const p = plan(`
      create table organizations (id uuid not null primary key, name text not null);
      create table members
      (
          id     uuid not null
              primary key,
          org_id uuid not null
              constraint members_org_id_organizations_id_fk
                  references organizations
                  on delete cascade
      );`)
    expect(p.relationships).toEqual([{
      childPhysicalName: 'members', parentPhysicalName: 'organizations',
      columnPairs: [{ child: 'org_id', parent: 'id' }], identifying: false,
      cardinality: '1:N', name: null,
    }])
    expect(p.warnings.filter((w) => w.kind === 'unresolved-fk')).toEqual([])
  })

  it('컬럼 인라인 UNIQUE를 유니크 인덱스로 만들고 DDL에 적힌 제약명을 쓴다', () => {
    const p = plan(`
      create table users
      (
          id    uuid not null
              primary key,
          email text not null
              constraint users_email_unique
                  unique
      );`)
    expect(p.tables[0]!.indexes).toEqual([
      { name: 'users_email_unique', columnPhysicalNames: ['email'], unique: true },
    ])
  })

  it('이름 없는 컬럼 인라인 UNIQUE는 자동 이름을 받는다', () => {
    const p = plan('create table users (id uuid not null primary key, email text not null unique);')
    expect(p.tables[0]!.indexes).toEqual([
      { name: 'UX_users_1', columnPhysicalNames: ['email'], unique: true },
    ])
  })
})

describe('planDdlImport — DBML 확장 필드', () => {
  const parsedOf = (over: Partial<ParsedDbml>): ParsedDbml => ({
    tables: [{ name: 'MBR', columns: [{
      name: 'MBR_NO', rawType: 'bigint', notNull: true, defaultValue: null,
      autoIncrement: false, inlinePk: true, comment: null,
    }] }],
    constraints: [], indexes: [], comments: [], skipped: [],
    groups: [], customValues: [], databaseType: null,
    ...over,
  })

  it('그룹을 계획에 싣는다', () => {
    const p = planDdlImport(
      createEmptyModel(),
      parsedOf({ groups: [{ name: '회원 관리', color: '#0E7A6C', comment: null, tables: ['MBR'] }] }),
      'postgresql', DEFAULT_NAMING_RULES,
    )
    expect(p.groups).toEqual([{
      // 블록만 있는 경로다 — 별칭은 머릿말에만 실려 오므로 빈 문자열이어야 한다.
      name: '회원 관리', color: '#0E7A6C', comment: null, alias: '',
      tablePhysicalNames: ['MBR'], existingId: null,
    }])
  })

  it('같은 이름의 그룹이 있으면 existingId 를 채운다', () => {
    const m = createEmptyModel()
    m.tableGroups['g1'] = { id: 'g1', name: '회원 관리', color: '#111', comment: null, alias: '' }
    const p = planDdlImport(
      m, parsedOf({ groups: [{ name: '회원 관리', color: '#0E7A6C', comment: null, tables: ['MBR'] }] }),
      'postgresql', DEFAULT_NAMING_RULES,
    )
    expect(p.groups[0]!.existingId).toBe('g1')
  })

  it('건너뛴 테이블은 그룹 목록에서도 빠진다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = {
      id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const p = planDdlImport(
      m, parsedOf({ groups: [{ name: '회원 관리', color: null, comment: null, tables: ['MBR'] }] }),
      'postgresql', DEFAULT_NAMING_RULES,
    )
    expect(p.groups).toEqual([])
  })

  it('그룹 수가 opCountEstimate 에 더해진다', () => {
    const withGroup = planDdlImport(
      createEmptyModel(),
      parsedOf({ groups: [{ name: 'G', color: null, comment: null, tables: ['MBR'] }] }),
      'postgresql', DEFAULT_NAMING_RULES,
    )
    const without = planDdlImport(createEmptyModel(), parsedOf({}), 'postgresql', DEFAULT_NAMING_RULES)
    expect(withGroup.opCountEstimate).toBe(without.opCountEstimate + 1)
  })

  it('커스텀 값을 정의 id 키로 옮긴다', () => {
    const m = createEmptyModel()
    m.customFields['f1'] = {
      id: 'f1', name: '보안등급', target: 'table', type: 'text', options: [],
      required: false, defaultValue: null, order: 0, origin: null,
    }
    const p = planDdlImport(
      m, parsedOf({ customValues: [{ table: 'MBR', column: null, values: { 보안등급: '2' } }] }),
      'postgresql', DEFAULT_NAMING_RULES,
    )
    expect(p.tables[0]!.custom).toEqual({ f1: '2' })
  })

  it('정의를 못 찾은 키는 버리고 경고한다', () => {
    const p = planDdlImport(
      createEmptyModel(),
      parsedOf({ customValues: [{ table: 'MBR', column: null, values: { 없는항목: 'x' } }] }),
      'postgresql', DEFAULT_NAMING_RULES,
    )
    expect(p.tables[0]!.custom).toEqual({})
    expect(p.warnings).toContainEqual({
      kind: 'unknown-custom-field', target: 'MBR',
      message: '커스텀 항목 정의가 없어 "없는항목" 값을 버렸습니다',
    })
  })

  it('oneToOne 인 FK 는 cardinality 1:1 이 된다', () => {
    const parsed = parsedOf({
      tables: [
        { name: 'MBR', columns: [{ name: 'MBR_NO', rawType: 'bigint', notNull: true,
          defaultValue: null, autoIncrement: false, inlinePk: true, comment: null }] },
        { name: 'ORD', columns: [{ name: 'MBR_NO', rawType: 'bigint', notNull: true,
          defaultValue: null, autoIncrement: false, inlinePk: false, comment: null }] },
      ],
      constraints: [{
        kind: 'fk', table: 'ORD', name: 'FK_ORD_MBR', columns: ['MBR_NO'],
        refTable: 'MBR', refColumns: ['MBR_NO'], oneToOne: true,
      }],
    })
    const p = planDdlImport(createEmptyModel(), parsed, 'postgresql', DEFAULT_NAMING_RULES)
    expect(p.relationships[0]).toMatchObject({ cardinality: '1:1', name: 'FK_ORD_MBR' })
  })

  it('DDL 경로(확장 필드 없음)는 1:N·이름 null 이다', () => {
    const parsed: ParsedDdl = {
      tables: parsedOf({}).tables, constraints: [], indexes: [], comments: [], skipped: [],
    }
    const p = planDdlImport(createEmptyModel(), parsed, 'postgresql', DEFAULT_NAMING_RULES)
    expect(p.groups).toEqual([])
    expect(p.tables[0]!.custom).toEqual({})
  })

  // ⚠️ 물리명 사이클의 D2(왕복이 깨진 채로 둔다)를 **뒤집은 자리**다. 역분해는 여전히 하지 않는다 —
  // 내보낼 때 머릿말에 부분을 적어 두고 읽을 때 그대로 쓴다.
  it('머릿말이 있으면 부분이 복원된다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
    const ddl = generateDdlRaw(m, 'postgresql', { kind: 'all' }, rules)
    const imported = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.tables.map((t) => t.physicalName).sort()).toEqual(['MBR', 'MBR_GRD'])
  })

  // ⚠️ 조회 키 정규화(설계 3.1)를 잠근다. 저장소의 다른 케이스는 전부 UPPER_SNAKE 물리명이라
  // `upper(raw) === raw` 가 항상 참이어서 `metaOf` 의 `upper()` 가 한 번도 시험되지 않는다.
  // 머릿말은 조합 이름을 **원문 그대로**(소문자로) 적고 조회 키만 대문자로 색인하므로,
  // 그 정규화가 빠지면 lower_snake 프로젝트의 자기 왕복이 조용히 복원에 실패한다.
  it('lower_snake 프로젝트도 머릿말로 부분이 복원된다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'mbr' }
    m.tables['t1'] = { ...m.tables['t1']!, physicalName: 'mbr_grd' }
    m.tables['t2'] = { ...m.tables['t2']!, physicalName: 'mbr' }
    const rules: NamingRules = {
      ...DEFAULT_NAMING_RULES, case: 'lower_snake',
      tablePhysicalTemplate: 'tb_{그룹별칭}_{물리명}',
    }
    const ddl = generateDdlRaw(m, 'postgresql', { kind: 'all' }, rules)
    expect(ddl).toContain('"tb_mbr_mbr":')          // 머릿말의 키는 소문자 원문이다
    const imported = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.tables.map((t) => t.physicalName).sort()).toEqual(['mbr', 'mbr_grd'])
  })

  // ⚠️ 관계·인덱스는 DDL 원문 이름으로 테이블을 가리킨다 — 복원된 부분 이름으로 다시 맞춰지지
  // 않으면 편집 적용부(`tableIdByName.get(...)!`)가 undefined 를 잡아 조용히 깨진다.
  it('복원된 뒤에도 관계·인덱스가 테이블에 붙는다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
    const ddl = generateDdlRaw(m, 'postgresql', { kind: 'all' }, rules)
    const imported = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.relationships).toHaveLength(1)
    expect(imported.relationships[0]).toMatchObject({
      childPhysicalName: 'MBR', parentPhysicalName: 'MBR_GRD',
    })
    const mbr = imported.tables.find((t) => t.physicalName === 'MBR')!
    expect(mbr.indexes.map((ix) => ix.name)).toEqual(['UX_MBR_01'])
  })

  // ⚠️ 남의 DDL(머릿말 없음)은 지금까지의 동작 그대로다 — 통째로 부분이 된다.
  it('머릿말이 없으면 조합된 이름이 통째로 부분이 된다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
    const ddl = generateDdlRaw(m, 'postgresql', { kind: 'all' }, rules)
      .split('\n').filter((l) => !l.startsWith('-- erdd:')).join('\n')   // 머릿말만 떼어낸다
    const imported = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.tables.map((t) => t.physicalName).sort())
      .toEqual(['TB_MBR_MBR', 'TB_MBR_MBR_GRD'])
  })

  it('두 번 왕복해도 접두가 겹치지 않는다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
    const once = generateDdlRaw(m, 'postgresql', { kind: 'all' }, rules)
    const back = planDdlImport(createEmptyModel(), parseDdl(once), 'postgresql', DEFAULT_NAMING_RULES)
    expect(back.tables.map((t) => t.physicalName).sort()).toEqual(['MBR', 'MBR_GRD'])
    expect(once).not.toContain('TB_MBR_TB_MBR_')
  })

  // ⚠️ 설계 D5 — 논리명은 메타가 코멘트를 이기고, 설명은 코멘트에서 온다.
  it('논리명은 메타가 이기고 설명은 코멘트에서 온다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, name: 'SALES', alias: 'MBR' }
    const rules = {
      ...DEFAULT_NAMING_RULES,
      tablePhysicalTemplate: 'TB_{물리명}',
      tableLogicalTemplate: '{그룹명}_{논리명}',
    }
    const ddl = generateDdlRaw(m, 'postgresql', { kind: 'all' }, rules)
    const imported = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    const mbr = imported.tables.find((t) => t.physicalName === 'MBR')!
    expect(mbr.logicalName).toBe('회원')                 // 'SALES_회원' 이 아니다
    expect(mbr.comment).toBe('서비스 가입 회원')          // 설명은 코멘트에서 그대로
  })

  // ⚠️ 설계 D6 — 사용자가 DDL 의 이름을 손으로 고치면 키가 안 맞아 현행 동작으로 떨어진다.
  it('메타 키가 실제 이름과 안 맞으면 현행 동작으로 떨어진다', () => {
    const ddl = [
      '-- erdd:v1 {"TB_MBR_ORD":{"p":"ORD","l":"주문"}}',
      'CREATE TABLE TB_MBR_ORDER (ID BIGINT NOT NULL);',
    ].join('\n')
    const imported = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.tables[0]!.physicalName).toBe('TB_MBR_ORDER')
  })

  it('DBML 도 머릿말로 부분이 복원된다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
    const dbml = generateDbmlRaw(m, 'postgresql', { kind: 'all' }, {}, rules)
    const imported = planDdlImport(createEmptyModel(), parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.tables.map((t) => t.physicalName).sort()).toEqual(['MBR', 'MBR_GRD'])
    // 그룹 소속도 복원된 이름으로 맞춰진다.
    expect(imported.groups[0]!.tablePhysicalNames.sort()).toEqual(['MBR', 'MBR_GRD'])
  })

  // ⚠️ 계획에 없던 자리다. 복원을 넣으면 **만들어질 이름**이 달라지므로 충돌 판정도 그것으로
  // 봐야 한다 — DDL 원문 이름으로 보면 모델의 기존 ORD 와 부딪히는 것을 놓쳐 같은 물리명이
  // 둘 생긴다.
  it('복원된 이름이 기존 테이블과 부딪히면 건너뛴다', () => {
    const m = createEmptyModel()
    m.tables['t1'] = {
      id: 't1', logicalName: '주문', physicalName: 'ORD', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const ddl = [
      '-- erdd:v1 {"TB_MBR_ORD":{"p":"ORD","l":"주문"}}',
      'CREATE TABLE TB_MBR_ORD (ID BIGINT NOT NULL);',
    ].join('\n')
    const imported = planDdlImport(m, parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.tables).toEqual([])
    expect(imported.skippedTables).toEqual(['TB_MBR_ORD'])
    // ⚠️ 문구가 **두 이름을 함께** 적어야 한다. 모델에 있는 것은 ORD 이고 DDL 에 있는 것은
    // TB_MBR_ORD 라, 「같은 이름의 테이블이 이미 있어」만 적으면 사용자가 사이드바에서
    // TB_MBR_ORD 를 찾다 못 찾고 경고를 거짓으로 판단한다(브라우저 스모크에서 실제 관측).
    expect(imported.warnings).toContainEqual({
      kind: 'table-conflict', target: 'TB_MBR_ORD',
      message: '머릿말이 TB_MBR_ORD을 ORD로 되돌렸는데 그 이름의 테이블이 이미 있어 건너뜁니다',
    })
    expect(imported.warnings.map((w) => w.message)).not.toContain('같은 이름의 테이블이 이미 있어 건너뜁니다')
  })

  // ⚠️ **관찰을 고정하는 테스트다. 「이 동작이 옳다」는 뜻이 아니다.**
  // 그룹이 다른 두 테이블은 부분이 같아도(`ORD`) 조합 이름이 갈려 원본 프로젝트에서는 중복이
  // 아니다. 그런데 가져오기는 그룹을 복원하지 않으므로(설계 D2) 둘 다 부분 `ORD` 로 복원되고,
  // 「만들어질 이름」 충돌 판정에 걸려 **뒤엣것이 통째로 빠진다**(컬럼·인덱스·관계까지).
  // 관찰된 사실 셋을 그대로 못 박는다 — 동작을 바꾸면 여기가 빨개져 재검토를 강제한다.
  it('다른 그룹의 두 테이블이 같은 부분으로 복원되면 뒤엣것이 빠진다', () => {
    const ddl = [
      '-- erdd:v1 {"TB_MBR_ORD":{"p":"ORD","l":"회원주문"},"TB_PRD_ORD":{"p":"ORD","l":"상품주문"}}',
      'CREATE TABLE TB_MBR_ORD (ID BIGINT NOT NULL, PRIMARY KEY (ID));',
      'CREATE TABLE TB_PRD_ORD (ID BIGINT NOT NULL, QTY BIGINT, PRIMARY KEY (ID));',
    ].join('\n')
    const p2 = planDdlImport(createEmptyModel(), parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)

    // (1) 앞엣것만 남는다. 뒤엣것의 QTY 컬럼은 계획에 없다.
    expect(p2.tables.map((t) => t.physicalName)).toEqual(['ORD'])
    expect(p2.tables[0]!.logicalName).toBe('회원주문')
    expect(p2.tables[0]!.columns.map((c) => c.physicalName)).toEqual(['ID'])

    // (2) 경고 문구가 **이 사유 전용**이다. DDL 의 두 이름은 서로 다르므로(TB_MBR_ORD ·
    //     TB_PRD_ORD) 「같은 이름이 두 번」이라고 하면 원문을 열어 본 사용자가 문구가 틀렸다고
    //     판단해 넘긴다. target 은 DDL 원문 이름이다 — 사용자가 입력에서 찾을 수 있는 이름은
    //     그것뿐이고(ORD 는 머릿말 JSON 밖에 안 나온다) skippedTables·형제 분기와도 같은 기준이다.
    expect(p2.warnings).toContainEqual({
      kind: 'table-conflict', target: 'TB_PRD_ORD',
      message: '머릿말이 TB_PRD_ORD을 ORD로 되돌렸는데 그 이름을 앞의 테이블이 이미 써서 건너뜁니다',
    })
    // 진짜 중복 CREATE TABLE 의 문구가 새지 않는다.
    expect(p2.warnings.map((w) => w.message)).not.toContain(
      'DDL에 같은 이름의 테이블이 두 번 있어 뒤엣것을 건너뜁니다',
    )

    // (3) skippedTables 에도 들어간다 — 사유가 무엇이든 건너뛴 테이블은 한 자리에서 센다.
    //     미리보기의 「건너뜀 N개」 줄에 이 건이 함께 보인다. 담기는 값은 DDL 원문 이름이다
    //     (되돌려진 ORD 를 담으면 사용자가 붙여넣은 원문에서 그 이름을 찾지 못한다).
    //     ⚠️ **이 한 줄이 「머릿말 되돌림 충돌로 건너뛴 것도 skippedTables 에 담긴다」의 유일한
    //     잠금이다.** 이 왕복 테이블을 재편하면서 부수적인 단언으로 보고 빼면 그 계약이 조용히
    //     풀린다 — 형제 분기(진짜 중복 CREATE TABLE)는 위쪽 A-2 가 따로 잠그지만 이쪽은 여기뿐이다.
    expect(p2.skippedTables).toEqual(['TB_PRD_ORD'])
  })

  // ⚠️ 설계 §4 가 요구한 나머지 한 짝 — DBML 도 머릿말이 없으면 옛 동작이다.
  it('DBML 도 머릿말이 없으면 조합된 이름이 통째로 부분이 된다', () => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR' }
    const rules = { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' }
    const dbml = generateDbmlRaw(m, 'postgresql', { kind: 'all' }, {}, rules)
      .split('\n').filter((l) => !l.startsWith('// erdd:')).join('\n')
    const imported = planDdlImport(createEmptyModel(), parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)
    expect(imported.tables.map((t) => t.physicalName).sort())
      .toEqual(['TB_MBR_MBR', 'TB_MBR_MBR_GRD'])
  })
})

describe('planDdlImport — 머릿말 그룹 복원', () => {
  /** 별칭·색·코멘트가 다 있는 그룹 하나에 테이블 둘이 든 모델. */
  const source = (): ProjectModel => {
    const m = buildSampleModel()
    m.tableGroups['g1'] = { ...m.tableGroups['g1']!, alias: 'MBR', comment: '회원 도메인' }
    return m
  }

  it('DDL 왕복에서 그룹과 별칭이 살아난다', () => {
    const sql = generateDdlRaw(source(), 'postgresql', { kind: 'all' },
      { ...DEFAULT_NAMING_RULES, tablePhysicalTemplate: 'TB_{그룹별칭}_{물리명}' })
    const p = planDdlImport(createEmptyModel(), parseDdl(sql), 'postgresql', DEFAULT_NAMING_RULES)

    expect(p.groups).toHaveLength(1)
    const g = p.groups[0]!
    expect(g.name).toBe('회원관리')
    expect(g.alias).toBe('MBR')
    expect(g.comment).toBe('회원 도메인')
    expect(g.color).toBe('#4A90D9')
    expect(new Set(g.tablePhysicalNames)).toEqual(new Set(['MBR', 'MBR_GRD']))
  })

  // ⚠️ D7 — 블록과 머릿말이 같은 그룹을 말하면 머릿말이 이긴다(별칭은 머릿말에만 있다).
  it('DBML 에서 블록과 머릿말이 겹치면 머릿말이 이긴다', () => {
    const dbml = [
      '// erdd:v2 {"t":{"MBR":{"p":"MBR","l":"회원","g":"회원관리"}},"g":{"회원관리":{"a":"MBR","c":"#4A90D9"}}}',
      'Table "MBR" {',
      '  "ID" bigint [pk]',
      '}',
      'TableGroup "회원관리" [color: #999999] {',
      '  MBR',
      '}',
    ].join('\n')
    const p = planDdlImport(createEmptyModel(), parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)
    expect(p.groups).toHaveLength(1)
    expect(p.groups[0]!.alias).toBe('MBR')
    expect(p.groups[0]!.color).toBe('#4A90D9')       // 블록의 #999999 가 아니다
  })

  // ⚠️ 남이 준 DBML 은 머릿말이 없다 — 블록만으로 지금처럼 동작한다.
  it('머릿말 없는 DBML 은 블록만으로 그룹을 만들고 별칭은 빈 문자열이다', () => {
    const dbml = [
      'Table "MBR" {',
      '  "ID" bigint [pk]',
      '}',
      'TableGroup "회원관리" [color: #999999] {',
      '  MBR',
      '}',
    ].join('\n')
    const p = planDdlImport(createEmptyModel(), parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)
    expect(p.groups).toHaveLength(1)
    expect(p.groups[0]!.color).toBe('#999999')
    expect(p.groups[0]!.alias).toBe('')
  })
})
