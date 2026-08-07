import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { INVITATION_STATUS_LABEL, invitationStatus } from '@/lib/invitation-status'
import { OneTimeLink } from '@/components/one-time-link'
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

/**
 * 계정을 만들지 않고 **초대 링크만** 만든다. 비밀번호 입력란이 없는 것이 이 화면의 성질이다
 * (설계 §3.1) — 이름도 비밀번호도 수락자가 초대 화면에서 정한다.
 */
function InviteAccountDialog() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'user'>('user')
  // 발급 결과는 다이얼로그를 닫을 때까지 남긴다 — 평문 토큰은 이 응답에서만 나오므로
  // 성공하자마자 닫으면 관리자가 링크를 잃는다. **수신자 이메일도 함께 들고 있는다** — 링크는
  // 그 이메일에 묶여 있고(수락하면 이 주소로 계정이 생긴다) 발급 성공 시 입력은 비워지므로,
  // 여기서 담지 않으면 화면에 "누구에게 줄 링크인지"가 남지 않는다.
  const [issued, setIssued] = useState<
    { token: string; email: string; expiresAt: Date | string } | null
  >(null)
  const invite = useMutation(
    trpc.admin.users.invite.mutationOptions({
      onSuccess: async (data, variables) => {
        setIssued({ token: data.token, email: variables.email, expiresAt: data.expiresAt })
        setEmail(''); setRole('user')
        await queryClient.invalidateQueries({ queryKey: trpc.admin.invitations.list.queryKey() })
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) setIssued(null) }}
    >
      <DialogTrigger asChild>
        <Button>계정 초대</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>계정 초대</DialogTitle>
          <DialogDescription>
            계정을 만들지 않고 초대 링크만 만듭니다. 이름과 비밀번호는 본인이 정합니다.
          </DialogDescription>
        </DialogHeader>
        {issued !== null ? (
          <div className="grid gap-4">
            <OneTimeLink
              kind="invite" token={issued.token}
              recipient={issued.email} expiresAt={issued.expiresAt}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>닫기</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              invite.mutate({ email, role })
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="invite-email">이메일</Label>
              <Input id="invite-email" type="email" required className="font-mono"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="invite-role">역할</Label>
              <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'user')}>
                <SelectTrigger id="invite-role"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">일반</SelectItem>
                  <SelectItem value="admin">관리자</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={invite.isPending}>초대 링크 만들기</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * 재설정 **링크만** 발급한다. 이 발급으로 비밀번호가 바뀌지 않고 세션도 죽지 않는다 —
 * 사용자가 링크를 열어 새 비밀번호를 정해야 바뀐다(설계 §5.4). 화면이 "재설정했다"고
 * 말하면 거짓이고, 관리자는 링크 전달을 그만둔다.
 */
function ResetLinkDialog({ userId, email }: { userId: string; email: string }) {
  const trpc = useTRPC()
  const [open, setOpen] = useState(false)
  // 재설정 링크는 24시간짜리다 — 초대(7일)보다 훨씬 짧고 목록 화면도 없어서, 이 상자가
  // 기한을 말하지 않으면 관리자가 확인할 자리가 어디에도 없다. 그래서 만료도 함께 들고 있는다.
  const [issued, setIssued] = useState<{ token: string; expiresAt: Date | string } | null>(null)
  const resetLink = useMutation(
    trpc.admin.users.resetLink.mutationOptions({
      onSuccess: (data) => setIssued({ token: data.token, expiresAt: data.expiresAt }),
      onError: (err) => toast.error(err.message),
    }),
  )
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => { setOpen(next); if (!next) setIssued(null) }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">비밀번호 재설정 링크</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>비밀번호 재설정 링크</DialogTitle>
          <DialogDescription className="font-mono">{email}</DialogDescription>
        </DialogHeader>
        {issued !== null ? (
          <div className="grid gap-4">
            <OneTimeLink kind="reset" token={issued.token} expiresAt={issued.expiresAt} />
            <p className="text-sm text-muted-foreground">
              이 링크를 사용자에게 전달하세요. 사용자가 링크를 열어 새 비밀번호를 정해야
              비밀번호가 바뀝니다.
            </p>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>닫기</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="grid gap-4">
            <p className="text-sm text-muted-foreground">
              링크를 만들어 사용자에게 전달합니다. 발급만으로는 비밀번호가 바뀌지 않고
              로그인 세션도 유지됩니다.
            </p>
            <DialogFooter>
              <Button type="button" disabled={resetLink.isPending}
                onClick={() => resetLink.mutate({ userId })}>
                링크 만들기
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/**
 * 관리자 초대 목록 — `orgId`가 null인 초대만이다. 조직 초대(`invitation.listForOrg`)와는
 * 다른 묶음이고 권한 축도 다르다(설계 §3.2). 여기서 만든 초대를 취소할 자리가 이 화면뿐이다.
 */
function InvitationsSection() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const listOptions = trpc.admin.invitations.list.queryOptions()
  const list = useQuery(listOptions)
  const revoke = useMutation(
    trpc.admin.invitations.revoke.mutationOptions({
      onSuccess: async () => {
        toast.success('초대를 취소했습니다')
        await queryClient.invalidateQueries({ queryKey: listOptions.queryKey })
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">초대</h2>
      {list.isError && <p role="alert" className="text-destructive">{list.error.message}</p>}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이메일</TableHead>
              <TableHead>역할</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>만료</TableHead>
              <TableHead className="text-right">동작</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(list.data ?? []).map((inv) => {
              const status = invitationStatus(inv)
              return (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono">{inv.email}</TableCell>
                  <TableCell>{inv.userRole === 'admin' ? '관리자' : '일반'}</TableCell>
                  <TableCell>
                    {status === 'pending'
                      ? <Badge variant="outline">{INVITATION_STATUS_LABEL[status]}</Badge>
                      : <Badge variant="secondary">{INVITATION_STATUS_LABEL[status]}</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(inv.expiresAt).toLocaleString('ko-KR')}
                  </TableCell>
                  <TableCell className="text-right">
                    {/* 취소는 아직 살아 있는 초대에만 — 서버도 조건부 UPDATE로 나머지를 거절한다. */}
                    {status === 'pending' && (
                      <Button variant="outline" size="sm" disabled={revoke.isPending}
                        onClick={() => revoke.mutate({ id: inv.id })}>
                        취소
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
        {!list.isPending && !list.isError && (list.data ?? []).length === 0 && (
          <p className="p-8 text-center text-muted-foreground">보낸 초대가 없습니다.</p>
        )}
      </div>
    </section>
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
          {/* 초대는 계정을 만들지 않는다 — 수락자가 만든다(같은 화면의 다이얼로그 설명과 같은 말). */}
          <p className="text-sm text-muted-foreground">
            초대 링크를 만들어 사람을 부르고, 만들어진 계정의 사용 상태를 관리합니다.
            계정은 초대를 수락한 본인이 만들고 비밀번호도 본인만 정합니다.
          </p>
        </div>
        <InviteAccountDialog />
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
                  <ResetLinkDialog userId={u.id} email={u.email} />
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
      <InvitationsSection />
      <ResourceLibraryManager scope="global" canManage />
    </div>
  )
}
