import { createBrowserRouter } from 'react-router'

function Placeholder({ name }: { name: string }) {
  return <p className="p-8 text-muted-foreground">{name} — 준비 중</p>
}

export const router = createBrowserRouter([
  { path: '/login', element: <Placeholder name="로그인" /> },
  { path: '/', element: <Placeholder name="홈" /> },
  { path: '/admin', element: <Placeholder name="관리자" /> },
  { path: '/settings', element: <Placeholder name="설정" /> },
  { path: '/p/:projectId', element: <Placeholder name="프로젝트" /> },
])
