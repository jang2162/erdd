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
  viewMode: ViewMode
  selectedTableId: string | null
  selectedRelationshipId: string | null
  selectedNoteId: string | null
  selectedGroupId: string | null
  focusTableId: string | null
  activeGroupView: string | null
  undoStack: Op[][]
  redoStack: Op[][]
  peers: Peer[]
  setLoaded: (model: ProjectModel, seq: number, projectId: string) => void
  setProjectConfig: (namingRules: NamingRules, dialects: Dialect[]) => void
  setModel: (model: ProjectModel) => void
  setSeq: (seq: number) => void
  setPeers: (peers: Peer[]) => void
  /** 서버 상태로 통째 되맞춘다(실시간 seq 간극·재접속). setLoaded와 달리 그룹 뷰를 유지한다. */
  resync: (model: ProjectModel, seq: number) => void
  setViewMode: (viewMode: ViewMode) => void
  select: (tableId: string | null) => void
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
  selectedTableId: null, selectedRelationshipId: null, selectedNoteId: null, selectedGroupId: null,
}

export const useEditorStore = create<EditorState>((set, get) => ({
  model: createEmptyModel(),
  seq: 0,
  loaded: false,
  loadedProjectId: null,
  namingRules: DEFAULT_NAMING_RULES,
  dialects: [],
  viewMode: 'physical',
  selectedTableId: null,
  selectedRelationshipId: null,
  selectedNoteId: null,
  selectedGroupId: null,
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
  setProjectConfig: (namingRules, dialects) => set({ namingRules, dialects }),
  setModel: (model) => set({ model }),
  setSeq: (seq) => set((s) => ({ seq: Math.max(s.seq, seq) })),
  setPeers: (peers) => set({ peers }),
  // undo 스택은 버린다(되돌리려는 op가 이미 사라진 대상을 가리킬 수 있다).
  // activeGroupView는 유지한다 — 남이 편집할 때마다 그룹 뷰에서 튕기면 못 쓴다.
  // 선택은 대상이 아직 존재할 때만 남긴다.
  resync: (model, seq) => set((s) => {
    const keep = (id: string | null, rec: Record<string, unknown>) =>
      (id !== null && Object.hasOwn(rec, id) ? id : null)
    return {
      model, seq, loaded: true, undoStack: [], redoStack: [],
      selectedTableId: keep(s.selectedTableId, model.tables),
      selectedRelationshipId: keep(s.selectedRelationshipId, model.relationships),
      selectedNoteId: keep(s.selectedNoteId, model.notes),
      selectedGroupId: keep(s.selectedGroupId, model.tableGroups),
    }
  }),
  setViewMode: (viewMode) => set({ viewMode }),
  select: (selectedTableId) => set({ ...CLEARED_SELECTION, selectedTableId }),
  selectRelationship: (selectedRelationshipId) => set({ ...CLEARED_SELECTION, selectedRelationshipId }),
  selectNote: (selectedNoteId) => set({ ...CLEARED_SELECTION, selectedNoteId }),
  selectGroup: (selectedGroupId) => set({ ...CLEARED_SELECTION, selectedGroupId }),
  focus: (id) => set({ ...CLEARED_SELECTION, focusTableId: id, selectedTableId: id }),
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
    namingRules: DEFAULT_NAMING_RULES, dialects: [], peers: [],
    ...CLEARED_SELECTION, focusTableId: null, activeGroupView: null, undoStack: [], redoStack: [],
  }),
}))
