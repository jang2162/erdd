import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { BrandWordmark } from '@/components/brand-mark'

/** 로그인 이후 화면의 공통 셸 — 상단바 + 콘텐츠. userMenu는 Task 2에서 주입. */
export function AppShell({ children, userMenu }: { children: ReactNode; userMenu?: ReactNode }) {
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b bg-card">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link to="/" aria-label="홈으로">
            <BrandWordmark />
          </Link>
          {userMenu}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}
