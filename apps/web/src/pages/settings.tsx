import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AccessTokensCard } from './settings-tokens.js'

export function SettingsPage() {
  const trpc = useTRPC()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const change = useMutation(
    trpc.auth.changePassword.mutationOptions({
      onSuccess: () => {
        toast.success('비밀번호를 변경했습니다')
        setCurrentPassword(''); setNewPassword(''); setConfirm('')
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  return (
    <div className="mx-auto grid w-full max-w-md gap-6">
      <Card>
        <CardHeader>
          <CardTitle>비밀번호 변경</CardTitle>
          <CardDescription>변경하면 다른 기기의 로그인이 해제됩니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (newPassword !== confirm) { setMismatch(true); return }
              setMismatch(false)
              change.mutate({ currentPassword, newPassword })
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="cur">현재 비밀번호</Label>
              <Input id="cur" type="password" required autoComplete="current-password"
                value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new">새 비밀번호</Label>
              <Input id="new" type="password" required minLength={8} autoComplete="new-password"
                value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirm">새 비밀번호 확인</Label>
              <Input id="confirm" type="password" required autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>
            {mismatch && <p role="alert" className="text-sm text-destructive">새 비밀번호가 서로 다릅니다</p>}
            <Button type="submit" disabled={change.isPending}>변경 사항 저장</Button>
          </form>
        </CardContent>
      </Card>
      <AccessTokensCard />
    </div>
  )
}
