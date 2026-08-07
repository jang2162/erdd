import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { BrandWordmark } from '@/components/brand-mark'
import { LinkFailure } from '@/components/link-failure'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const ORG_ROLE_LABEL = { admin: '관리자', member: '멤버' } as const

/**
 * 초대 수락 화면. **비보호 라우트다** — 아직 계정이 없는 사람이 여는 화면이므로 로그인을
 * 요구하면 이 경로 자체가 성립하지 않는다.
 */
export function InviteAcceptPage() {
  const trpc = useTRPC()
  const navigate = useNavigate()
  const { token = '' } = useParams()
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)
  const [invitation, setInvitation] = useState<{
    email: string
    orgName: string | null
    orgRole: 'admin' | 'member' | null
  } | null>(null)
  const [peekFailure, setPeekFailure] = useState<string | null>(null)

  const peek = useMutation(trpc.invitation.peek.mutationOptions())
  const accept = useMutation(
    trpc.invitation.accept.mutationOptions({
      // 자동 로그인하지 않는다 — 세션 발급 경로를 auth.login 하나로 유지한다(설계 §6.1).
      // replace라 뒤로 가기가 이미 소비된 초대 URL로 돌아가지 않는다.
      onSuccess: () => navigate('/login', { replace: true }),
    }),
  )

  // peek은 query가 아니라 mutation이다(설계 §3.5) — query면 토큰이 GET URL의 쿼리스트링에
  // 실려 역방향 프록시·접근 로그에 평문으로 남는다. 그래서 마운트 시 이 이펙트가 대신 부른다.
  //
  // 결과를 mutation이 아니라 **로컬 상태로 받는 것이 의도다.** MutationObserver는
  // onUnsubscribe에서 실행 중인 mutation에서 자신을 떼어내는데 다시 붙이는 onSubscribe가
  // 없다(query-core 5.101.4). StrictMode는 마운트 이펙트를 "실행→정리→재실행"으로 두 번
  // 돌리므로 그 사이 구독이 한 번 끊기고, 이 시점에 떠 있던 요청의 응답은 관찰자에게 영영
  // 도달하지 않는다 — 화면이 "불러오는 중…"에 멈춘다. mutateAsync가 돌려주는 프로미스는
  // 구독과 무관하게 실행 자체에 매여 있어 그 구멍을 타지 않는다.
  // ref는 별개 방어다 — 없으면 이펙트 2회 호출로 POST가 두 번 나간다.
  const asked = useRef(false)
  const peekAsync = peek.mutateAsync
  useEffect(() => {
    if (asked.current) return
    asked.current = true
    peekAsync({ token })
      .then(setInvitation)
      .catch((err: unknown) => {
        setPeekFailure(err instanceof Error ? err.message : '링크를 확인할 수 없습니다')
      })
  }, [peekAsync, token])

  // 사유가 무엇이든 다시 제출해서 풀리지 않는다 — 폼을 지우고 안내만 남긴다.
  const failure = peekFailure ?? accept.error?.message ?? null

  return (
    <div className="bg-dotgrid flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <BrandWordmark className="mx-auto mb-2" />
          <CardTitle>초대 수락</CardTitle>
          {invitation && !failure && (
            <CardDescription>이름과 비밀번호를 정하면 계정이 만들어집니다.</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {failure ? (
            <LinkFailure reason={failure} />
          ) : !invitation ? (
            <p className="text-center text-sm text-muted-foreground">불러오는 중…</p>
          ) : (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (password !== confirm) { setMismatch(true); return }
                setMismatch(false)
                accept.mutate({ token, name, password })
              }}
            >
              <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-sm">
                <p className="font-mono">{invitation.email}</p>
                {invitation.orgName !== null && (
                  <p className="text-muted-foreground">
                    조직 <span className="font-medium text-foreground">{invitation.orgName}</span>
                    에 {ORG_ROLE_LABEL[invitation.orgRole ?? 'member']}(으)로 참여합니다
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="name">이름</Label>
                <Input id="name" required autoComplete="name"
                  value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="password">비밀번호</Label>
                <Input id="password" type="password" required minLength={8} autoComplete="new-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirm">비밀번호 확인</Label>
                <Input id="confirm" type="password" required autoComplete="new-password"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              {mismatch && <p role="alert" className="text-sm text-destructive">비밀번호가 서로 다릅니다</p>}
              <Button type="submit" disabled={accept.isPending}>
                {accept.isPending ? '만드는 중…' : '계정 만들기'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
