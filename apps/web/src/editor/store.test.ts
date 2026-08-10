import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { useEditorStore } from './store.js'

afterEach(() => { useEditorStore.getState().reset() })

describe('editor store 권한 상태', () => {
  it('기본값은 fail-closed다 — 서버 판정이 오기 전에는 편집할 수 없다', () => {
    expect(useEditorStore.getState().canEdit).toBe(false)
    expect(useEditorStore.getState().canManage).toBe(false)
  })

  it('setPermissions가 두 값을 함께 반영한다', () => {
    useEditorStore.getState().setPermissions({ canEdit: true, canManage: false })
    expect(useEditorStore.getState().canEdit).toBe(true)
    expect(useEditorStore.getState().canManage).toBe(false)
  })

  it('reset은 권한을 fail-closed로 되돌린다', () => {
    useEditorStore.getState().setPermissions({ canEdit: true, canManage: true })
    useEditorStore.getState().reset()
    expect(useEditorStore.getState().canEdit).toBe(false)
    expect(useEditorStore.getState().canManage).toBe(false)
  })
})

describe('선택 배열', () => {
  const s = () => useEditorStore.getState()

  beforeEach(() => { s().reset(); s().setLoaded(buildSampleModel(), 1, 'p1') })

  it('select는 단일 선택으로 배열을 만든다', () => {
    s().select('t1')
    expect(s().selectedTableIds).toEqual(['t1'])
  })

  it('select(null)은 선택을 비운다', () => {
    s().select('t1')
    s().select(null)
    expect(s().selectedTableIds).toEqual([])
  })

  it('toggleTable은 있으면 빼고 없으면 더한다', () => {
    s().select('t1')
    s().toggleTable('t2')
    expect(s().selectedTableIds).toEqual(['t1', 't2'])
    s().toggleTable('t1')
    expect(s().selectedTableIds).toEqual(['t2'])
  })

  it('테이블이 2개 이상 선택되면 컬럼 선택이 비워진다', () => {
    s().select('t2')
    s().selectColumn('t2', 'c2', 'replace')
    expect(s().selectedColumnIds).toEqual(['c2'])
    s().toggleTable('t1')
    expect(s().selectedTableIds).toHaveLength(2)
    expect(s().selectedColumnIds).toEqual([])
  })

  it('다른 테이블의 컬럼을 고르면 테이블 선택이 그 테이블로 바뀌고 컬럼이 교체된다', () => {
    s().select('t2')
    s().selectColumn('t2', 'c2', 'replace')
    s().selectColumn('t1', 'c1', 'replace')
    expect(s().selectedTableIds).toEqual(['t1'])
    expect(s().selectedColumnIds).toEqual(['c1'])
  })

  it("selectColumn 'toggle'은 같은 테이블 안에서 누적·해제한다", () => {
    s().selectColumn('t2', 'c2', 'replace')
    s().selectColumn('t2', 'c3', 'toggle')
    expect(s().selectedColumnIds).toEqual(['c2', 'c3'])
    s().selectColumn('t2', 'c2', 'toggle')
    expect(s().selectedColumnIds).toEqual(['c3'])
  })

  it("selectColumn 'range'는 마지막 선택부터 범위를 order 순으로 채운다", () => {
    // 픽스처 t2의 컬럼: c2(order 0) · c3(order 1) · c4(order 2)
    s().selectColumn('t2', 'c2', 'replace')
    s().selectColumn('t2', 'c4', 'range')
    expect(s().selectedColumnIds).toEqual(['c2', 'c3', 'c4'])
  })

  it("range에 앞선 선택이 없으면 replace처럼 동작한다", () => {
    s().select('t2')
    s().selectColumn('t2', 'c3', 'range')
    expect(s().selectedColumnIds).toEqual(['c3'])
  })

  it('테이블 선택이 바뀌면 컬럼 선택이 비워진다', () => {
    s().selectColumn('t2', 'c2', 'replace')
    s().select('t1')
    expect(s().selectedColumnIds).toEqual([])
  })

  it('관계·메모·그룹 선택은 테이블·컬럼 선택을 비운다', () => {
    s().selectColumn('t2', 'c2', 'replace')
    s().selectRelationship('r1')
    expect(s().selectedTableIds).toEqual([])
    expect(s().selectedColumnIds).toEqual([])
  })

  it('resync는 사라진 테이블·컬럼 id를 선택에서 뺀다', () => {
    s().select('t2')
    s().selectColumn('t2', 'c2', 'replace')
    s().selectColumn('t2', 'c3', 'toggle')
    const m = buildSampleModel()
    delete m.columns['c3']
    s().resync(m, 2)
    expect(s().selectedTableIds).toEqual(['t2'])
    expect(s().selectedColumnIds).toEqual(['c2'])
  })

  it('resync에서 테이블이 사라지면 그 컬럼 선택도 사라진다', () => {
    s().select('t2')
    s().selectColumn('t2', 'c2', 'replace')
    const m = buildSampleModel()
    delete m.tables['t2']
    s().resync(m, 2)
    expect(s().selectedTableIds).toEqual([])
    expect(s().selectedColumnIds).toEqual([])
  })
})
