import { useEditorStore, type ViewMode } from './store.js'
import { Button } from '@/components/ui/button'

const MODES: { value: ViewMode; label: string }[] = [
  { value: 'logical', label: '논리명' },
  { value: 'physical', label: '물리명' },
  { value: 'mixed', label: '혼합' },
]

export function ViewModeToggle() {
  const viewMode = useEditorStore((s) => s.viewMode)
  const setViewMode = useEditorStore((s) => s.setViewMode)
  return (
    <div className="flex rounded-md border p-0.5">
      {MODES.map((m) => (
        <Button
          key={m.value} size="sm"
          variant={viewMode === m.value ? 'secondary' : 'ghost'}
          className="h-7 px-2 text-xs"
          onClick={() => setViewMode(m.value)}
        >
          {m.label}
        </Button>
      ))}
    </div>
  )
}
