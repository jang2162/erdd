import type { Note, Position, ProjectModel } from '@erdd/core'

const DEFAULT_COLOR = '#FDF6E3'

export function addNote(model: ProjectModel, { id, position }: { id: string; position: Position }): ProjectModel {
  const note: Note = { id, content: '메모', position, color: DEFAULT_COLOR }
  return { ...model, notes: { ...model.notes, [id]: note } }
}
export function moveNote(model: ProjectModel, id: string, position: Position): ProjectModel {
  const note = model.notes[id]
  if (!note) return model
  return { ...model, notes: { ...model.notes, [id]: { ...note, position } } }
}
export function updateNote(model: ProjectModel, id: string, patch: Partial<Pick<Note, 'content' | 'color'>>): ProjectModel {
  const note = model.notes[id]
  if (!note) return model
  return { ...model, notes: { ...model.notes, [id]: { ...note, ...patch } } }
}
export function removeNote(model: ProjectModel, id: string): ProjectModel {
  const notes = { ...model.notes }
  delete notes[id]
  return { ...model, notes }
}
