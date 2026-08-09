import type { Edge } from '@xyflow/react'
import { generatePhysicalName, junctionTableName } from '@erdd/core'
import type { JunctionSpec, NamingRules, Position, ProjectModel } from '@erdd/core'
import type { PeerMark, PeerMarks } from './peer-marks.js'
import { nextTablePhysicalName } from './model-edits.js'

export type RelationshipEdgeData = {
  cardinality: '1:1' | '1:N'
  identifying: boolean
  peers?: PeerMark[]
}

export function buildEdges(
  model: ProjectModel, visibleTableIds?: Set<string>, peerMarks: PeerMarks = new Map(),
): Edge[] {
  const edges: Edge[] = []
  for (const rel of Object.values(model.relationships)) {
    if (visibleTableIds && (!visibleTableIds.has(rel.parentTableId) || !visibleTableIds.has(rel.childTableId))) {
      continue
    }
    const parent = model.tables[rel.parentTableId]
    const child = model.tables[rel.childTableId]
    // 자식이 부모보다 오른쪽이면 자식의 왼쪽 핸들 → 부모의 오른쪽 핸들.
    const childRight = !!parent && !!child && child.position.x >= parent.position.x
    edges.push({
      id: rel.id,
      source: rel.childTableId,
      target: rel.parentTableId,
      sourceHandle: childRight ? 'l' : 'r',
      targetHandle: childRight ? 'r' : 'l',
      type: 'relationship',
      data: {
        cardinality: rel.cardinality, identifying: rel.identifying, peers: peerMarks.get(rel.id),
      },
    })
  }
  return edges
}

export type ConnectionPlan =
  | { ok: false; reason: 'invalid' | 'self' | 'no-parent-pk' }
  | { ok: true; parentTableId: string; childTableId: string; relationshipId: string; newColumnIds: string[] }

/**
 * 캔버스 드래그(자식→부모)를 관계 생성 계획으로 변환한다. 순수 함수(genId 주입).
 * source=자식, target=부모. 부모 PK가 없으면 no-parent-pk.
 */
export function planConnection(
  model: ProjectModel,
  conn: { source: string | null; target: string | null },
  genId: () => string,
): ConnectionPlan {
  if (!conn.source || !conn.target) return { ok: false, reason: 'invalid' }
  if (conn.source === conn.target) return { ok: false, reason: 'self' }
  const parentTableId = conn.target
  const childTableId = conn.source
  const pkCount = Object.values(model.columns).filter(
    (c) => c.tableId === parentTableId && c.isPk,
  ).length
  if (pkCount === 0) return { ok: false, reason: 'no-parent-pk' }
  return {
    ok: true,
    parentTableId,
    childTableId,
    relationshipId: genId(),
    newColumnIds: Array.from({ length: pkCount }, () => genId()),
  }
}

export type JunctionPlan =
  | { ok: false; reason: 'missing' | 'identifying' | 'no-pk' }
  | {
      ok: true
      junction: JunctionSpec
      a: { relationshipId: string; newColumnIds: string[] }
      b: { relationshipId: string; newColumnIds: string[] }
    }

const mid = (a: number, b: number) => Math.round((a + b) / 2)
const midPoint = (a: Position, b: Position): Position => ({ x: mid(a.x, b.x), y: mid(a.y, b.y) })

/**
 * 1:N 관계를 교차 테이블로 푸는 계획을 만든다. 순수 함수(genId 주입).
 * 가드는 core 의 resolveManyToMany 와 같은 규칙이다 — 버튼을 미리 잠그기 위해 여기서도 본다.
 * ⚠️ core 쪽 가드를 고치면 여기도 같이 고쳐야 한다. 둘이 어긋나면 버튼은 활성인데
 *    mutation 이 no-op 이 되어 "눌러도 아무 일이 없는" 상태가 된다.
 */
export function planJunction(
  model: ProjectModel,
  relationshipId: string,
  genId: () => string,
  ctx: { namingRules: NamingRules; activeGroupView: string | null },
): JunctionPlan {
  const rel = model.relationships[relationshipId]
  if (!rel) return { ok: false, reason: 'missing' }
  const parent = model.tables[rel.parentTableId]
  const child = model.tables[rel.childTableId]
  // 무테스트 가드다 — validateModelIntegrity 가 관계의 부모·자식 테이블 존재를 이미 검사하므로
  // 여기 걸리는 모델은 그 자체로 무결성 위반이고, 정상 경로로는 도달할 수 없다(core 와 같은 취지).
  // 그래도 남긴다: 동시편집으로 뒤늦게 도착한 mutation 이 깨진 모델을 만들지 않게 하는 방어다.
  if (!parent || !child) return { ok: false, reason: 'missing' }
  if (rel.identifying) return { ok: false, reason: 'identifying' }

  // PK 개수는 "FK 를 지운 뒤" 기준이다(설계 3.4).
  // 매핑은 같은 childColumnId 를 두 번 담을 수 있으므로(remapRelationshipChildColumn 이
  // 그렇게 만든다) 중복을 없애고 센다 — 중복을 세면 droppedPk 가 실제 삭제량보다 커진다.
  const fkColumnIds = [...new Set(rel.columnMappings.map((m) => m.childColumnId))]
  const droppedPk = fkColumnIds.filter((id) => model.columns[id]?.isPk).length
  const pks = (tableId: string) =>
    Object.values(model.columns).filter((c) => c.tableId === tableId && c.isPk)
  const parentPkCount = pks(parent.id).length
  const childPkCount = pks(child.id).length - droppedPk
  // <= 0 은 위 dedup 이 깨져도 음수가 '=== 0' 을 빠져나가지 못하게 하는 이중 방어다(core 와 동일).
  if (parentPkCount === 0 || childPkCount <= 0) return { ok: false, reason: 'no-pk' }

  const logicalName = junctionTableName(parent, child)
  const gen = generatePhysicalName(logicalName, model.words, model.terms, ctx.namingRules)
  // 빈 물리명은 DDL 생성을 깨뜨리므로 임시 이름으로 채운다(설계 5.2).
  const physicalName = gen.physicalName || nextTablePhysicalName(model)

  // 활성 그룹뷰가 이미 삭제된 그룹을 가리킬 수 있다 — 원격 resync 는 activeGroupView 를 일부러
  // 유지하므로(store.ts) 협업자가 그룹을 지우면 죽은 id 가 남는다. 없는 그룹을 참조하는 테이블은
  // 무결성 위반이라 mutation 이 통째로 거부되므로, core 의 setTableGroup 과 같이 미배정으로 떨군다.
  const groupId = ctx.activeGroupView && model.tableGroups[ctx.activeGroupView]
    ? ctx.activeGroupView : null
  return {
    ok: true,
    junction: {
      id: genId(),
      logicalName,
      physicalName,
      position: midPoint(parent.position, child.position),
      groupId,
      groupPosition: groupId
        ? midPoint(parent.groupPosition ?? parent.position, child.groupPosition ?? child.position)
        : null,
    },
    a: {
      relationshipId: genId(),
      newColumnIds: Array.from({ length: parentPkCount }, () => genId()),
    },
    b: {
      relationshipId: genId(),
      newColumnIds: Array.from({ length: childPkCount }, () => genId()),
    },
  }
}
