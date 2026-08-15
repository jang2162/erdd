import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft } from 'lucide-react'
import { toast } from 'sonner'
import type { NamingRules } from '@erdd/core'
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

/**
 * 명명 규칙 중 **논리명 구분자 하나만** 연다(설계 D7).
 * case·separator·maxLengthBytes 는 각자 기존 모델에 미치는 영향이 달라 함께 열지 않는다 —
 * 특히 separator 를 바꾸면 물리명 전체가 재생성 대상이 된다.
 */
function NamingRulesSection({
  projectId, namingRules,
}: { projectId: string; namingRules: NamingRules }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const update = useMutation(
    trpc.project.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: trpc.project.get.queryKey({ projectId }) })
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  return (
    <section className="grid gap-2">
      <h2 className="text-lg font-semibold">명명 규칙</h2>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={namingRules.logicalSeparator === '_'}
          disabled={update.isPending}
          onChange={(e) => {
            // ⚠️ 이벤트 값은 producer 진입 전에 캡처한다(HANDOFF 3.4).
            const logicalSeparator = e.target.checked ? '_' as const : '' as const
            update.mutate({ projectId, namingRules: { ...namingRules, logicalSeparator } })
          }}
        />
        논리명을 밑줄로 구분
      </label>
      <p className="text-xs text-muted-foreground">
        켜면 논리명을 「회원_주문_번호」처럼 단어마다 밑줄로 나눠 적습니다.
        끄더라도 이미 저장된 논리명의 밑줄은 그대로 남습니다.
      </p>
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
  // 판정은 서버가 한다. 역할 조합식을 여기서 재현하면 perm.ts 가 바뀔 때 조용히 어긋난다
  // (같은 응답에 canManage 가 실려 온다 — HANDOFF 이월 항목을 여기서 닫는다).
  const canManage = p.canManage

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

      {canManage && <NamingRulesSection projectId={projectId} namingRules={p.namingRules} />}
      {canManage && <ProjectMembers projectId={projectId} orgId={p.orgId} />}
    </div>
  )
}
