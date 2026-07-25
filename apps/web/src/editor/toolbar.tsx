import { FileText, Plus, Redo2, Trash2, Undo2 } from 'lucide-react'
import { useEffect } from 'react'
import { useReactFlow } from '@xyflow/react'
import { setTableGroup } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation, useUndoRedo } from './use-model.js'
import { newId } from './uid.js'
import { addTable, removeTable } from './model-edits.js'
import { addNote } from './note-edits.js'
import { Button } from '@/components/ui/button'

export function Toolbar({ projectId }: { projectId: string }) {
  const mutate = useModelMutation(projectId)
  const { undo, redo, canUndo, canRedo } = useUndoRedo(projectId)
  const selectedTableId = useEditorStore((s) => s.selectedTableId)
  const activeGroupView = useEditorStore((s) => s.activeGroupView)
  const select = useEditorStore((s) => s.select)
  const selectNote = useEditorStore((s) => s.selectNote)
  const rf = useReactFlow()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      if (!meta || e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      e.preventDefault()
      if (e.shiftKey) void redo()
      else void undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const onAdd = () => {
    const id = newId()
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    const agv = activeGroupView
    void mutate((m) => {
      let n = addTable(m, { id, position: center })
      if (agv) n = setTableGroup(n, id, agv)
      return n
    }, { summary: '테이블 추가' })
    select(id)
  }
  const onDelete = () => {
    if (!selectedTableId) return
    const id = selectedTableId
    select(null)
    void mutate((m) => removeTable(m, id), { summary: '테이블 삭제' })
  }
  const onAddNote = () => {
    const id = newId()
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    void mutate((m) => addNote(m, { id, position: center }), { summary: '메모 추가' })
    selectNote(id)
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={onAdd}><Plus /> 테이블 추가</Button>
      <Button size="sm" variant="outline" disabled={!!activeGroupView} onClick={onAddNote}><FileText /> 메모</Button>
      <Button size="sm" variant="outline" disabled={!selectedTableId} onClick={onDelete}>
        <Trash2 /> 삭제
      </Button>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button size="icon" variant="ghost" className="size-8" disabled={!canUndo} aria-label="실행 취소" onClick={() => void undo()}>
        <Undo2 className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" className="size-8" disabled={!canRedo} aria-label="다시 실행" onClick={() => void redo()}>
        <Redo2 className="size-4" />
      </Button>
    </div>
  )
}
