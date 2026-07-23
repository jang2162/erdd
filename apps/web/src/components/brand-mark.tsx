import { cn } from '@/lib/utils'

/** 테이블 노드 글리프 — 둥근 사각형 + 3행, 첫 행에 골드 키 점. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={cn('size-6', className)}>
      <rect x="2.5" y="3" width="19" height="18" rx="3" stroke="currentColor" strokeWidth="2" />
      <line x1="2.5" y1="9.5" x2="21.5" y2="9.5" stroke="currentColor" strokeWidth="2" />
      <line x1="7" y1="14" x2="17" y2="14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="7" y1="17.5" x2="14" y2="17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="6.5" cy="6.25" r="1.6" fill="var(--key)" />
    </svg>
  )
}

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-mono text-lg font-bold tracking-tight', className)}>
      <BrandMark className="text-primary" />
      ERDD
    </span>
  )
}
