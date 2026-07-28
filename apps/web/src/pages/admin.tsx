import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { ResourceLibraryManager } from '@/components/resource-library-manager'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

function CreateAccountDialog() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [initialPassword, setInitialPassword] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const create = useMutation(
    trpc.admin.users.create.mutationOptions({
      onSuccess: async () => {
        toast.success('계정을 만들었습니다')
        await queryClient.invalidateQueries({ queryKey: trpc.admin.users.list.queryKey() })
        setOpen(false)
        setEmail(''); setName(''); setInitialPassword(''); setRole('user')
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>계정 만들기</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>계정 만들기</DialogTitle>
          <DialogDescription>초기 비밀번호를 사용자에게 직접 전달하세요.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            create.mutate({ email, name, initialPassword, role })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="new-email">이메일</Label>
            <Input id="new-email" type="email" required className="font-mono"
              value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-name">이름</Label>
            <Input id="new-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-password">초기 비밀번호</Label>
            <Input id="new-password" required minLength={8} className="font-mono"
              value={initialPassword} onChange={(e) => setInitialPassword(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="new-role">역할</Label>
            <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'user')}>
              <SelectTrigger id="new-role"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="user">일반</SelectItem>
                <SelectItem value="admin">관리자</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>만들기</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function ResetPasswordDialog({ userId, email }: { userId: string; email: string }) {
  const trpc = useTRPC()
  const [open, setOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const reset = useMutation(
    trpc.admin.users.resetPassword.mutationOptions({
      onSuccess: () => {
        toast.success('비밀번호를 재설정했습니다')
        setOpen(false)
        setNewPassword('')
      },
      onError: (err) => toast.error(err.message),
    }),
  )
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">비밀번호 재설정</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>비밀번호 재설정</DialogTitle>
          <DialogDescription className="font-mono">{email}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            reset.mutate({ userId, newPassword })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="reset-password">새 비밀번호</Label>
            <Input id="reset-password" required minLength={8} className="font-mono"
              value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={reset.isPending}>재설정</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AdminPage() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const users = useQuery(trpc.admin.users.list.queryOptions())
  const setActive = useMutation(
    trpc.admin.users.setActive.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.admin.users.list.queryKey() })
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">계정 관리</h1>
          <p className="text-sm text-muted-foreground">계정을 만들고 비밀번호와 사용 상태를 관리합니다.</p>
        </div>
        <CreateAccountDialog />
      </div>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이메일</TableHead>
              <TableHead>이름</TableHead>
              <TableHead>역할</TableHead>
              <TableHead>상태</TableHead>
              <TableHead className="text-right">동작</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data?.map((u) => (
              <TableRow key={u.id}>
                <TableCell className="font-mono">{u.email}</TableCell>
                <TableCell>{u.name}</TableCell>
                <TableCell>
                  {u.role === 'admin'
                    ? <Badge className="bg-key/15 text-key border-key/30" variant="outline">관리자</Badge>
                    : <Badge variant="secondary">일반</Badge>}
                </TableCell>
                <TableCell>
                  {u.isActive
                    ? <Badge variant="outline">활성</Badge>
                    : <Badge variant="destructive">비활성</Badge>}
                </TableCell>
                <TableCell className="flex justify-end gap-2">
                  <ResetPasswordDialog userId={u.id} email={u.email} />
                  <Button
                    variant="outline" size="sm" disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ userId: u.id, isActive: !u.isActive })}
                  >
                    {u.isActive ? '비활성화' : '활성화'}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {users.data?.length === 0 && (
          <p className="p-8 text-center text-muted-foreground">아직 계정이 없습니다.</p>
        )}
      </div>
      <ResourceLibraryManager scope="global" canManage />
    </div>
  )
}
