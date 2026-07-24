import { Trash2 } from 'lucide-react'
import { updateNote, removeNote } from './note-edits.js'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export function NotePanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const noteId = useEditorStore((s) => s.selectedNoteId)!
  const selectNote = useEditorStore((s) => s.selectNote)
  const mutate = useModelMutation(projectId)
  const note = model.notes[noteId]
  if (!note) return null
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">메모</h3>
        <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="메모 삭제"
          onClick={() => { selectNote(null); void mutate((m) => removeNote(m, noteId), { summary: '메모 삭제' }) }}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="note-content">내용</Label>
          <textarea id="note-content" className="min-h-24 rounded-md border bg-background p-2 text-sm"
            defaultValue={note.content} key={note.content}
            onBlur={(e) => { if (e.target.value !== note.content) void mutate((m) => updateNote(m, noteId, { content: e.target.value })) }} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="note-color">색상</Label>
          <input id="note-color" type="color" className="h-9 w-16 rounded border bg-background"
            defaultValue={note.color} key={note.color}
            onBlur={(e) => { if (e.target.value !== note.color) void mutate((m) => updateNote(m, noteId, { color: e.target.value })) }} />
        </div>
      </div>
    </aside>
  )
}
