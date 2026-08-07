import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { TRANSIENT_FAILURE_MESSAGE, terminalLinkReason } from '@/lib/link-error'
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
  const [peekError, setPeekError] = useState<unknown>(null)
  // 재시도 카운터. peek은 마운트 1회로 묶여 있어(아래 ref) 이 값을 올리는 것 말고는 다시 부를
  // 길이 없다 — 비종료성 실패에 재시도 수단이 없으면 화면이 영구히 멈춘다.
  const [peekAttempt, setPeekAttempt] = useState(0)

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
  // ref는 별개 방어다 — 없으면 이펙트 2회 호출로 POST가 두 번 나간다. 시도 번호를 담는 것이
  // 의도다: 재시도로 카운터가 올라간 때만 다시 부르고, StrictMode의 재실행은 걸러 낸다.
  const askedFor = useRef(-1)
  const peekAsync = peek.mutateAsync
  useEffect(() => {
    if (askedFor.current === peekAttempt) return
    askedFor.current = peekAttempt
    peekAsync({ token })
      .then((inv) => { setInvitation(inv); setPeekError(null) })
      .catch(setPeekError)
  }, [peekAsync, token, peekAttempt])

  // 폼을 지우는 판정은 "오류가 있는가"가 아니라 **"다시 제출해도 결과가 같은가"**다(설계 §6.1).
  // 네트워크 단절·5xx로 폼을 지우면 살아 있는 토큰이 죽은 것으로 보이고 입력한 이름까지 사라진다.
  // 최악은 accept가 서버에서 커밋된 뒤 응답만 유실되는 경우다 — 계정은 만들어졌는데 화면이
  // "링크가 죽었다"고 말한다.
  const deadReason = terminalLinkReason(peekError) ?? terminalLinkReason(accept.error)
  // 죽지 않은 peek 실패. 토큰은 아직 살아 있으므로 안내가 아니라 재시도를 준다.
  const peekStalled = deadReason === null && peekError !== null

  return (
    <div className="bg-dotgrid flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <BrandWordmark className="mx-auto mb-2" />
          <CardTitle>초대 수락</CardTitle>
          {invitation && deadReason === null && !peekStalled && (
            <CardDescription>이름과 비밀번호를 정하면 계정이 만들어집니다.</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {deadReason !== null ? (
            <LinkFailure reason={deadReason} />
          ) : peekStalled ? (
            <div className="grid gap-3 text-center">
              <p role="alert" className="text-sm text-destructive">{TRANSIENT_FAILURE_MESSAGE}</p>
              <Button
                variant="outline"
                onClick={() => { setPeekError(null); setPeekAttempt((n) => n + 1) }}
              >
                다시 시도
              </Button>
            </div>
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
              {/*
                브라우저 비밀번호 관리자는 새 비밀번호를 어느 계정에 묶을지 폼의 username 필드로
                판단한다. 없으면 다음 로그인에서 자동완성이 나오지 않는다. 이메일은 바로 위에
                이미 보이므로 이 입력은 숨긴다.
              */}
              <input type="email" autoComplete="username" value={invitation.email} readOnly hidden />
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
              {/* 비종료성 오류. 재시도 수단은 아래 제출 버튼 그대로다 — 입력한 이름을 잃지 않는다. */}
              {accept.error && (
                <p role="alert" className="text-sm text-destructive">{TRANSIENT_FAILURE_MESSAGE}</p>
              )}
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
