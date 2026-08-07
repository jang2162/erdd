import type { ReactNode } from 'react'
import { createBrowserRouter, Link, type RouteObject } from 'react-router'
import { LoginPage } from '@/pages/login'
import { AdminPage } from '@/pages/admin'
import { HomePage } from '@/pages/home'
import { InviteAcceptPage } from '@/pages/invite-accept'
import { OrgDetailPage } from '@/pages/org-detail'
import { ResetPasswordPage } from '@/pages/reset-password'
import { ProjectPage } from '@/pages/project'
import { ProjectSettingsPage } from '@/pages/project-settings'
import { SettingsPage } from '@/pages/settings'
import { RequireAuth } from '@/components/require-auth'
import { AppShell } from '@/components/app-shell'
import { UserMenu } from '@/components/user-menu'
import { BrandWordmark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'

/** bare: true면 AppShell 없이 RequireAuth만 적용한다(에디터처럼 자체 전체화면 레이아웃을 쓰는 라우트용). */
function Protected(
  { children, adminOnly, bare }: { children: ReactNode; adminOnly?: boolean; bare?: boolean },
) {
  if (bare) return <RequireAuth adminOnly={adminOnly}>{children}</RequireAuth>
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

/**
 * 라우트 표. **`router`가 아니라 이 배열을 export 하는 것이 의도다** — 테스트가 실제 표를
 * 그대로 렌더해 어느 경로가 `Protected` 밖에 있는지 검증한다(`routes.test.tsx`).
 * 페이지 컴포넌트를 스텁에 직접 꽂아 보면 여기서 `Protected`로 감싸도 통과해 버린다.
 */
export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  // 아래 둘은 **비보호다**. 초대받은 사람에게는 아직 계정이 없고, 비밀번호를 잊은 사람은
  // 로그인할 수 없다 — Protected로 감싸면 두 링크가 영원히 열리지 않는다.
  // 유효한 일회용 토큰이 유일한 자격이고, 그 판정은 서버가 한다(설계 §3.5·§6.1).
  { path: '/invite/:token', element: <InviteAcceptPage /> },
  { path: '/reset/:token', element: <ResetPasswordPage /> },
  { path: '/', element: <Protected><HomePage /></Protected> },
  { path: '/org/:orgId', element: <Protected><OrgDetailPage /></Protected> },
  { path: '/admin', element: <Protected adminOnly><AdminPage /></Protected> },
  { path: '/settings', element: <Protected><SettingsPage /></Protected> },
  { path: '/p/:projectId', element: <Protected bare><ProjectPage /></Protected> },
  { path: '/p/:projectId/settings', element: <Protected><ProjectSettingsPage /></Protected> },
  { path: '*', element: <NotFoundPage /> },
]

export const router = createBrowserRouter(routes)
