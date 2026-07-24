import { create } from 'zustand'
import { createEmptyModel, type ProjectModel } from '@erdd/core'

export type ViewMode = 'logical' | 'physical' | 'mixed'

type EditorState = {
  model: ProjectModel
  seq: number
  loaded: boolean
  viewMode: ViewMode
  selectedTableId: string | null
  focusTableId: string | null
  setLoaded: (model: ProjectModel, seq: number) => void
  setModel: (model: ProjectModel) => void
  setSeq: (seq: number) => void
  setViewMode: (viewMode: ViewMode) => void
  select: (tableId: string | null) => void
  focus: (tableId: string) => void
  consumeFocus: () => void
  reset: () => void
}

export const useEditorStore = create<EditorState>((set) => ({
  model: createEmptyModel(),
  seq: 0,
  loaded: false,
  viewMode: 'physical',
  selectedTableId: null,
  focusTableId: null,
  setLoaded: (model, seq) => set({ model, seq, loaded: true }),
  setModel: (model) => set({ model }),
  setSeq: (seq) => set({ seq }),
  setViewMode: (viewMode) => set({ viewMode }),
  select: (selectedTableId) => set({ selectedTableId }),
  focus: (id) => set({ focusTableId: id, selectedTableId: id }),
  consumeFocus: () => set({ focusTableId: null }),
  reset: () => set({
    model: createEmptyModel(), seq: 0, loaded: false, selectedTableId: null, focusTableId: null,
  }),
}))
