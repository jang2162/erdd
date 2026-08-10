import { create } from 'zustand'
import {
  createEmptyModel, DEFAULT_NAMING_RULES, type Dialect, type NamingRules, type Op, type Peer,
  type ProjectModel,
} from '@erdd/core'

export type ViewMode = 'logical' | 'physical' | 'mixed'
const HISTORY_CAP = 100

type EditorState = {
  model: ProjectModel
  seq: number
  loaded: boolean
  loadedProjectId: string | null
  namingRules: NamingRules
  dialects: Dialect[]
  /** 프로젝트 이름(버전 모델 밖, project.get). DBML 의 Project 블록에 쓴다. */
  projectName: string | null
  /** 모델을 편집할 수 있는가(서버 판정). 로드 전 기본값 false — fail-closed. */
  canEdit: boolean
  /** 프로젝트를 관리할 수 있는가(스냅샷 복원·삭제). 로드 전 기본값 false. */
  canManage: boolean
  viewMode: ViewMode
  /** 선택된 테이블. 순서 = 선택한 순서. [0]이 presence·사이드바의 기준이다. */
  selectedTableIds: string[]
  /** 선택된 컬럼. selectedTableIds.length === 1 일 때만 비어 있지 않을 수 있다(불변식). */
  selectedColumnIds: string[]
  selectedRelationshipId: string | null
  selectedNoteId: string | null
  selectedGroupId: string | null
  focusTableId: string | null
  activeGroupView: string | null
  undoStack: Op[][]
  redoStack: Op[][]
  peers: Peer[]
  setLoaded: (model: ProjectModel, seq: number, projectId: string) => void
  setProjectConfig: (
    namingRules: NamingRules, dialects: Dialect[], projectName: string | null,
  ) => void
  setPermissions: (perms: { canEdit: boolean; canManage: boolean }) => void
  setModel: (model: ProjectModel) => void
  setSeq: (seq: number) => void
  setPeers: (peers: Peer[]) => void
  /** 서버 상태로 통째 되맞춘다(실시간 seq 간극·재접속). setLoaded와 달리 그룹 뷰를 유지한다. */
  resync: (model: ProjectModel, seq: number) => void
  setViewMode: (viewMode: ViewMode) => void
  select: (tableId: string | null) => void
  selectTables: (ids: string[]) => void
  toggleTable: (id: string) => void
  selectColumn: (tableId: string, columnId: string, mode: 'replace' | 'toggle' | 'range') => void
  selectRelationship: (id: string | null) => void
  selectNote: (id: string | null) => void
  selectGroup: (id: string | null) => void
  focus: (tableId: string) => void
  consumeFocus: () => void
  enterGroupView: (groupId: string) => void
  exitGroupView: () => void
  recordEdit: (ops: Op[]) => void
  moveUndoToRedo: () => Op[] | null
  moveRedoToUndo: () => Op[] | null
  reset: () => void
}

const CLEARED_SELECTION = {
  selectedTableIds: [] as string[], selectedColumnIds: [] as string[],
  selectedRelationshipId: null, selectedNoteId: null, selectedGroupId: null,
}

export const useEditorStore = create<EditorState>((set, get) => ({
  model: createEmptyModel(),
  seq: 0,
  loaded: false,
  loadedProjectId: null,
  namingRules: DEFAULT_NAMING_RULES,
  dialects: [],
  projectName: null,
  canEdit: false,
  canManage: false,
  viewMode: 'physical',
  ...CLEARED_SELECTION,
  focusTableId: null,
  activeGroupView: null,
  undoStack: [],
  redoStack: [],
  peers: [],
  setLoaded: (model, seq, projectId) =>
    set({
      model, seq, loaded: true, loadedProjectId: projectId,
      undoStack: [], redoStack: [], activeGroupView: null, peers: [],
    }),
  setProjectConfig: (namingRules, dialects, projectName) =>
    set({ namingRules, dialects, projectName }),
  setPermissions: ({ canEdit, canManage }) => set({ canEdit, canManage }),
  setModel: (model) => set({ model }),
  setSeq: (seq) => set((s) => ({ seq: Math.max(s.seq, seq) })),
  setPeers: (peers) => set({ peers }),
  // undo 스택은 버린다(되돌리려는 op가 이미 사라진 대상을 가리킬 수 있다).
  // activeGroupView는 유지한다 — 남이 편집할 때마다 그룹 뷰에서 튕기면 못 쓴다.
  // 선택은 대상이 아직 존재할 때만 남긴다.
  resync: (model, seq) => set((s) => {
    const keep = (id: string | null, rec: Record<string, unknown>) =>
      (id !== null && Object.hasOwn(rec, id) ? id : null)
    const tableIds = s.selectedTableIds.filter((id) => Object.hasOwn(model.tables, id))
    // 컬럼은 테이블이 남아 있고 컬럼 자신도 남아 있을 때만 유지한다.
    const columnIds = tableIds.length === 1
      ? s.selectedColumnIds.filter((id) => {
          const c = model.columns[id]
          return c !== undefined && c.tableId === tableIds[0]
        })
      : []
    return {
      model, seq, loaded: true, undoStack: [], redoStack: [],
      selectedTableIds: tableIds,
      selectedColumnIds: columnIds,
      selectedRelationshipId: keep(s.selectedRelationshipId, model.relationships),
      selectedNoteId: keep(s.selectedNoteId, model.notes),
      selectedGroupId: keep(s.selectedGroupId, model.tableGroups),
    }
  }),
  setViewMode: (viewMode) => set({ viewMode }),
  select: (tableId) => set({
    ...CLEARED_SELECTION, selectedTableIds: tableId === null ? [] : [tableId],
  }),
  selectTables: (ids) => set({ ...CLEARED_SELECTION, selectedTableIds: [...ids] }),
  // 컬럼 선택은 테이블이 하나일 때만 성립한다(불변식) — 토글로 2개가 되면 비운다.
  toggleTable: (id) => set((s) => {
    const has = s.selectedTableIds.includes(id)
    const next = has ? s.selectedTableIds.filter((x) => x !== id) : [...s.selectedTableIds, id]
    return {
      ...CLEARED_SELECTION,
      selectedTableIds: next,
      selectedColumnIds: next.length === 1 && s.selectedTableIds.length === 1 && next[0] === s.selectedTableIds[0]
        ? s.selectedColumnIds
        : [],
    }
  }),
  selectColumn: (tableId, columnId, mode) => set((s) => {
    const sameTable = s.selectedTableIds.length === 1 && s.selectedTableIds[0] === tableId
    const base = sameTable ? s.selectedColumnIds : []
    let next: string[]
    if (mode === 'toggle') {
      next = base.includes(columnId) ? base.filter((x) => x !== columnId) : [...base, columnId]
    } else if (mode === 'range' && base.length > 0) {
      const anchor = base[base.length - 1]!
      const ordered = Object.values(s.model.columns)
        .filter((c) => c.tableId === tableId)
        .sort((a, b) => a.order - b.order)
        .map((c) => c.id)
      const i = ordered.indexOf(anchor)
      const j = ordered.indexOf(columnId)
      next = i === -1 || j === -1 ? [columnId] : ordered.slice(Math.min(i, j), Math.max(i, j) + 1)
    } else {
      next = [columnId]
    }
    return { ...CLEARED_SELECTION, selectedTableIds: [tableId], selectedColumnIds: next }
  }),
  selectRelationship: (selectedRelationshipId) => set({ ...CLEARED_SELECTION, selectedRelationshipId }),
  selectNote: (selectedNoteId) => set({ ...CLEARED_SELECTION, selectedNoteId }),
  selectGroup: (selectedGroupId) => set({ ...CLEARED_SELECTION, selectedGroupId }),
  focus: (id) => set({ ...CLEARED_SELECTION, focusTableId: id, selectedTableIds: [id] }),
  consumeFocus: () => set({ focusTableId: null }),
  enterGroupView: (activeGroupView) => set({ ...CLEARED_SELECTION, activeGroupView }),
  exitGroupView: () => set({ ...CLEARED_SELECTION, activeGroupView: null }),
  recordEdit: (ops) =>
    set((s) => ({ undoStack: [...s.undoStack, ops].slice(-HISTORY_CAP), redoStack: [] })),
  moveUndoToRedo: () => {
    const { undoStack, redoStack } = get()
    const ops = undoStack[undoStack.length - 1]
    if (!ops) return null
    set({ undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, ops] })
    return ops
  },
  moveRedoToUndo: () => {
    const { undoStack, redoStack } = get()
    const ops = redoStack[redoStack.length - 1]
    if (!ops) return null
    set({ redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, ops] })
    return ops
  },
  reset: () => set({
    model: createEmptyModel(), seq: 0, loaded: false, loadedProjectId: null,
    namingRules: DEFAULT_NAMING_RULES, dialects: [], projectName: null, peers: [],
    canEdit: false, canManage: false,
    ...CLEARED_SELECTION, focusTableId: null, activeGroupView: null, undoStack: [], redoStack: [],
  }),
}))
