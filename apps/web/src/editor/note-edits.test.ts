import { describe, expect, it } from 'vitest'
import { createEmptyModel, diffModels } from '@erdd/core'
import { addNote, moveNote, removeNote, updateNote } from './note-edits.js'

describe('note-edits', () => {
  it('addNote inserts a note with default content and color', () => {
    const m = addNote(createEmptyModel(), { id: 'n1', position: { x: 10, y: 20 } })
    expect(m.notes['n1']).toMatchObject({
      id: 'n1', content: '메모', color: '#FDF6E3', position: { x: 10, y: 20 },
    })
    const ops = diffModels(createEmptyModel(), m)
    expect(ops).toHaveLength(1)
    expect(ops[0]!.action).toBe('create')
  })

  it('moveNote changes only the position (one update op)', () => {
    const base = addNote(createEmptyModel(), { id: 'n1', position: { x: 0, y: 0 } })
    const next = moveNote(base, 'n1', { x: 999, y: 888 })
    const ops = diffModels(base, next)
    expect(ops).toEqual([
      { action: 'update', entity: 'note', entityId: 'n1',
        changes: { position: { from: { x: 0, y: 0 }, to: { x: 999, y: 888 } } } },
    ])
  })

  it('updateNote patches content and color', () => {
    const base = addNote(createEmptyModel(), { id: 'n1', position: { x: 0, y: 0 } })
    const next = updateNote(base, 'n1', { content: '수정된 메모', color: '#ffffff' })
    expect(next.notes['n1']).toMatchObject({ content: '수정된 메모', color: '#ffffff' })
  })

  it('removeNote deletes the note', () => {
    const base = addNote(createEmptyModel(), { id: 'n1', position: { x: 0, y: 0 } })
    const next = removeNote(base, 'n1')
    expect(next.notes['n1']).toBeUndefined()
  })

  it('moveNote/updateNote/removeNote no-op on a missing id', () => {
    const base = createEmptyModel()
    expect(moveNote(base, 'missing', { x: 1, y: 1 })).toBe(base)
    expect(updateNote(base, 'missing', { content: 'x' })).toBe(base)
    expect(removeNote(base, 'missing')).toEqual(base)
  })
})
