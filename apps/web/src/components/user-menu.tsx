import { Link, useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { LogOut, Settings, ShieldCheck } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'
import { useMe } from '@/components/require-auth'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function UserMenu() {
  const me = useMe()
  const trpc = useTRPC()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const logout = useMutation(
    trpc.auth.logout.mutationOptions({
      onSuccess: async () => {
        await queryClient.clear()
        navigate('/login', { replace: true })
      },
    }),
  )

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost">{me.name}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="font-mono text-xs">{me.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {me.role === 'admin' && (
          <DropdownMenuItem asChild>
            <Link to="/admin">
              <ShieldCheck /> 관리자
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link to="/settings">
            <Settings /> 설정
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => logout.mutate()}>
          <LogOut /> 로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
