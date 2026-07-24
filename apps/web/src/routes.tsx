import type { ReactNode } from 'react'
import { createBrowserRouter, Link } from 'react-router'
import { LoginPage } from '@/pages/login'
import { AdminPage } from '@/pages/admin'
import { HomePage } from '@/pages/home'
import { OrgDetailPage } from '@/pages/org-detail'
import { ProjectPage } from '@/pages/project'
import { SettingsPage } from '@/pages/settings'
import { RequireAuth } from '@/components/require-auth'
import { AppShell } from '@/components/app-shell'
import { UserMenu } from '@/components/user-menu'
import { BrandWordmark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'

function Protected({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  return (
    <RequireAuth adminOnly={adminOnly}>
      <AppShell userMenu={<UserMenu />}>{children}</AppShell>
    </RequireAuth>
  )
}

function NotFoundPage() {
  return (
    <div className="bg-dotgrid flex min-h-dvh items-center justify-center p-4">
      <div className="grid justify-items-center gap-3 rounded-lg border bg-card p-8 text-center shadow-sm">
        <BrandWordmark className="mb-2" />
        <p className="font-medium">페이지를 찾을 수 없습니다</p>
        <Button asChild>
          <Link to="/">홈으로</Link>
        </Button>
      </div>
    </div>
  )
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/', element: <Protected><HomePage /></Protected> },
  { path: '/org/:orgId', element: <Protected><OrgDetailPage /></Protected> },
  { path: '/admin', element: <Protected adminOnly><AdminPage /></Protected> },
  { path: '/settings', element: <Protected><SettingsPage /></Protected> },
  { path: '/p/:projectId', element: <Protected><ProjectPage /></Protected> },
  { path: '*', element: <NotFoundPage /> },
])
