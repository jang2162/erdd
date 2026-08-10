import { describe, expect, it } from 'vitest'
import { buildSampleModel, fullModel } from '@erdd/core/src/testing/fixtures.js'
import { parseClipboard, serializeColumns, serializeTables, uniqueName } from './clipboard.js'

describe('serializeTables', () => {
  it('테이블·컬럼·인덱스를 싣고 id는 싣지 않는다', () => {
    const p = serializeTables(buildSampleModel(), ['t2'])
    expect(p.kind).toBe('tables')
    if (p.kind !== 'tables') throw new Error('kind')
    expect(p.tables).toHaveLength(1)
    const t = p.tables[0]!
    expect(t.physicalName).toBe('MBR')
    expect(t.columns.map((c) => c.physicalName)).toEqual(['MBR_NO', 'MBR_NM', 'GRD_CD'])
    expect(t.indexes.map((ix) => ix.name)).toEqual(['UX_MBR_01'])
    // id가 어디에도 없어야 한다
    expect(JSON.stringify(p)).not.toContain('"t2"')
    expect(JSON.stringify(p)).not.toContain('"c2"')
  })

  it('컬럼은 order 순으로 실린다', () => {
    const p = serializeTables(buildSampleModel(), ['t2'])
    if (p.kind !== 'tables') throw new Error('kind')
    expect(p.tables[0]!.columns.map((c) => c.logicalName)).toEqual(['회원번호', '회원명', '등급코드'])
  })

  it('관계는 싣지 않는다', () => {
    const p = serializeTables(buildSampleModel(), ['t1', 't2'])
    expect(JSON.stringify(p)).not.toContain('relationship')
    expect(JSON.stringify(p)).not.toContain('columnMappings')
  })

  it('인덱스의 컬럼 참조는 물리명으로 실린다', () => {
    const p = serializeTables(buildSampleModel(), ['t2'])
    if (p.kind !== 'tables') throw new Error('kind')
    expect(p.tables[0]!.indexes[0]!.columns).toEqual([{ columnPhysicalName: 'MBR_NM', direction: 'asc' }])
  })

  it('도메인은 이름으로 실린다', () => {
    // fullModel: c2가 도메인 d1(이름 "명")을 쓴다
    const p = serializeTables(fullModel(), ['tb1'])
    if (p.kind !== 'tables') throw new Error('kind')
    const c2 = p.tables[0]!.columns.find((c) => c.physicalName === 'MBR_NM')!
    expect(c2.domainName).toBe('명')
    expect(JSON.stringify(p)).not.toContain('"d1"')
  })

  it('커스텀 항목 값은 필드 이름을 키로 실린다', () => {
    // ⚠️ 브리프 정정: fullModel()의 c2.custom은 실제로는 { '개인정보여부': 'true' }로
    // 필드의 *이름*을 키로 쓴다. 하지만 packages/core/src/custom-field.ts의
    // resolveCustomValue·customFieldUsageCount·customOptionUsageCount가 한결같이
    // `entity.custom[field.id]`로 읽는 데서 보듯, model.custom은 **customField의 id**를
    // 키로 쓰는 것이 실제 규약이다(cf1.id === 'cf1', cf1.name === '개인정보여부') —
    // fullModel 픽스처가 규약과 어긋나 있다(패키지 자체는 손대지 않는다). fullModel()은
    // 호출마다 새 객체를 반환하므로, id→이름 치환이 실제로 동작함을 양성 경로로
    // 검증하기 위해 로컬로 규약에 맞는 custom 값을 얹어 쓴다.
    const model = fullModel()
    model.columns['c2'] = { ...model.columns['c2']!, custom: { cf1: 'true' } }
    const p = serializeTables(model, ['tb1'])
    if (p.kind !== 'tables') throw new Error('kind')
    const c2 = p.tables[0]!.columns.find((c) => c.physicalName === 'MBR_NM')!
    expect(c2.custom).toEqual({ '개인정보여부': 'true' })
  })

  it('정의에 없는 dangling 커스텀 키는 버려진다', () => {
    // fullModel()의 c2.custom은 픽스처 규약(필드 이름을 키로 씀)이 실제 모델 규약(필드
    // id를 키로 씀)과 어긋나 있어, cf1의 id('cf1')와 일치하지 않는 '개인정보여부' 키는
    // dangling으로 취급되어 버려진다.
    const p = serializeTables(fullModel(), ['tb1'])
    if (p.kind !== 'tables') throw new Error('kind')
    const c2 = p.tables[0]!.columns.find((c) => c.physicalName === 'MBR_NM')!
    expect(c2.custom).toEqual({})
  })
})

describe('serializeColumns', () => {
  it('선택한 컬럼만 order 순으로 싣는다', () => {
    const p = serializeColumns(buildSampleModel(), ['c4', 'c2'])
    expect(p.kind).toBe('columns')
    if (p.kind !== 'columns') throw new Error('kind')
    expect(p.columns.map((c) => c.physicalName)).toEqual(['MBR_NO', 'GRD_CD'])
  })
})

describe('parseClipboard', () => {
  it('직렬화 결과를 되읽는다', () => {
    const text = JSON.stringify(serializeTables(buildSampleModel(), ['t2']))
    expect(parseClipboard(text)).not.toBeNull()
  })

  it('__erdd 표식이 없으면 null', () => {
    // v는 맞고 __erdd만 빠진 입력이어야 __erdd 가드 자체를 고립해서 검증한다.
    // { kind, tables }만 있으면 v도 함께 없어서 다음 줄의 v 검사가 먼저 잡아버린다.
    expect(parseClipboard(JSON.stringify({ v: 1, kind: 'tables', tables: [] }))).toBeNull()
  })

  it('버전이 다르면 null', () => {
    expect(parseClipboard(JSON.stringify({ __erdd: 1, v: 99, kind: 'tables', tables: [] }))).toBeNull()
  })

  it('JSON이 아니면 null', () => {
    expect(parseClipboard('그냥 텍스트')).toBeNull()
    expect(parseClipboard('')).toBeNull()
  })

  it('kind가 모르는 값이면 null', () => {
    expect(parseClipboard(JSON.stringify({ __erdd: 1, v: 1, kind: 'notes', notes: [] }))).toBeNull()
  })
})

describe('uniqueName', () => {
  it('충돌이 없으면 그대로 둔다', () => {
    expect(uniqueName('주문', new Set(['회원']), '_사본')).toBe('주문')
  })

  it('충돌하면 접미사를 붙인다', () => {
    expect(uniqueName('주문', new Set(['주문']), '_사본')).toBe('주문_사본')
  })

  it('접미사도 충돌하면 번호를 올린다', () => {
    expect(uniqueName('주문', new Set(['주문', '주문_사본']), '_사본')).toBe('주문_사본2')
    expect(uniqueName('주문', new Set(['주문', '주문_사본', '주문_사본2']), '_사본')).toBe('주문_사본3')
  })

  it('물리명 접미사도 같은 규칙이다', () => {
    expect(uniqueName('ORD', new Set(['ORD']), '_COPY')).toBe('ORD_COPY')
    expect(uniqueName('ORD', new Set(['ORD', 'ORD_COPY']), '_COPY')).toBe('ORD_COPY2')
  })
})
