import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function AccessTokensCard() {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [issued, setIssued] = useState<string | null>(null)

  const listOptions = trpc.auth.tokens.list.queryOptions()
  const list = useQuery(listOptions)

  const create = useMutation(
    trpc.auth.tokens.create.mutationOptions({
      onSuccess: (data) => {
        setIssued(data.token)
        setName('')
        void queryClient.invalidateQueries({ queryKey: listOptions.queryKey })
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  const revoke = useMutation(
    trpc.auth.tokens.revoke.mutationOptions({
      onSuccess: () => {
        toast.success('토큰을 폐기했습니다')
        void queryClient.invalidateQueries({ queryKey: listOptions.queryKey })
      },
      onError: (err) => toast.error(err.message),
    }),
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>액세스 토큰</CardTitle>
        <CardDescription>
          CLI에서 쓰는 토큰입니다. 권한은 내 조직·프로젝트 역할을 그대로 따릅니다.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); create.mutate({ name }) }}
        >
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="token-name">토큰 이름</Label>
            <Input
              id="token-name" value={name} placeholder="노트북"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={name.trim() === '' || create.isPending}>발급</Button>
        </form>

        {issued !== null && (
          <div className="grid gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-3">
            <code className="font-mono text-sm break-all">{issued}</code>
            <p className="text-muted-foreground text-xs">
              이 값은 지금만 보입니다 — 창을 닫으면 다시 볼 수 없습니다.
            </p>
            <Button
              type="button" variant="outline" size="sm" className="justify-self-start"
              onClick={() => {
                void navigator.clipboard?.writeText(issued)
                toast.success('복사했습니다')
              }}
            >복사</Button>
          </div>
        )}

        <ul className="grid gap-2">
          {(list.data ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 border-b pb-2 text-sm">
              <span className="grid">
                <span>{t.name}</span>
                <span className="text-muted-foreground text-xs">
                  {t.lastUsedAt === null
                    ? '사용 안 함'
                    : `마지막 사용 ${new Date(t.lastUsedAt).toLocaleDateString('ko-KR')}`}
                </span>
              </span>
              <Button
                type="button" variant="ghost" size="sm"
                onClick={() => revoke.mutate({ id: t.id })}
              >폐기</Button>
            </li>
          ))}
          {(list.data ?? []).length === 0 && (
            <li className="text-muted-foreground text-sm">발급한 토큰이 없습니다.</li>
          )}
        </ul>
      </CardContent>
    </Card>
  )
}
