import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { buildSampleModel } from './testing/fixtures.js'
import { ENTITY_KINDS } from './op.js'
import { diffModelsForDisplay, KIND_ORDER } from './model-diff.js'

/** 픽스처를 깊은 복사해 한쪽만 고칠 수 있게 한다. */
function clone(m: ProjectModel): ProjectModel {
  return structuredClone(m)
}

describe('diffModelsForDisplay', () => {
  it('같은 모델이면 엔트리가 없다', () => {
    const m = buildSampleModel()
    const d = diffModelsForDisplay(m, clone(m))
    expect(d.entries).toEqual([])
    expect(d.counts).toEqual({ added: 0, removed: 0, changed: 0 })
  })

  it('추가된 테이블을 added로 잡고 물리명을 라벨로 쓴다', () => {
    const base = buildSampleModel()
    const target = clone(base)
    target.tables['t9'] = {
      id: 't9', logicalName: '주문', physicalName: 'ORD', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    const d = diffModelsForDisplay(base, target)
    const e = d.entries.find((x) => x.entityId === 't9')!
    expect(e.changeKind).toBe('added')
    expect(e.kind).toBe('table')
    expect(e.label).toBe('ORD')
    expect(e.fields).toEqual([])
    expect(d.counts.added).toBe(1)
  })

  it('삭제된 컬럼의 라벨과 소속 테이블을 base에서 해석한다', () => {
    const base = buildSampleModel()
    const target = clone(base)
    delete target.columns['c3']
    const d = diffModelsForDisplay(base, target)
    const e = d.entries.find((x) => x.entityId === 'c3')!
    expect(e.changeKind).toBe('removed')
    expect(e.kind).toBe('column')
    expect(e.label).toBe('MBR.MBR_NM')
    expect(e.parentTableId).toBe('t2')
    expect(d.counts.removed).toBe(1)
  })

  it('소속 테이블까지 함께 삭제돼도 컬럼 라벨을 base에서 해석한다', () => {
    // t2(MBR) 테이블 전체를 삭제하는 시나리오 — 이때 target에는 t2가 없으므로
    // labelOf가 실수로 target을 참조하면 '?.MBR_NM' 같은 깨진 라벨이 나온다.
    // t2를 참조하는 관계(r1)·인덱스(i1)도 함께 지워 실제 삭제 상황을 흉내낸다.
    const base = buildSampleModel()
    const target = clone(base)
    delete target.tables['t2']
    delete target.columns['c2']
    delete target.columns['c3']
    delete target.columns['c4']
    delete target.relationships['r1']
    delete target.indexes['i1']
    const d = diffModelsForDisplay(base, target)

    const table = d.entries.find((x) => x.entityId === 't2')!
    expect(table.changeKind).toBe('removed')
    expect(table.kind).toBe('table')
    expect(table.label).toBe('MBR')

    const column = d.entries.find((x) => x.entityId === 'c3')!
    expect(column.changeKind).toBe('removed')
    expect(column.kind).toBe('column')
    expect(column.label).toBe('MBR.MBR_NM')
    expect(column.parentTableId).toBe('t2')
  })

  it('변경된 속성만 fields에 담고 한국어 라벨을 붙인다', () => {
    // 픽스처의 c3는 nullable:false다 — false→true로 바꿔야 실제 변경이 된다.
    const base = buildSampleModel()
    const target = clone(base)
    target.columns['c3']!.physicalName = 'MBR_NAME'
    target.columns['c3']!.nullable = true
    const d = diffModelsForDisplay(base, target)
    const e = d.entries.find((x) => x.entityId === 'c3')!
    expect(e.changeKind).toBe('changed')
    const byField = Object.fromEntries(e.fields.map((f) => [f.field, f]))
    expect(byField['physicalName']).toMatchObject({
      label: '물리명', before: 'MBR_NM', after: 'MBR_NAME',
    })
    expect(byField['nullable']).toMatchObject({ label: 'NULL 허용', before: '', after: 'Y' })
    expect(e.fields).toHaveLength(2)
    expect(d.counts.changed).toBe(1)
  })

  it('배치 좌표만 바뀌면 엔트리를 만들지 않는다', () => {
    const base = buildSampleModel()
    const target = clone(base)
    target.tables['t1']!.position = { x: 999, y: 999 }
    target.tables['t1']!.groupPosition = { x: 888, y: 888 }
    expect(diffModelsForDisplay(base, target).entries).toEqual([])
  })

  it('좌표와 실제 속성이 함께 바뀌면 실제 속성만 fields에 남는다', () => {
    const base = buildSampleModel()
    const target = clone(base)
    target.tables['t1']!.position = { x: 999, y: 999 }
    target.tables['t1']!.comment = '설명 추가'
    const e = diffModelsForDisplay(base, target).entries.find((x) => x.entityId === 't1')!
    expect(e.fields.map((f) => f.field)).toEqual(['comment'])
  })

  it('옛 스냅샷처럼 엔티티에 키가 아예 없어도 변경으로 잡지 않는다', () => {
    // 커스텀 항목 도입 이전 스냅샷의 table에는 custom 키가 없다.
    const target = buildSampleModel()
    const base = clone(target)
    const legacy = { ...base.tables['t1']! } as Record<string, unknown>
    delete legacy.custom
    base.tables['t1'] = legacy as unknown as NonNullable<typeof target.tables.t1>
    expect(diffModelsForDisplay(base, target).entries).toEqual([])
  })

  it('사전·도메인·커스텀 항목 변경도 잡는다', () => {
    const base = createEmptyModel()
    base.words['w1'] = {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    }
    const target = clone(base)
    target.words['w1']!.abbreviation = 'MEM'
    target.domains['d1'] = {
      id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: [], description: null, origin: null,
    }
    const d = diffModelsForDisplay(base, target)
    expect(d.entries.find((e) => e.entityId === 'w1')).toMatchObject({
      kind: 'word', changeKind: 'changed', label: '회원',
    })
    expect(d.entries.find((e) => e.entityId === 'd1')).toMatchObject({
      kind: 'domain', changeKind: 'added', label: '금액',
    })
  })

  it('객체·배열 속성을 안정적인 문자열로 만든다', () => {
    const base = createEmptyModel()
    base.domains['d1'] = {
      id: 'd1', name: '상태', category: null, logicalType: 'CHAR(1)',
      dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
      defaultValue: null, allowedValues: ['Y'], description: null, origin: null,
    }
    const target = clone(base)
    target.domains['d1']!.allowedValues = ['Y', 'N']
    const e = diffModelsForDisplay(base, target).entries[0]!
    const f = e.fields.find((x) => x.field === 'allowedValues')!
    expect(f.before).toBe('Y')
    expect(f.after).toBe('Y, N')
  })

  it('사람이 읽는 순서로 정렬한다(테이블 → 컬럼 → 사전)', () => {
    const base = createEmptyModel()
    const target = clone(base)
    target.words['w1'] = {
      id: 'w1', logicalName: '회원', abbreviation: 'MBR',
      englishName: null, description: null, origin: null,
    }
    target.tables['t1'] = {
      id: 't1', logicalName: '회원', physicalName: 'MBR', comment: null,
      groupId: null, position: { x: 0, y: 0 }, groupPosition: null, custom: {},
    }
    target.columns['c1'] = {
      id: 'c1', tableId: 't1', logicalName: '번호', physicalName: 'NO', type: 'INT',
      isPk: true, autoIncrement: false, nullable: false, defaultValue: null,
      order: 0, comment: null, domainId: null, custom: {},
    }
    const kinds = diffModelsForDisplay(base, target).entries.map((e) => e.kind)
    expect(kinds).toEqual(['table', 'column', 'word'])
  })

  it('KIND_ORDER는 ENTITY_KINDS 전체를 빠짐없이 담는다', () => {
    expect([...KIND_ORDER].sort()).toEqual([...ENTITY_KINDS].sort())
  })

  describe('참조형 속성은 id가 아니라 이름으로 표시한다', () => {
    it('domainId는 도메인 이름으로 표시하고, 이전값은 base·이후값은 target에서 해석한다', () => {
      // 이름(금액/비율)이 id(d1/d2)와 확실히 다르게 — 짧은 픽스처 id로도 검증되게 한다.
      const base = buildSampleModel()
      base.domains['d1'] = {
        id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null, origin: null,
      }
      base.columns['c1']!.domainId = 'd1'
      const target = clone(base)
      target.domains['d2'] = {
        id: 'd2', name: '비율', category: null, logicalType: 'DECIMAL(5,4)',
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null, origin: null,
      }
      target.columns['c1']!.domainId = 'd2'
      const d = diffModelsForDisplay(base, target)
      const e = d.entries.find((x) => x.entityId === 'c1')!
      const f = e.fields.find((x) => x.field === 'domainId')!
      expect(f.before).toBe('금액')
      expect(f.after).toBe('비율')
    })

    it('참조가 끊겼으면(dangling) 원시 id를 그대로 남긴다', () => {
      const base = buildSampleModel()
      const target = clone(base)
      target.columns['c1']!.domainId = 'd-missing' // target에 그런 도메인이 없다
      const d = diffModelsForDisplay(base, target)
      const e = d.entries.find((x) => x.entityId === 'c1')!
      const f = e.fields.find((x) => x.field === 'domainId')!
      expect(f.before).toBe('')
      expect(f.after).toBe('d-missing')
    })

    it('groupId는 소속 그룹 이름으로 표시한다', () => {
      const base = buildSampleModel()
      const target = clone(base)
      target.tableGroups['g2'] = { id: 'g2', name: '인사관리', color: '#000', comment: null, alias: '' }
      target.tables['t1']!.groupId = 'g2'
      const d = diffModelsForDisplay(base, target)
      const e = d.entries.find((x) => x.entityId === 't1')!
      const f = e.fields.find((x) => x.field === 'groupId')!
      expect(f.before).toBe('회원관리')
      expect(f.after).toBe('인사관리')
    })

    it('그룹 별칭을 한국어 라벨로 표시한다', () => {
      // HANDOFF 3.2: FIELD_LABEL 은 등록처다 — 빠뜨리면 `?? field` 폴백이 영문 원문을 그대로 낸다.
      // 라벨이 없어도 diff 자체는 잡히므로 이 단언이 없으면 아무것도 빨개지지 않는다.
      const base = buildSampleModel()
      const target = clone(base)
      target.tableGroups['g1']!.alias = 'MBR'
      const d = diffModelsForDisplay(base, target)
      const e = d.entries.find((x) => x.kind === 'tableGroup')!
      const f = e.fields.find((x) => x.field === 'alias')!
      expect(f.label).toBe('별칭')
      expect(f.before).toBe('')
      expect(f.after).toBe('MBR')
    })

    it('tableId는 테이블 물리명으로 표시한다', () => {
      const base = buildSampleModel()
      const target = clone(base)
      target.columns['c3']!.tableId = 't1' // MBR → MBR_GRD로 컬럼을 옮긴다
      const d = diffModelsForDisplay(base, target)
      const e = d.entries.find((x) => x.entityId === 'c3')!
      const f = e.fields.find((x) => x.field === 'tableId')!
      expect(f.before).toBe('MBR')
      expect(f.after).toBe('MBR_GRD')
    })

    it('parentTableId·childTableId는 테이블 물리명으로 표시한다', () => {
      const base = buildSampleModel()
      const target = clone(base)
      target.relationships['r1']!.parentTableId = 't2'
      target.relationships['r1']!.childTableId = 't1'
      const d = diffModelsForDisplay(base, target)
      const e = d.entries.find((x) => x.entityId === 'r1')!
      const parentField = e.fields.find((x) => x.field === 'parentTableId')!
      const childField = e.fields.find((x) => x.field === 'childTableId')!
      expect(parentField).toMatchObject({ before: 'MBR_GRD', after: 'MBR' })
      expect(childField).toMatchObject({ before: 'MBR', after: 'MBR_GRD' })
    })

    it('custom은 커스텀 항목 이름 기준 "이름=값"으로 표시한다', () => {
      const base = buildSampleModel()
      base.customFields['cf1'] = {
        id: 'cf1', name: '개인정보여부', target: 'table', type: 'boolean',
        options: [], required: false, defaultValue: null, order: 0, origin: null,
      }
      const target = clone(base)
      target.tables['t1']!.custom = { cf1: 'Y' }
      const d = diffModelsForDisplay(base, target)
      const e = d.entries.find((x) => x.entityId === 't1')!
      const f = e.fields.find((x) => x.field === 'custom')!
      expect(f.before).toBe('')
      expect(f.after).toBe('개인정보여부=Y')
    })

    it('custom 값이 그대로면 커스텀 항목 이름만 바뀌어도 판정은 변경으로 잡지 않는다', () => {
      // 판정(변경 여부)은 원시 값(id)으로 하고 표시만 이름으로 바꾼다 — 이름이
      // 바뀌었다고 값을 건드리지 않은 테이블까지 '변경'으로 잘못 잡히면 안 된다.
      const base = buildSampleModel()
      base.customFields['cf1'] = {
        id: 'cf1', name: '개인정보여부', target: 'table', type: 'boolean',
        options: [], required: false, defaultValue: null, order: 0, origin: null,
      }
      base.tables['t1']!.custom = { cf1: 'Y' }
      const target = clone(base)
      target.customFields['cf1']!.name = '개인정보보호여부' // 이름만 바꾼다(값은 그대로)
      const d = diffModelsForDisplay(base, target)
      expect(d.entries.find((x) => x.entityId === 't1')).toBeUndefined()
      const cfEntry = d.entries.find((x) => x.entityId === 'cf1')!
      expect(cfEntry.changeKind).toBe('changed')
    })

    it('인덱스 columns는 "컬럼물리명(방향)" 나열로, 정의 순서를 보존한다', () => {
      const base = buildSampleModel()
      const target = clone(base)
      target.indexes['i1']!.columns = [
        { columnId: 'c3', direction: 'asc' },
        { columnId: 'c2', direction: 'desc' },
      ]
      const d = diffModelsForDisplay(base, target)
      const e = d.entries.find((x) => x.entityId === 'i1')!
      const f = e.fields.find((x) => x.field === 'columns')!
      expect(f.before).toBe('MBR_NM(asc)')
      expect(f.after).toBe('MBR_NM(asc), MBR_NO(desc)')
    })

    it('인덱스 columns에 direction이 없으면(구 스냅샷) undefined 없이 컬럼 이름만 낸다', () => {
      const base = buildSampleModel()
      const target = clone(base)
      // 구 스냅샷은 zod 파싱을 거치지 않으므로 direction이 아예 없을 수 있다.
      target.indexes['i1']!.columns = [
        { columnId: 'c2' } as unknown as { columnId: string; direction: 'asc' | 'desc' },
      ]
      const d = diffModelsForDisplay(base, target)
      const e = d.entries.find((x) => x.entityId === 'i1')!
      const f = e.fields.find((x) => x.field === 'columns')!
      expect(f.after).toBe('MBR_NO')
      expect(f.after).not.toContain('undefined')
    })

    it('관계 columnMappings는 "부모물리명 → 자식물리명" 나열로 표시한다(관계 라벨과 같은 방향)', () => {
      const base = buildSampleModel()
      const target = clone(base)
      target.relationships['r1']!.columnMappings = [
        { childColumnId: 'c3', parentColumnId: 'c1' },
      ]
      const d = diffModelsForDisplay(base, target)
      const e = d.entries.find((x) => x.entityId === 'r1')!
      const f = e.fields.find((x) => x.field === 'columnMappings')!
      expect(f.before).toBe('GRD_CD → GRD_CD')
      expect(f.after).toBe('GRD_CD → MBR_NM')
    })

    it('참조 대상이 target에서 사라져도(도메인 삭제) 이전값은 base에서 해석한다', () => {
      // target = clone(base) 패턴만 쓰면 base 쪽 참조 대상이 항상 target에도 있어,
      // 구현을 실수로 (target, target)으로 바꿔도 이 구분을 못 걸러낸다 — 그래서
      // target에서 도메인을 지워 base 해석이 실제로 쓰이는지를 검증한다.
      const base = buildSampleModel()
      base.domains['d1'] = {
        id: 'd1', name: '금액', category: null, logicalType: 'DECIMAL(15,2)',
        dialectTypes: { postgresql: null, mysql: null, oracle: null, mssql: null },
        defaultValue: null, allowedValues: [], description: null, origin: null,
      }
      base.columns['c1']!.domainId = 'd1'
      const target = clone(base)
      delete target.domains['d1']
      target.columns['c1']!.domainId = null
      const d = diffModelsForDisplay(base, target)
      const e = d.entries.find((x) => x.entityId === 'c1')!
      const f = e.fields.find((x) => x.field === 'domainId')!
      // target에서 해석했다면(잘못된 구현) 사라진 도메인의 dangling id 'd1'이 나온다.
      expect(f.before).toBe('금액')
      expect(f.after).toBe('')
    })
  })
})
