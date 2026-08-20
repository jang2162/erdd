import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { BrandWordmark } from '@/components/brand-mark'
import { PendingPromotionsBadge } from '@/components/pending-promotions-badge'

/**
 * 로그인 이후 화면의 공통 셸 — 상단바 + 콘텐츠. userMenu는 Task 2에서 주입.
 *
 * `isLocal`은 prop 으로 받는다 — `useIsLocal`은 `MeContext`(=RequireAuth 안)를 요구하는데
 * `AppShell` 자신은 단독으로도 렌더된다(`app-shell.test.tsx`). 계산은 `routes.tsx`의
 * `Protected`(RequireAuth 안)가 하고 여기로 내린다. **필수 prop 이다** — 옵셔널이면 호출부가
 * 빠뜨려도 타입 오류 없이 서버 동작(배지 폴링)으로 조용히 열린다(리뷰 M-1).
 */
export function AppShell({ children, userMenu, isLocal }: {
  children: ReactNode; userMenu?: ReactNode; isLocal: boolean
}) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" aria-label="홈으로">
            <BrandWordmark />
          </Link>
          <div className="flex items-center gap-3">
            {/* 승격 배지는 promotion.pendingCount 를 60초마다 폴링한다 — 로컬 라우터에 없는 프로시저다. */}
            {!isLocal && <PendingPromotionsBadge />}
            {userMenu}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}
