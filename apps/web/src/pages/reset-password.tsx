import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useMutation } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { TRANSIENT_FAILURE_MESSAGE, terminalLinkFailure } from '@/lib/link-error'
import { BrandWordmark } from '@/components/brand-mark'
import { LinkFailure } from '@/components/link-failure'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * 비밀번호 재설정 화면. **비보호 라우트다** — 비밀번호를 잊어 로그인하지 못하는 사람이
 * 여는 화면이므로 로그인을 요구하면 이 경로 자체가 성립하지 않는다.
 *
 * 초대와 달리 미리 물어볼 것이 없다(peek에 해당하는 프로시저가 없다). 토큰의 생사는
 * 제출해야 드러나고, **종료성 오류로 죽은 것이 확인됐을 때만** 폼을 지운다.
 */
export function ResetPasswordPage() {
  const trpc = useTRPC()
  const navigate = useNavigate()
  const { token = '' } = useParams()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [mismatch, setMismatch] = useState(false)

  const reset = useMutation(
    trpc.auth.resetPassword.mutationOptions({
      // 성공 시 서버가 이 사용자의 세션을 전부 지운다. 자동 로그인하지 않고 로그인 화면으로
      // 보낸다(설계 §6.1). replace라 뒤로 가기가 이미 소비된 재설정 URL로 돌아가지 않는다.
      onSuccess: () => navigate('/login', { replace: true }),
    }),
  )

  // 폼을 지우는 판정은 "오류가 있는가"가 아니라 **"다시 제출해도 결과가 같은가"**다. 그 판정은
  // 서버가 명시한 표식으로만 한다 — 네트워크가 끊겼거나 5xx를 받은 것뿐이면, **또는 입력 검증이
  // 걸린 것뿐이면** 토큰은 아직 살아 있다. 여기서 폼을 지우면 살아 있는 링크가 죽은 것으로
  // 보이고, 사용자는 헛되이 새 링크를 요청한다.
  const failure = terminalLinkFailure(reset.error)

  return (
    <div className="bg-dotgrid flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <BrandWordmark className="mx-auto mb-2" />
          <CardTitle>비밀번호 재설정</CardTitle>
          {failure === null && (
            <CardDescription>새 비밀번호를 정하면 다른 기기의 로그인이 모두 해제됩니다.</CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {failure !== null ? (
            <LinkFailure failure={failure} />
          ) : (
            <form
              className="grid gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                if (password !== confirm) { setMismatch(true); return }
                setMismatch(false)
                reset.mutate({ token, newPassword: password })
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="new">새 비밀번호</Label>
                <Input id="new" type="password" required minLength={8} autoComplete="new-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="confirm">새 비밀번호 확인</Label>
                <Input id="confirm" type="password" required autoComplete="new-password"
                  value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              {mismatch && <p role="alert" className="text-sm text-destructive">비밀번호가 서로 다릅니다</p>}
              {/* 비종료성 오류. 재시도 수단은 아래 제출 버튼 그대로다 — 입력을 잃지 않는다. */}
              {reset.error && (
                <p role="alert" className="text-sm text-destructive">{TRANSIENT_FAILURE_MESSAGE}</p>
              )}
              <Button type="submit" disabled={reset.isPending}>
                {reset.isPending ? '설정 중…' : '비밀번호 설정'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
