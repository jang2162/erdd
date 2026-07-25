import { create } from 'zustand'
import { createEmptyModel, type Op, type ProjectModel } from '@erdd/core'

export type ViewMode = 'logical' | 'physical' | 'mixed'
const HISTORY_CAP = 100

type EditorState = {
  model: ProjectModel
  seq: number
  loaded: boolean
  loadedProjectId: string | null
  viewMode: ViewMode
  selectedTableId: string | null
  selectedRelationshipId: string | null
  selectedNoteId: string | null
  selectedGroupId: string | null
  focusTableId: string | null
  activeGroupView: string | null
  undoStack: Op[][]
  redoStack: Op[][]
  setLoaded: (model: ProjectModel, seq: number, projectId: string) => void
  setModel: (model: ProjectModel) => void
  setSeq: (seq: number) => void
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
  viewMode: 'physical',
  selectedTableId: null,
  selectedRelationshipId: null,
  selectedNoteId: null,
  selectedGroupId: null,
  focusTableId: null,
  activeGroupView: null,
  undoStack: [],
  redoStack: [],
  setLoaded: (model, seq, projectId) =>
    set({
      model, seq, loaded: true, loadedProjectId: projectId,
      undoStack: [], redoStack: [], activeGroupView: null,
    }),
  setModel: (model) => set({ model }),
  setSeq: (seq) => set((s) => ({ seq: Math.max(s.seq, seq) })),
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
    ...CLEARED_SELECTION, focusTableId: null, activeGroupView: null, undoStack: [], redoStack: [],
  }),
}))
