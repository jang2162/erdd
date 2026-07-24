import type { NodeProps } from '@xyflow/react'
import type { Note } from '@erdd/core'

export type NoteNodeData = { note: Note; selected: boolean }

export function NoteNode({ data }: NodeProps) {
  const { note, selected } = data as unknown as NoteNodeData
  return (
    <div
      className="min-h-16 min-w-40 max-w-64 rounded-md border p-2 text-xs shadow-sm"
      style={{ background: note.color, borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
        outline: selected ? '2px solid var(--color-primary)' : undefined }}
    >
      <p className="whitespace-pre-wrap break-words text-foreground/90">{note.content}</p>
    </div>
  )
}
