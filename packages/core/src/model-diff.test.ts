import { describe, expect, it } from 'vitest'
import { createEmptyModel, type ProjectModel } from './model.js'
import { buildSampleModel } from './testing/fixtures.js'
import { diffModelsForDisplay } from './model-diff.js'

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
})
