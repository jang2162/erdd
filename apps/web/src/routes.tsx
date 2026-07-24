import type { ReactNode } from 'react'
import { createBrowserRouter } from 'react-router'
import { LoginPage } from '@/pages/login'
import { AdminPage } from '@/pages/admin'
import { HomePage } from '@/pages/home'
import { OrgDetailPage } from '@/pages/org-detail'
import { ProjectPage } from '@/pages/project'
import { SettingsPage } from '@/pages/settings'
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

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/', element: <Protected><HomePage /></Protected> },
  { path: '/org/:orgId', element: <Protected><OrgDetailPage /></Protected> },
  { path: '/admin', element: <Protected adminOnly><AdminPage /></Protected> },
  { path: '/settings', element: <Protected><SettingsPage /></Protected> },
  { path: '/p/:projectId', element: <Protected><ProjectPage /></Protected> },
])
