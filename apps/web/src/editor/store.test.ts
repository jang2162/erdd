import { afterEach, describe, expect, it } from 'vitest'
import { buildSampleModel } from '@erdd/core/src/testing/fixtures.js'
import { primaryTableId, useEditorStore } from './store.js'

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

describe('editor store 다중 선택', () => {
  it('select는 단일 선택으로 리셋한다(기존 동작)', () => {
    useEditorStore.getState().selectTables(['a', 'b'])
    useEditorStore.getState().select('c')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['c'])
  })

  it('select(null)은 선택을 비운다', () => {
    useEditorStore.getState().selectTables(['a'])
    useEditorStore.getState().select(null)
    expect(useEditorStore.getState().selectedTableIds).toEqual([])
  })

  it('toggleTable은 없으면 뒤에 붙이고 있으면 뺀다 — 마지막 원소가 주 선택이다', () => {
    useEditorStore.getState().select('a')
    useEditorStore.getState().toggleTable('b')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['a', 'b'])
    expect(primaryTableId(useEditorStore.getState())).toBe('b')
    useEditorStore.getState().toggleTable('a')
    expect(useEditorStore.getState().selectedTableIds).toEqual(['b'])
  })

  it('primaryTableId는 선택이 없으면 null이다', () => {
    expect(primaryTableId(useEditorStore.getState())).toBeNull()
  })

  it('selectTables는 비어 있지 않으면 다른 종류 선택을 해제한다', () => {
    useEditorStore.getState().selectNote('n1')
    useEditorStore.getState().selectTables(['a', 'b'])
    expect(useEditorStore.getState().selectedNoteId).toBeNull()
    expect(useEditorStore.getState().selectedTableIds).toEqual(['a', 'b'])
  })

  it('selectTables([])는 테이블만 비우고 메모·관계·그룹 선택은 건드리지 않는다', () => {
    // 캔버스에서 메모를 클릭하면 ReactFlow가 테이블을 해제하며 빈 배열을 쏘는데,
    // 그것이 같은 클릭의 selectNote를 지우면 안 된다(콜백 발화 순서에 기대지 않는다).
    useEditorStore.getState().selectNote('n1')
    useEditorStore.getState().selectTables([])
    expect(useEditorStore.getState().selectedNoteId).toBe('n1')
    expect(useEditorStore.getState().selectedTableIds).toEqual([])
  })

  it('selectTables는 호출자의 배열을 복사한다 — 나중에 변형해도 store가 오염되지 않는다', () => {
    // 사이드바 Shift 범위 선택이 `orderedIds.slice(...)`를 넘긴다. 지금 호출부는 매번 새 배열을
    // 만들지만, 재사용 버퍼를 넘기는 호출부가 하나만 생겨도 store의 상태가 통째로 바뀐다.
    // store는 받은 배열의 소유권을 가정하지 않는다 — 진입점에서 복사해 봉인한다.
    const ids = ['a', 'b']
    useEditorStore.getState().selectTables(ids)
    ids.push('c')
    ids[0] = 'z'
    expect(useEditorStore.getState().selectedTableIds).toEqual(['a', 'b'])
  })

  it('resync는 사라진 테이블만 선택에서 걷어낸다', () => {
    useEditorStore.getState().selectTables(['t1', 't2'])
    const model = buildSampleModel()
    delete model.tables['t1']
    useEditorStore.getState().resync(model, 5)
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])
  })

  it('resync에서 아무것도 안 사라지면 배열 참조를 유지한다', () => {
    // 실시간 op는 초당 여러 번 온다. 매번 새 배열을 만들면 이 값을 구독하는
    // 컴포넌트가 남의 모든 편집마다 리렌더된다.
    useEditorStore.getState().selectTables(['t1', 't2'])
    const before = useEditorStore.getState().selectedTableIds
    useEditorStore.getState().resync(buildSampleModel(), 6)
    expect(useEditorStore.getState().selectedTableIds).toBe(before)
  })

  it('setLoaded는 선택을 비운다 — resync와 달리 살아남은 것도 남기지 않는다', () => {
    // setLoaded는 **모델을 통째로 갈아 끼우는** 경로다(최초 로드·프로젝트 전환·스냅샷 복원).
    // 프로덕션에 store.reset() 호출부가 한 군데도 없어 프로젝트 전환은 이것 하나로만 이뤄지므로,
    // 여기서 비우지 않으면 이전 프로젝트의 선택이 새 프로젝트로 그대로 넘어온다.
    // 대상이 새 모델에도 **존재하는** 상황으로 세워, keptSelection(살아남은 것 유지)으로
    // 바꿔치기하면 실제로 갈리게 만든다 — 같은 모델을 다시 실으면 그쪽은 선택을 그대로 둔다.
    useEditorStore.getState().selectTables(['t1', 't2'])
    useEditorStore.getState().setLoaded(buildSampleModel(), 5, 'p1')
    expect(useEditorStore.getState().selectedTableIds).toEqual([])

    // 테이블 아닌 선택도 같은 규칙이다(선택 4종은 서로 배타적이라 따로 세운다).
    useEditorStore.getState().selectGroup('g1')
    useEditorStore.getState().setLoaded(buildSampleModel(), 6, 'p1')
    expect(useEditorStore.getState().selectedGroupId).toBeNull()
  })

  it('resync로 선택이 전부 사라지면 빈 선택의 공유 참조를 쓴다', () => {
    // 빈 선택은 어느 경로로 도달하든 같은 배열 인스턴스여야 한다. resync만 새 빈 배열을
    // 만들면, 남이 내가 보던 테이블을 지울 때마다 "비었다"가 매번 다른 값이 된다.
    useEditorStore.getState().select(null)
    const empty = useEditorStore.getState().selectedTableIds
    useEditorStore.getState().selectTables(['t1'])
    const model = buildSampleModel()
    delete model.tables['t1']
    useEditorStore.getState().resync(model, 7)
    expect(useEditorStore.getState().selectedTableIds).toBe(empty)
  })
})

/**
 * 실시간 삭제 수신이 부르는 쪽. 오늘은 resync와 **같은 함수**를 부르므로 위 3건과 갈릴 수 없지만,
 * 누군가 규칙을 pruneSelection 안에 다시 인라인하면 위 테스트는 전부 통과한 채로 갈린다 —
 * 두 진입점에 각각 규약을 걸어 둔다.
 */
describe('editor store pruneSelection', () => {
  it('모델에서 사라진 것만 걷어내고 살아남은 선택은 유지한다', () => {
    useEditorStore.getState().selectTables(['t1', 't2'])
    const model = buildSampleModel()
    delete model.tables['t1']
    useEditorStore.getState().pruneSelection(model)
    expect(useEditorStore.getState().selectedTableIds).toEqual(['t2'])
  })

  it('아무것도 안 사라지면 배열 참조를 유지한다', () => {
    // 실시간 op는 초당 여러 번 온다. 매번 새 배열을 만들면 이 값을 구독하는
    // 컴포넌트가 남의 모든 편집마다 리렌더된다.
    useEditorStore.getState().selectTables(['t1', 't2'])
    const before = useEditorStore.getState().selectedTableIds
    useEditorStore.getState().pruneSelection(buildSampleModel())
    expect(useEditorStore.getState().selectedTableIds).toBe(before)
  })

  it('전부 사라지면 빈 선택의 공유 참조를 쓴다', () => {
    useEditorStore.getState().select(null)
    const empty = useEditorStore.getState().selectedTableIds
    useEditorStore.getState().selectTables(['t1'])
    const model = buildSampleModel()
    delete model.tables['t1']
    useEditorStore.getState().pruneSelection(model)
    expect(useEditorStore.getState().selectedTableIds).toBe(empty)
  })

  it('메모·관계·그룹 선택도 같은 규칙으로 걷어낸다', () => {
    // 테이블만 보고 나머지를 남기면, 남이 지운 관계의 상세 패널이 빈 채로 열려 있게 된다.
    const model = buildSampleModel()
    const [relationshipId] = Object.keys(model.relationships)
    useEditorStore.getState().selectRelationship(relationshipId!)
    useEditorStore.getState().pruneSelection(model)
    expect(useEditorStore.getState().selectedRelationshipId).toBe(relationshipId)
    delete model.relationships[relationshipId!]
    useEditorStore.getState().pruneSelection(model)
    expect(useEditorStore.getState().selectedRelationshipId).toBeNull()
  })
})
