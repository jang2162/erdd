import { useState } from 'react'
import { useNavigate } from 'react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { BrandWordmark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginPage() {
  const trpc = useTRPC()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const login = useMutation(
    trpc.auth.login.mutationOptions({
      onSuccess: async () => {
        await queryClient.clear()
        navigate('/', { replace: true })
      },
    }),
  )

  return (
    <div className="bg-dotgrid flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <BrandWordmark className="mx-auto mb-2" />
          <CardTitle>로그인</CardTitle>
          <CardDescription>계정이 없다면 관리자에게 요청하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              login.mutate({ email, password })
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="username"
                className="font-mono"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {login.error && <p role="alert" className="text-sm text-destructive">{login.error.message}</p>}
            <Button type="submit" disabled={login.isPending}>
              {login.isPending ? '확인 중…' : '로그인'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
