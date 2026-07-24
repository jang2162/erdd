import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

function ProjectMembers({ projectId, orgId }: { projectId: string; orgId: string }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const projectMembers = useQuery(trpc.project.members.list.queryOptions({ projectId }))
  const orgMembers = useQuery(trpc.org.members.list.queryOptions({ orgId }))
  const [memberId, setMemberId] = useState('')
  const [role, setRole] = useState<'admin' | 'editor' | 'viewer'>('editor')
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.project.members.list.queryKey({ projectId }) })
  const add = useMutation(
    trpc.project.members.add.mutationOptions({
      onSuccess: async () => { toast.success('멤버를 추가했습니다'); setMemberId(''); await invalidate() },
      onError: (err) => toast.error(err.message),
    }),
  )
  const remove = useMutation(
    trpc.project.members.remove.mutationOptions({
      onSuccess: invalidate, onError: (err) => toast.error(err.message),
    }),
  )
  const candidates = orgMembers.data?.filter(
    (om) => !projectMembers.data?.some((pm) => pm.memberId === om.id),
  )

  return (
    <section className="grid gap-3">
      <h2 className="text-lg font-semibold">프로젝트 멤버</h2>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => { e.preventDefault(); if (memberId) add.mutate({ projectId, memberId, role }) }}
      >
        <div className="grid gap-1">
          <Label htmlFor="add-member" className="text-xs">조직 멤버 추가</Label>
          <Select value={memberId} onValueChange={setMemberId}>
            <SelectTrigger id="add-member" className="w-64"><SelectValue placeholder="멤버 선택" /></SelectTrigger>
            <SelectContent>
              {candidates?.map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.name} ({m.email})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
          <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="admin">Admin</SelectItem>
            <SelectItem value="editor">Editor</SelectItem>
            <SelectItem value="viewer">Viewer</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" disabled={add.isPending || !memberId}>추가</Button>
      </form>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>이름</TableHead>
              <TableHead>이메일</TableHead>
              <TableHead>역할</TableHead>
              <TableHead className="text-right">동작</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projectMembers.data?.map((pm) => (
              <TableRow key={pm.id}>
                <TableCell>{pm.name}</TableCell>
                <TableCell className="font-mono">{pm.email}</TableCell>
                <TableCell><Badge variant="secondary">{pm.role}</Badge></TableCell>
                <TableCell className="text-right">
                  <Button variant="outline" size="sm" disabled={remove.isPending}
                    onClick={() => remove.mutate({ projectId, projectMemberId: pm.id })}>
                    제거
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

export function ProjectSettingsPage() {
  const { projectId = '' } = useParams()
  const trpc = useTRPC()
  const project = useQuery(trpc.project.get.queryOptions({ projectId }))

  if (project.isPending) return <p className="text-muted-foreground">불러오는 중…</p>
  if (project.isError) return <p role="alert" className="text-destructive">{project.error.message}</p>

  const p = project.data
  const canManage = p.myOrgRole === 'owner' || p.myOrgRole === 'admin' || p.myRole === 'admin'

  return (
    <div className="grid gap-8">
      <Link to={`/p/${projectId}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> 에디터로
      </Link>

      <div>
        <h1 className="text-xl font-semibold">{p.name}</h1>
        <p className="text-sm text-muted-foreground">{p.description || '설명 없음'}</p>
        <div className="flex flex-wrap gap-1 pt-2">
          {p.dialects.map((d) => (
            <Badge key={d} variant="outline" className="font-mono text-xs">{d}</Badge>
          ))}
          {p.myRole && <Badge variant="secondary">내 역할: {p.myRole}</Badge>}
        </div>
      </div>

      {canManage && <ProjectMembers projectId={projectId} orgId={p.orgId} />}
    </div>
  )
}
