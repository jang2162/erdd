import { useState } from 'react'
import { Link } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { useMe } from '@/components/require-auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function CreateOrgDialog() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const create = useMutation(
    trpc.org.create.mutationOptions({
      onSuccess: async () => {
        toast.success('조직을 만들었습니다')
        await queryClient.invalidateQueries({ queryKey: trpc.org.list.queryKey() })
        setOpen(false)
        setName('')
      },
      onError: (err) => toast.error(err.message),
    }),
  )
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">팀 조직 만들기</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>팀 조직 만들기</DialogTitle></DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => { e.preventDefault(); create.mutate({ name }) }}
        >
          <div className="grid gap-2">
            <Label htmlFor="org-name">조직 이름</Label>
            <Input id="org-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter><Button type="submit" disabled={create.isPending}>만들기</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function HomePage() {
  const trpc = useTRPC()
  const me = useMe()
  const orgs = useQuery(trpc.org.list.queryOptions())
  // refetchInterval을 여기 걸지 않는 것은 의도다 — 헤더의 PendingPromotionsBadge가 같은
  // queryKey로 60초 폴링을 돌리고 홈은 AppShell 안이라 그 갱신을 함께 받는다. 배지를 셸에서
  // 떼면 이 카드의 건수도 함께 굳는다(app-shell.test.tsx가 그 배선을 지킨다).
  const pending = useQuery(trpc.promotion.pendingCount.queryOptions())
  const pendingByOrg = new Map(
    (pending.data?.byOrg ?? []).map((row) => [row.orgId, row.count]),
  )
  const sorted = [...(orgs.data ?? [])].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === 'personal' ? -1 : 1,
  )

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{me.name}님의 작업 공간</h1>
          <p className="text-sm text-muted-foreground">조직을 선택해 프로젝트로 이동하세요.</p>
        </div>
        <CreateOrgDialog />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((org) => {
          const pendingCount = pendingByOrg.get(org.id) ?? 0
          return (
            <Link key={org.id} to={`/org/${org.id}`}>
              <Card className="transition-colors hover:border-primary">
                <CardHeader className="flex flex-row items-center gap-3">
                  <Building2 className="size-5 text-muted-foreground" />
                  <CardTitle className="flex-1 text-base">{org.name}</CardTitle>
                  {org.kind === 'personal' && <Badge variant="secondary">개인 공간</Badge>}
                  {pendingCount > 0 && (
                    <Badge variant="outline">승격 요청 {pendingCount}건</Badge>
                  )}
                  <ChevronRight className="size-4 text-muted-foreground" />
                </CardHeader>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
