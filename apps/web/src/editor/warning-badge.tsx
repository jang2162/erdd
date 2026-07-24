import { AlertTriangle } from 'lucide-react'
import type { Warning } from '@erdd/core'
import { cn } from '@/lib/utils'

export function WarningBadge({ warnings, className }: { warnings: Warning[]; className?: string }) {
  if (warnings.length === 0) return null
  const title = warnings.map((w) => w.message).join('\n')
  return (
    <span title={title} aria-label={`경고 ${warnings.length}건: ${title}`}
      className={cn('inline-flex items-center gap-0.5 rounded px-1 text-[10px] font-medium text-key', className)}>
      <AlertTriangle className="size-3" />
      {warnings.length}
    </span>
  )
}
