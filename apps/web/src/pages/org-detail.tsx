import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { DIALECTS, type Dialect } from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const DIALECT_LABEL: Record<Dialect, string> = {
  postgresql: 'PostgreSQL', mysql: 'MySQL/MariaDB', oracle: 'Oracle', mssql: 'MSSQL',
}

function CreateProjectDialog({ orgId }: { orgId: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [dialects, setDialects] = useState<Dialect[]>(['postgresql'])
  const create = useMutation(
    trpc.project.create.mutationOptions({
      onSuccess: async () => {
        toast.success('프로젝트를 만들었습니다')
        await queryClient.invalidateQueries({ queryKey: trpc.project.list.queryKey({ orgId }) })
        setOpen(false)
        setName(''); setDescription(''); setDialects(['postgresql'])
      },
      onError: (err) => toast.error(err.message),
    }),
  )
  const toggleDialect = (d: Dialect) =>
    setDialects((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus /> 프로젝트 만들기</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>프로젝트 만들기</DialogTitle></DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (dialects.length === 0) { toast.error('대상 DB를 하나 이상 선택하세요'); return }
            create.mutate({ orgId, name, description, dialects })
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="prj-name">이름</Label>
            <Input id="prj-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="prj-desc">설명 (선택)</Label>
            <Input id="prj-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>대상 DB 방언</Label>
            <div className="flex flex-wrap gap-2">
              {DIALECTS.map((d) => (
                <Button
                  key={d} type="button" size="sm"
                  variant={dialects.includes(d) ? 'default' : 'outline'}
                  onClick={() => toggleDialect(d)}
                >
                  {DIALECT_LABEL[d]}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter><Button type="submit" disabled={create.isPending}>만들기</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function MembersSection({ orgId, myRole }: { orgId: string; myRole: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const members = useQuery(trpc.org.members.list.queryOptions({ orgId }))
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const canManage = myRole === 'owner' || myRole === 'admin'
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.org.members.list.queryKey({ orgId }) })
  const add = useMutation(
    trpc.org.members.add.mutationOptions({
      onSuccess: async () => { toast.success('멤버를 추가했습니다'); setEmail(''); await invalidate() },
      onError: (err) => toast.error(err.message),
    }),
  )
  const setMemberRole = useMutation(
    trpc.org.members.setRole.mutationOptions({
      onSuccess: invalidate, onError: (err) => toast.error(err.message),
    }),
  )
  const remove = useMutation(
    trpc.org.members.remove.mutationOptions({
      onSuccess: invalidate, onError: (err) => toast.error(err.message),
    }),
  )

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">멤버</h2>
      {canManage && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); add.mutate({ orgId, email, role }) }}
        >
          <div className="grid gap-1">
            <Label htmlFor="member-email" className="text-xs">이메일로 추가</Label>
            <Input id="member-email" type="email" required placeholder="user@example.com"
              className="w-64 font-mono" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Select value={role} onValueChange={(v) => setRole(v as 'admin' | 'member')}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="member">Member</SelectItem>
              <SelectItem value="admin">Admin</SelectItem>
            </SelectContent>
          </Select>
          <Button type="submit" disabled={add.isPending}>추가</Button>
        </form>
      )}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>이메일</TableHead>
              <TableHead>역할</TableHead>
              {canManage && <TableHead className="text-right">동작</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.data?.map((m) => (
              <TableRow key={m.id}>
                <TableCell>{m.name}</TableCell>
                <TableCell className="font-mono">{m.email}</TableCell>
                <TableCell>
                  {canManage ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) =>
                        setMemberRole.mutate({ orgId, memberId: m.id, role: v as 'owner' | 'admin' | 'member' })
                      }
                    >
                      <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="member">Member</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="secondary">{m.role}</Badge>
                  )}
                </TableCell>
                {canManage && (
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" disabled={remove.isPending}
                      onClick={() => remove.mutate({ orgId, memberId: m.id })}>
                      제거
                    </Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

export function OrgDetailPage() {
  const { orgId = '' } = useParams()
  const trpc = useTRPC()
  const orgs = useQuery(trpc.org.list.queryOptions())
  const projects = useQuery(trpc.project.list.queryOptions({ orgId }))
  const org = orgs.data?.find((o) => o.id === orgId)

  return (
    <div className="grid gap-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{org?.name ?? '조직'}</h1>
          <p className="text-sm text-muted-foreground">
            {org?.kind === 'personal' ? '개인 공간' : '팀 조직'}
          </p>
        </div>
        <CreateProjectDialog orgId={orgId} />
      </div>

      {projects.data?.length === 0 ? (
        <div className="bg-dotgrid grid place-items-center rounded-lg border py-16 text-center">
          <div className="grid gap-3">
            <Database className="mx-auto size-8 text-muted-foreground" />
            <p className="font-medium">첫 프로젝트를 만들어 보세요</p>
            <p className="text-sm text-muted-foreground">프로젝트 하나가 DB 스키마 하나입니다.</p>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data?.map((p) => (
            <Link key={p.id} to={`/p/${p.id}`}>
              <Card className="h-full transition-colors hover:border-primary">
                <CardHeader>
                  <CardTitle className="text-base">{p.name}</CardTitle>
                  <CardDescription>{p.description || '설명 없음'}</CardDescription>
                  <div className="flex flex-wrap gap-1 pt-1">
                    {p.dialects.map((d) => (
                      <Badge key={d} variant="outline" className="font-mono text-xs">{d}</Badge>
                    ))}
                  </div>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {org && org.kind === 'team' && <MembersSection orgId={orgId} myRole={org.role} />}
    </div>
  )
}
