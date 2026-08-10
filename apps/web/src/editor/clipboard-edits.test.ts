import { describe, expect, it } from 'vitest'
import { buildSampleModel, fullModel } from '@erdd/core/src/testing/fixtures.js'
import { serializeColumns, serializeTables } from './clipboard.js'
import { planPasteColumnIds, planPasteTableIds, pasteColumns, pasteTables } from './clipboard-edits.js'

/** 결정론적 id 생성기 — 테스트에서 발급 순서를 그대로 관찰한다. */
function idGen() {
  let n = 0
  return () => `new${++n}`
}

describe('pasteTables', () => {
  it('같은 프로젝트에 붙여넣으면 이름이 개명된다', () => {
    const m = buildSampleModel()
    const payload = serializeTables(m, ['t2'])
    const ids = planPasteTableIds(payload, idGen())
    const next = pasteTables(m, payload, { ids, offset: { x: 40, y: 40 } })
    const added = Object.values(next.tables).filter((t) => !Object.hasOwn(m.tables, t.id))
    expect(added).toHaveLength(1)
    expect(added[0]!.logicalName).toBe('회원_사본')
    expect(added[0]!.physicalName).toBe('MBR_COPY')
  })

  it('두 번 붙여넣으면 번호가 올라간다', () => {
    const m = buildSampleModel()
    const payload = serializeTables(m, ['t2'])
    let next = pasteTables(m, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 } })
    const gen2 = () => { let n = 100; return () => `x${++n}` }
    next = pasteTables(next, payload, { ids: planPasteTableIds(payload, gen2()), offset: { x: 0, y: 0 } })
    const names = Object.values(next.tables).map((t) => t.logicalName).sort()
    expect(names).toContain('회원_사본')
    expect(names).toContain('회원_사본2')
  })

  it('컬럼과 인덱스가 함께 붙고 인덱스는 새 컬럼을 가리킨다', () => {
    const m = buildSampleModel()
    const payload = serializeTables(m, ['t2'])
    const next = pasteTables(m, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 } })
    const added = Object.values(next.tables).find((t) => t.logicalName === '회원_사본')!
    const cols = Object.values(next.columns).filter((c) => c.tableId === added.id)
    expect(cols).toHaveLength(3)
    const ix = Object.values(next.indexes).find((i) => i.tableId === added.id)!
    const target = next.columns[ix.columns[0]!.columnId]!
    expect(target.tableId).toBe(added.id)        // 원본 c3가 아니라 사본을 가리킨다
    expect(target.physicalName).toBe('MBR_NM')
  })

  it('관계는 붙지 않는다', () => {
    const m = buildSampleModel()
    const payload = serializeTables(m, ['t1', 't2'])
    const next = pasteTables(m, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 } })
    expect(Object.keys(next.relationships)).toHaveLength(Object.keys(m.relationships).length)
  })

  it('위치에 오프셋이 더해진다', () => {
    const m = buildSampleModel()
    const payload = serializeTables(m, ['t2'])
    const next = pasteTables(m, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 40, y: 40 } })
    const added = Object.values(next.tables).find((t) => t.logicalName === '회원_사본')!
    expect(added.position).toEqual({ x: 340, y: 40 })   // 원본 t2가 (300, 0)
  })

  it('도메인은 이름으로 재연결되고 없으면 null이 된다', () => {
    const src = fullModel()
    const payload = serializeTables(src, ['tb1'])
    // 도메인이 없는 프로젝트에 붙여넣는다
    const target = buildSampleModel()
    const next = pasteTables(target, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 } })
    // ⚠️ target에 이미 physicalName === 'MBR'인 t2가 있어 이름으로 찾으면 원본을 잡는다(vacuous).
    // 붙여넣은 사본은 원본 target에 없던 id로 식별한다.
    const added = Object.values(next.tables).find((t) => !Object.hasOwn(target.tables, t.id))!
    const c = Object.values(next.columns).find((x) => x.tableId === added.id && x.physicalName === 'MBR_NM')!
    expect(c.domainId).toBeNull()
    expect(c.type).toBe('VARCHAR(100)')    // 복사본의 type 문자열이 유지된다
  })

  it('같은 이름의 도메인이 있으면 그 id로 연결된다', () => {
    const src = fullModel()
    const payload = serializeTables(src, ['tb1'])
    const next = pasteTables(src, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 } })
    const added = Object.values(next.tables).find((t) => t.logicalName === '회원_사본')!
    const c = Object.values(next.columns).find((x) => x.tableId === added.id && x.physicalName === 'MBR_NM')!
    expect(c.domainId).toBe('d1')
  })

  it('커스텀 항목은 이름으로 재연결되고 없는 이름은 버려진다', () => {
    const src = fullModel()
    // fullModel()의 c2.custom은 필드 "이름"을 키로 쓰지만 실제 규약은 필드 id 키다
    // (packages/core/src/custom-field.ts의 resolveCustomValue: entity.custom[field.id]).
    // 규약대로 로컬 정정하지 않으면 serializeTables가 dangling 키로 보고 버려 payload.custom이
    // {}가 되고 재연결 경로가 한 번도 실행되지 않는다.
    src.columns['c2'] = { ...src.columns['c2']!, custom: { cf1: 'true' } }
    const payload = serializeTables(src, ['tb1'])
    const next = pasteTables(src, payload, { ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 } })
    const added = Object.values(next.tables).find((t) => t.logicalName === '회원_사본')!
    const c = Object.values(next.columns).find((x) => x.tableId === added.id && x.physicalName === 'MBR_NM')!
    expect(c.custom).toEqual({ cf1: 'true' })     // 이름 '개인정보여부' → id cf1

    const base = buildSampleModel()
    const bare = pasteTables(base, payload, {
      ids: planPasteTableIds(payload, idGen()), offset: { x: 0, y: 0 },
    })
    // base에도 physicalName === 'MBR'인 t2가 있어 이름으로 찾으면 원본을 잡는다(vacuous). id로 식별한다.
    const t = Object.values(bare.tables).find((x) => !Object.hasOwn(base.tables, x.id))!
    const bc = Object.values(bare.columns).find((x) => x.tableId === t.id && x.physicalName === 'MBR_NM')!
    expect(bc.custom).toEqual({})
  })
})

describe('pasteColumns', () => {
  it('대상 테이블 끝에 order를 이어 붙인다', () => {
    const m = buildSampleModel()
    const payload = serializeColumns(m, ['c2'])
    const ids = planPasteColumnIds(payload, idGen())
    const next = pasteColumns(m, payload, { tableId: 't1', ids })
    const cols = Object.values(next.columns).filter((c) => c.tableId === 't1').sort((a, b) => a.order - b.order)
    expect(cols).toHaveLength(2)
    expect(cols[1]!.physicalName).toBe('MBR_NO')
    expect(cols[1]!.order).toBeGreaterThan(cols[0]!.order)
  })

  it('대상 테이블에 동명 컬럼이 있으면 개명한다', () => {
    const m = buildSampleModel()
    const payload = serializeColumns(m, ['c2'])          // MBR_NO / 회원번호
    const next = pasteColumns(m, payload, { tableId: 't2', ids: planPasteColumnIds(payload, idGen()) })
    const added = Object.values(next.columns).filter((c) => c.tableId === 't2' && !Object.hasOwn(m.columns, c.id))
    expect(added).toHaveLength(1)
    expect(added[0]!.physicalName).toBe('MBR_NO_COPY')
    expect(added[0]!.logicalName).toBe('회원번호_사본')
  })

  it('개명 범위는 대상 테이블 안이다 — 다른 테이블의 동명 컬럼은 무관하다', () => {
    const m = buildSampleModel()
    const payload = serializeColumns(m, ['c1'])          // GRD_CD, t1 소속. t2에도 GRD_CD(c4)가 있다
    const next = pasteColumns(m, payload, { tableId: 't1', ids: planPasteColumnIds(payload, idGen()) })
    const added = Object.values(next.columns).filter((c) => c.tableId === 't1' && !Object.hasOwn(m.columns, c.id))
    // t1 안에 GRD_CD(c1)가 이미 있으므로 개명된다
    expect(added[0]!.physicalName).toBe('GRD_CD_COPY')
  })

  it('붙여넣은 컬럼은 PK가 아니다', () => {
    const m = buildSampleModel()
    const payload = serializeColumns(m, ['c2'])          // c2는 isPk: true
    const next = pasteColumns(m, payload, { tableId: 't1', ids: planPasteColumnIds(payload, idGen()) })
    const added = Object.values(next.columns).find((c) => c.tableId === 't1' && !Object.hasOwn(m.columns, c.id))!
    expect(added.isPk).toBe(false)
  })

  it('kind가 맞지 않으면 모델을 그대로 돌려준다', () => {
    const m = buildSampleModel()
    const tablePayload = serializeTables(m, ['t2'])
    expect(pasteColumns(m, tablePayload, { tableId: 't1', ids: [] })).toBe(m)
  })
})
