import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { DEFAULT_NAMING_RULES, type NamingRules } from './naming.js'
import { generateDbml as generateDbmlRaw } from './dbml.js'
import { parseDbml } from './dbml-parse.js'
import { planDdlImport } from './ddl-import.js'
import type { DdlScope } from './ddl.js'
import type { Dialect } from './dialect.js'

// 왕복 픽스처는 「템플릿 없는 규칙」을 전제한다 — 템플릿을 걸면 왕복이 깨진다(설계 D2).
const generateDbml = (
  model: ProjectModel, dialect: Dialect, scope: DdlScope = { kind: 'all' },
  opts: { projectName?: string } = {}, rules: NamingRules = DEFAULT_NAMING_RULES,
) => generateDbmlRaw(model, dialect, scope, opts, rules)

/**
 * 왕복 픽스처. PostgreSQL 로 돌린다 — 타입 매핑이 단사라 방언 충돌 5건
 * (2026-08-03-ddl-reverse-engineering-design.md §2)이 개입하지 않는다.
 * 도메인은 쓰지 않는다(설계 §7 — domainId 는 이 범위의 경계다).
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
  // 복합 PK + 합성 FK
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
  m.relationships['r1'] = {                       // 익명 1:N
    id: 'r1', parentTableId: 't1', childTableId: 't2',
    columnMappings: [{ childColumnId: 'c4', parentColumnId: 'c1' }],
    cardinality: '1:N', identifying: true, name: null,
  }
  m.relationships['r2'] = {                       // 이름 있는 1:1
    id: 'r2', parentTableId: 't1', childTableId: 't3',
    columnMappings: [{ childColumnId: 'c5', parentColumnId: 'c1' }],
    cardinality: '1:1', identifying: true, name: 'FK_MBR_DTL_MBR',
  }
  return m
}

describe('DBML 왕복 — 내보낸 것을 다시 읽으면 같은 계획이 나온다', () => {
  const model = roundTripModel()
  const dbml = generateDbml(model, 'postgresql', { kind: 'all' }, { projectName: '회원 시스템' })
  // 커스텀 항목 정의는 DBML 에 실리지 않으므로(설계 §1) 정의만 있는 빈 모델로 되읽는다.
  const target = createEmptyModel()
  target.customFields = model.customFields
  const plan = planDdlImport(target, parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)

  it('구조 경고가 없다', () => {
    expect(plan.warnings.filter(
      (w) => w.kind === 'unresolved-fk' || w.kind === 'unresolved-index'
          || w.kind === 'table-conflict' || w.kind === 'unknown-custom-field',
    )).toEqual([])
  })

  it('테이블·논리명·설명·커스텀이 왕복한다', () => {
    const mbr = plan.tables.find((t) => t.physicalName === 'MBR')!
    expect(mbr.logicalName).toBe('회원')
    expect(mbr.comment).toBe("it's 회원\n두 줄 설명")
    expect(mbr.custom).toEqual({ f1: '2' })
  })

  it('컬럼 타입·PK·기본값·커스텀이 왕복한다', () => {
    const mbr = plan.tables.find((t) => t.physicalName === 'MBR')!
    expect(mbr.columns[0]).toMatchObject({
      physicalName: 'MBR_NO', type: 'BIGINT', isPk: true, autoIncrement: true, nullable: false,
    })
    expect(mbr.columns[1]).toMatchObject({
      physicalName: 'MBR_NM', type: 'VARCHAR(100)', defaultValue: "'익명'",
      comment: '표시용 이름', custom: { f2: 'Y' },
    })
  })

  it('복합 PK 가 왕복한다', () => {
    const ord = plan.tables.find((t) => t.physicalName === 'ORD')!
    expect(ord.columns.filter((c) => c.isPk).map((c) => c.physicalName)).toEqual(['ORD_NO', 'MBR_NO'])
  })

  it('인덱스가 이름째 왕복한다', () => {
    const mbr = plan.tables.find((t) => t.physicalName === 'MBR')!
    expect(mbr.indexes).toEqual([{ name: 'IX_MBR_NM', columnPhysicalNames: ['MBR_NM'], unique: false }])
  })

  it('그룹이 색·설명째 왕복한다', () => {
    expect(plan.groups).toEqual([{
      // 이 픽스처의 그룹은 별칭이 없다(alias: '') — 머릿말도 그것을 그대로 실어 온다.
      name: '회원 관리', color: '#0E7A6C', comment: '회원 도메인', alias: '',
      tablePhysicalNames: ['MBR', 'ORD'], existingId: null,
    }])
  })

  it('익명 관계는 익명으로, 이름 있는 관계는 이름째 왕복한다', () => {
    const anon = plan.relationships.find((r) => r.childPhysicalName === 'ORD')!
    expect(anon).toMatchObject({ cardinality: '1:N', name: null })
    const named = plan.relationships.find((r) => r.childPhysicalName === 'MBR_DTL')!
    expect(named).toMatchObject({ cardinality: '1:1', name: 'FK_MBR_DTL_MBR' })
  })

  // identifying 은 DBML 에 표현이 없어 "FK 컬럼 ⊆ 자식 PK" 로 재추론한다(설계 §7). 자식 PK 가
  // 복합이든(indexes 블록) 단일이든(컬럼 설정 [pk]) 같은 결론이 나와야 한다 — 단일 PK 쪽이
  // 파서에서 pk 제약으로 정규화되지 않아 전부 비식별로 뒤집히던 것이 리뷰 M-1 이다.
  it('identifying 이 왕복한다 — 복합 PK 자식과 단일 PK 자식 둘 다', () => {
    const composite = plan.relationships.find((r) => r.childPhysicalName === 'ORD')!
    expect(composite.identifying).toBe(true)
    const single = plan.relationships.find((r) => r.childPhysicalName === 'MBR_DTL')!
    expect(single.identifying).toBe(true)
  })

  it('1:1 이 유니크 인덱스를 만들지 않는다', () => {
    const dtl = plan.tables.find((t) => t.physicalName === 'MBR_DTL')!
    expect(dtl.indexes).toEqual([])
  })
})

/**
 * DBML 은 `r.sql`(방언 타입)을 그대로 적으므로 **mysql 로 낼 때만** 부호 없음을 나른다
 * (설계 §4.5 끝·§10.9). 파서는 `[` 앞을 통째로 타입으로 읽어 왕복이 저절로 성립한다.
 * 다른 방언 DBML 에는 CHECK 를 낼 자리가 없어 부호 없음이 사라진다 — 그 갈래를 함께 못 박는다.
 */
describe('DBML 왕복 — 부호 없음', () => {
  const model = () => {
    const m = createEmptyModel()
    m.tables['t'] = {
      id: 't', logicalName: 'ORD', physicalName: 'ORD', comment: null, groupId: null,
      position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.columns['c'] = {
      id: 'c', tableId: 't', logicalName: 'ORD_NO', physicalName: 'ORD_NO', type: 'INT UNSIGNED',
      isPk: true, autoIncrement: true, nullable: false, defaultValue: null, order: 0,
      comment: null, domainId: null, custom: {},
    }
    return m
  }

  it('mysql DBML 은 INT UNSIGNED 를 싣고 되읽는다', () => {
    const dbml = generateDbml(model(), 'mysql')
    expect(dbml).toContain('INT UNSIGNED')
    const plan = planDdlImport(createEmptyModel(), parseDbml(dbml), 'mysql', DEFAULT_NAMING_RULES)
    expect(plan.tables[0]!.columns[0]!.type).toBe('INT UNSIGNED')
    expect(plan.warnings.filter((w) => w.kind === 'unknown-type')).toEqual([])
  })

  it('postgresql DBML 에서는 사라진다 — CHECK 를 적을 자리가 없다(범위 밖 §10.9)', () => {
    const dbml = generateDbml(model(), 'postgresql')
    expect(dbml).not.toContain('UNSIGNED')
    const plan = planDdlImport(createEmptyModel(), parseDbml(dbml), 'postgresql', DEFAULT_NAMING_RULES)
    expect(plan.tables[0]!.columns[0]!.type).toBe('INT')
  })
})

/**
 * mysql 의 nullable TIMESTAMP 는 `[null]` 을 명시해야 왕복한다. DBML 파서에는 `null` 설정을 읽는
 * 자리가 이미 있고(`dbml-parse.ts` 의 `key === 'null'`), 가져오기는 `nullable: !notNull && !isPk`
 * 로 판정한다 — 즉 토큰을 적기만 하면 왕복은 저절로 성립한다. 문제는 **적히지 않는 것**이다.
 */
describe('DBML 왕복 — MySQL nullable TIMESTAMP', () => {
  function tsModel(): ProjectModel {
    const m = createEmptyModel()
    m.tables['t'] = {
      id: 't', logicalName: 'ORD', physicalName: 'ORD', comment: null, groupId: null,
      position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    m.columns['c1'] = {
      id: 'c1', tableId: 't', logicalName: 'ORD_NO', physicalName: 'ORD_NO', type: 'BIGINT',
      isPk: true, autoIncrement: false, nullable: false, defaultValue: null, order: 0,
      comment: null, domainId: null, custom: {},
    }
    m.columns['c2'] = {
      id: 'c2', tableId: 't', logicalName: 'REG_DT', physicalName: 'REG_DT', type: 'TIMESTAMPTZ',
      isPk: false, autoIncrement: false, nullable: true, defaultValue: null, order: 1,
      comment: null, domainId: null, custom: {},
    }
    return m
  }

  it('낸 DBML 을 다시 읽어도 nullable 이 유지된다', () => {
    const dbml = generateDbml(tsModel(), 'mysql')
    // ⚠️ 전제를 먼저 단언한다 — 토큰이 없는 출력도 `notNull: false` 로 읽히므로, 이것이 없으면
    // 이 테스트는 「null 토큰이 왕복한다」가 아니라 구현과 무관하게 항상 참인 문장이 된다(실측).
    expect(dbml).toContain('"REG_DT" TIMESTAMP [null]')
    const plan = planDdlImport(createEmptyModel(), parseDbml(dbml), 'mysql', DEFAULT_NAMING_RULES)
    const c = plan.tables.find((t) => t.physicalName === 'ORD')!
      .columns.find((x) => x.physicalName === 'REG_DT')!
    expect(c.nullable).toBe(true)
  })
})
