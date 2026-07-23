import { createContext, useContext, type ReactNode } from 'react'
import { Navigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'

export type Me = { id: string; email: string; name: string; role: 'admin' | 'user' }

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
  if (me.isError) return <Navigate to="/login" replace />
  if (adminOnly && me.data.role !== 'admin') return <Navigate to="/" replace />
  return <MeContext.Provider value={me.data}>{children}</MeContext.Provider>
}
