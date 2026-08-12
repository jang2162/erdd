import type { Column, ProjectModel } from '@erdd/core'

/** 한 테이블 안에서 관계선이 붙는 한 지점. 컬럼 id 집합으로 식별된다. */
export type Anchor = {
  /** `c:<컬럼id>`(단일) 또는 `s:<컬럼id>+<컬럼id>`(복합) */
  key: string
  /** column.order 오름차순(동률이면 컬럼 id 사전순)으로 고정 정렬된 컬럼 id */
  columnIds: string[]
}

/** 관계 하나의 양 끝 앵커 키. null이면 그 끝은 중앙 핸들 폴백(설계 3.5). */
export type RelationshipAnchorKeys = { childKey: string | null; parentKey: string | null }

export type AnchorIndex = {
  /** 테이블 id → 그 테이블에 렌더할 앵커 목록(키로 중복 제거, 순서 고정) */
  byTable: Map<string, Anchor[]>
  /** 관계 id → 양 끝 앵커 키 */
  byRelationship: Map<string, RelationshipAnchorKeys>
}

/**
 * 핸들 id 를 만드는 **유일한 자리**. 엣지의 `sourceHandle`/`targetHandle` 과 노드의
 * `<Handle id>` 가 반드시 이 함수를 거쳐야 한다 — 한 글자만 어긋나도 React Flow 는
 * 붙일 핸들을 못 찾고 예외도 경고도 없이 **선을 그리지 않는다**(설계 3.3).
 *
 * 키가 null 이면 기존 중앙 핸들 id(`l`/`r`)를 그대로 낸다.
 */
export function handleId(side: 'l' | 'r', key: string | null): string {
  return key === null ? side : `${side}:${key}`
}

/**
 * 유효한 컬럼만 남겨 앵커를 만든다. 남는 것이 없으면 null(→ 중앙 폴백).
 *
 * - 중복 제거: `remapRelationshipChildColumn` 이 같은 childColumnId 를 두 번 담을 수 있다.
 *   중복을 세면 단일 관계가 복합으로 오인되어 없는 합성 행을 가리킨다(설계 3.6).
 * - 소속 검사: 매핑이 다른 테이블의 컬럼을 가리키는 깨진 모델에서 엉뚱한 행에 붙지 않게 한다.
 */
function anchorOf(model: ProjectModel, tableId: string, columnIds: string[]): Anchor | null {
  const cols = [...new Set(columnIds)]
    .map((id) => model.columns[id])
    .filter((c): c is Column => c !== undefined && c.tableId === tableId)
  if (cols.length === 0) return null
  // 정렬을 고정하지 않으면 같은 조합이 columnMappings 배열 순서에 따라 다른 키가 되어,
  // 같은 행에 붙어야 할 두 관계가 서로 다른(존재하지 않는) 핸들을 가리킨다.
  const ids = [...cols]
    .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => c.id)
  return { key: ids.length === 1 ? `c:${ids[0]}` : `s:${ids.join('+')}`, columnIds: ids }
}

/** 앵커 목록 정렬용 — 첫 컬럼의 order. */
function firstOrder(model: ProjectModel, a: Anchor): number {
  return model.columns[a.columnIds[0]!]?.order ?? 0
}

export function buildAnchors(model: ProjectModel): AnchorIndex {
  const byTable = new Map<string, Anchor[]>()
  const byRelationship = new Map<string, RelationshipAnchorKeys>()

  const add = (tableId: string, anchor: Anchor | null) => {
    if (anchor === null) return
    const list = byTable.get(tableId)
    if (list === undefined) { byTable.set(tableId, [anchor]); return }
    if (!list.some((a) => a.key === anchor.key)) list.push(anchor)
  }

  for (const rel of Object.values(model.relationships)) {
    const child = anchorOf(model, rel.childTableId, rel.columnMappings.map((m) => m.childColumnId))
    const parent = anchorOf(model, rel.parentTableId, rel.columnMappings.map((m) => m.parentColumnId))
    add(rel.childTableId, child)
    add(rel.parentTableId, parent)
    byRelationship.set(rel.id, { childKey: child?.key ?? null, parentKey: parent?.key ?? null })
  }

  // 순서를 고정한다 — 흔들리면 합성 행이 렌더마다 자리를 바꾼다.
  // 단일(컬럼 행에 붙는 것) 먼저, 복합(합성 행) 나중.
  for (const list of byTable.values()) {
    list.sort((a, b) =>
      (a.columnIds.length === 1 ? 0 : 1) - (b.columnIds.length === 1 ? 0 : 1)
      || firstOrder(model, a) - firstOrder(model, b)
      || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  }
  return { byTable, byRelationship }
}

/**
 * 테이블별 앵커 서명. `updateNodeInternals` 대상을 고르는 데 쓴다(설계 5.5).
 *
 * ⚠️ **키만 넣으면 안 된다 — 핸들의 y 는 키가 아니라 `그 행이 노드 안 몇 번째인가`로 정해진다.**
 * `reorderColumn` 은 두 컬럼의 `order` 만 맞바꾸므로 앵커 키 집합이 그대로다. 키만 서명에 넣으면
 * `changedAnchorTables` 가 빈 배열을 내 재측정이 안 걸리고, React Flow 도 스스로 다시 재지
 * 않는다 — 행 집합이 같아 노드 크기가 안 변하니 ResizeObserver 도 `dimensionChanged` 도 없고,
 * `parseHandles` 는 `measured` 가 있으면(우리는 `keepMeasured` 로 항상 보존한다) 이전
 * `handleBounds` 를 그대로 물려준다. 그러면 **선이 옛 행 높이에 남는다.**
 *
 * 그래서 각 앵커에 **렌더 위치**를 붙인다(`키@행인덱스`). 위치를 바꾸는 편집만 서명을 바꾸므로,
 * 앵커도 순서도 그대로면 서명이 같아 호출이 아예 없다 — 5.5 의 "매 렌더 전부 부르지 않는다"가
 * 그대로 유지된다.
 *
 * 행 인덱스는 `TableNode` 가 실제로 그리는 순서(`order` 오름차순)와 같아야 한다. 복합 앵커는
 * 컬럼 목록 **맨 아래**의 합성 행이라 위치를 컬럼 개수로 잡는다(복합끼리의 상대 순서는 `list`
 * 순서가 이미 문자열 순서로 담고 있다). 컬럼 추가·삭제는 노드 크기가 변해 ResizeObserver 가
 * 어차피 처리하지만, 이 서명이 함께 잡아도 갱신 한 번이 겹칠 뿐 무해하다.
 */
export function anchorSignatures(index: AnchorIndex, model: ProjectModel): Map<string, string> {
  // ⚠️ 컬럼은 **한 번만** 훑는다. 테이블마다 `Object.values(model.columns).filter(...)` 를 부르면
  // O(테이블수 × 컬럼수) 가 되어, 100 테이블·2000 컬럼 모델에서 모델 변경 1회당 12ms 가 넘는다 —
  // 한 프레임(16.7ms)을 통째로 먹는 값이고 이 경로는 모델이 바뀔 때마다 돈다.
  // 앵커가 있는 테이블만 미리 담아 두면(`?.push` 가 나머지를 조용히 버린다) 무관한 테이블에는
  // 배열조차 만들지 않는다.
  const rowsByTable = new Map<string, Column[]>()
  for (const tableId of index.byTable.keys()) rowsByTable.set(tableId, [])
  for (const c of Object.values(model.columns)) rowsByTable.get(c.tableId)?.push(c)

  const out = new Map<string, string>()
  for (const [tableId, list] of index.byTable) {
    // 행 인덱스는 **그 테이블 안에서**의 순번이다 — 다른 테이블 컬럼이 섞이면 위치가 밀려
    // 무관한 편집에도 서명이 달라진다(위 5.5 요건이 깨진다).
    const rows = rowsByTable.get(tableId)!
    rows.sort((a, b) => a.order - b.order)
    const rowOf = new Map(rows.map((c, i) => [c.id, i]))
    out.set(tableId, list
      .map((a) => `${a.key}@${a.columnIds.length === 1 ? rowOf.get(a.columnIds[0]!) ?? -1 : rows.length}`)
      .join('|'))
  }
  return out
}

/** 서명이 달라졌거나 사라진 테이블 id. 앵커가 0개가 된 테이블도 갱신 대상이다. */
export function changedAnchorTables(
  prev: Map<string, string>, next: Map<string, string>,
): string[] {
  const changed: string[] = []
  for (const [id, sig] of next) if (prev.get(id) !== sig) changed.push(id)
  for (const id of prev.keys()) if (!next.has(id)) changed.push(id)
  return changed
}
