import { createContext, useContext, type ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'

export type Me = {
  id: string; email: string; name: string
  role: 'admin' | 'user'
  /** 'local'이면 백엔드 없이 파일 위에서 도는 로컬 서버다 — 계정·조직·협업 기능이 없다. */
  mode: 'server' | 'local'
}

const MeContext = createContext<Me | null>(null)

export function useMe(): Me {
  const me = useContext(MeContext)
  if (!me) throw new Error('useMe는 RequireAuth 안에서만 사용할 수 있습니다')
  return me
}

export function RequireAuth({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  const trpc = useTRPC()
  const me = useQuery(trpc.auth.me.queryOptions(undefined, { retry: false }))

  if (me.isPending) {
    return <div className="flex min-h-dvh items-center justify-center text-muted-foreground">불러오는 중…</div>
  }
  if (me.isError) {
    if (me.error.data?.code === 'UNAUTHORIZED') return <Navigate to="/login" replace />
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 text-center">
        <p role="alert" className="text-destructive">연결에 문제가 있습니다</p>
        <Button onClick={() => me.refetch()}>다시 시도</Button>
      </div>
    )
  }
  if (adminOnly && me.data.role !== 'admin') return <Navigate to="/" replace />
  return <MeContext.Provider value={me.data}>{children}</MeContext.Provider>
}

/** 로컬 모드 분기의 단일 진입점. 컴포넌트마다 me.mode를 직접 비교하지 않는다. */
export function useIsLocal(): boolean {
  return useMe().mode === 'local'
}
