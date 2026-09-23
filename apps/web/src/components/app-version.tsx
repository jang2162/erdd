import { cn } from '@/lib/utils'

/**
 * 제품 버전(`@erdd/cli` 의 버전) — 워드마크 옆에 붙인다. 값은 빌드 시 주입된다
 * (→ docs/guides/release.md 「웹 번들 — `packages/cli/web/`」). 로컬 모드에는 사용자 메뉴가 없어
 * 메뉴가 아니라 헤더에 둔다.
 */
export function AppVersion({ className }: { className?: string }) {
  return (
    <span className={cn('font-mono text-xs text-muted-foreground', className)}>v{__ERDD_VERSION__}</span>
  )
}
