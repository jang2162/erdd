import { gridPositions } from './file-merge.js'
import type { Note, Position, ProjectModel } from './model.js'

export type TableLayout = {
  id: string
  /** 사람이 읽기 위한 값. identity 는 id 다 — 물리명이 바뀌어도 매칭에 쓰지 않는다. */
  name: string
  position: Position
  groupPosition: Position | null
}

export type LayoutData = {
  tables: TableLayout[]
  notes: Note[]
}

/**
 * 물리명 오름차순, 같으면 id 오름차순. **정렬이 흔들리면 아무것도 안 바꿔도 git diff 가 뜬다** —
 * layout.yaml 은 커밋 대상이므로 순서가 계약이다.
 */
function orderedTables(model: ProjectModel) {
  return Object.values(model.tables).sort((a, b) =>
    a.physicalName === b.physicalName
      ? (a.id < b.id ? -1 : 1)
      : (a.physicalName < b.physicalName ? -1 : 1))
}

export function layoutFromModel(model: ProjectModel): LayoutData {
  return {
    tables: orderedTables(model).map((t) => ({
      id: t.id,
      name: t.physicalName,
      position: { ...t.position },
      groupPosition: t.groupPosition === null ? null : { ...t.groupPosition },
    })),
    notes: Object.values(model.notes)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((n) => ({ ...n, position: { ...n.position } })),
  }
}

/**
 * layout 의 좌표를 모델에 되꽂는다. **layout 에 없는 테이블은 이미 놓인 것들 아래 격자에 둔다** —
 * `filesToModel` 은 모든 테이블에 `{x:0, y:0}` 을 주므로(file-format.ts) 그대로 두면 `erdd pull`
 * 직후 모든 테이블이 한 점에 겹쳐 아무것도 읽을 수 없다.
 *
 * 격자는 `gridPositions`(file-merge.ts) 를 그대로 쓴다 — CLI push 가 좌표 없는 신규 테이블을
 * 놓는 데 쓰는 같은 함수다. 더 나은 배치는 에디터의 「자동 정렬」(dagre)이 하고 **dagre 는
 * apps/web 전용이다** — core 에 들이지 않는다.
 */
export function applyLayout(model: ProjectModel, layout: LayoutData): ProjectModel {
  const byId = new Map(layout.tables.map((t) => [t.id, t]))
  const tables: ProjectModel['tables'] = {}
  const missing: string[] = []

  // 순회는 **물리명 순서**다 — 객체 키 순서(= 파일을 읽은 순서)에 기대면 파일 하나를 고칠 때마다
  // 남의 테이블 자리가 움직인다.
  for (const t of orderedTables(model)) {
    const entry = byId.get(t.id)
    if (entry === undefined) {
      missing.push(t.id)
      tables[t.id] = { ...t, groupPosition: null }
      continue
    }
    tables[t.id] = {
      ...t,
      position: { ...entry.position },
      groupPosition: entry.groupPosition === null ? null : { ...entry.groupPosition },
    }
  }

  if (missing.length > 0) {
    // 좌표가 정해진 것들만 놓고 그 아래에서 시작한다 — 이미 놓인 테이블과 겹치지 않는다.
    const placed = Object.fromEntries(
      Object.entries(tables).filter(([id]) => !missing.includes(id)),
    )
    const spots = gridPositions({ ...model, tables: placed }, missing.length)
    missing.forEach((id, i) => { tables[id] = { ...tables[id]!, position: spots[i]! } })
  }

  const notes: ProjectModel['notes'] = {}
  for (const n of layout.notes) notes[n.id] = { ...n, position: { ...n.position } }
  return { ...model, tables, notes }
}
