import type { ReactNode } from 'react'
import { createBrowserRouter } from 'react-router'
import { LoginPage } from '@/pages/login'
import { AdminPage } from '@/pages/admin'
import { RequireAuth } from '@/components/require-auth'
import { AppShell } from '@/components/app-shell'
import { UserMenu } from '@/components/user-menu'

function Protected({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  return (
    <RequireAuth adminOnly={adminOnly}>
      <AppShell userMenu={<UserMenu />}>{children}</AppShell>
    </RequireAuth>
  )
}

function Placeholder({ name }: { name: string }) {
  return <p className="text-muted-foreground">{name} — 준비 중</p>
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/', element: <Protected><Placeholder name="홈" /></Protected> },
  { path: '/admin', element: <Protected adminOnly><AdminPage /></Protected> },
  { path: '/settings', element: <Protected><Placeholder name="설정" /></Protected> },
  { path: '/p/:projectId', element: <Protected><Placeholder name="프로젝트" /></Protected> },
])
