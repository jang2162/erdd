import { Plus, Trash2 } from 'lucide-react'
import { useReactFlow } from '@xyflow/react'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { addTable, removeTable } from './model-edits.js'
import { Button } from '@/components/ui/button'

export function Toolbar({ projectId }: { projectId: string }) {
  const mutate = useModelMutation(projectId)
  const selectedTableId = useEditorStore((s) => s.selectedTableId)
  const select = useEditorStore((s) => s.select)
  const rf = useReactFlow()

  const onAdd = () => {
    const id = newId()
    const center = rf.screenToFlowPosition({
      x: window.innerWidth / 2, y: window.innerHeight / 2,
    })
    void mutate((m) => addTable(m, { id, position: center }), { summary: '테이블 추가' })
    select(id)
  }
  const onDelete = () => {
    if (!selectedTableId) return
    const id = selectedTableId
    select(null)
    void mutate((m) => removeTable(m, id), { summary: '테이블 삭제' })
  }

  return (
    <div className="flex items-center gap-2">
      <Button size="sm" onClick={onAdd}><Plus /> 테이블 추가</Button>
      <Button size="sm" variant="outline" disabled={!selectedTableId} onClick={onDelete}>
        <Trash2 /> 삭제
      </Button>
    </div>
  )
}
