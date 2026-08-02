import { Trash2 } from 'lucide-react'
import { updateNote, removeNote } from './note-edits.js'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export function NotePanel({ projectId }: { projectId: string }) {
  const model = useEditorStore((s) => s.model)
  const canEdit = useEditorStore((s) => s.canEdit)
  const noteId = useEditorStore((s) => s.selectedNoteId)!
  const selectNote = useEditorStore((s) => s.selectNote)
  const mutate = useModelMutation(projectId)
  const note = model.notes[noteId]
  if (!note) return null
  return (
    <aside className="w-80 shrink-0 overflow-y-auto border-l bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">메모</h3>
        {canEdit && (
          <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="메모 삭제"
            onClick={() => { selectNote(null); void mutate((m) => removeNote(m, noteId), { summary: '메모 삭제' }) }}>
            <Trash2 className="size-4" />
          </Button>
        )}
      </div>
      <div className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="note-content">내용</Label>
          <textarea id="note-content" className="min-h-24 rounded-md border bg-background p-2 text-sm"
            defaultValue={note.content} key={note.content} readOnly={!canEdit}
            onBlur={(e) => {
              // e.target 값은 호출 시점에 즉시 읽는다(직렬화 지연 실행 시 옛 DOM 값 방지).
              const content = e.target.value
              if (content !== note.content) void mutate((m) => updateNote(m, noteId, { content }))
            }} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="note-color">색상</Label>
          {/* color input은 readOnly가 동작하지 않아(브라우저가 무시) disabled로 잠근다. */}
          <input id="note-color" type="color" className="h-9 w-16 rounded border bg-background"
            defaultValue={note.color} key={note.color} disabled={!canEdit}
            onBlur={(e) => {
              const color = e.target.value
              if (color !== note.color) void mutate((m) => updateNote(m, noteId, { color }))
            }} />
        </div>
      </div>
    </aside>
  )
}
