import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/**
 * 방금 발급한 일회용 링크를 보여주는 상자. 초대(`/invite/:token`)와 비밀번호 재설정
 * (`/reset/:token`) 양쪽이 쓴다.
 *
 * **평문 토큰은 발급 응답에서만 나온다** — 목록 프로시저는 평문도 해시도 주지 않으므로
 * 이 상자를 닫으면 다시 볼 방법이 없고, 잃으면 조회가 아니라 재발급이다(설계 §3.2).
 * 그래서 "지금만 볼 수 있다"를 문구로 알린다(§6.2). 없으면 관리자가 나중에 다시 찾을 수
 * 있다고 여기고 그대로 닫는다.
 */
export function OneTimeLink({ kind, token, expiresAt }: {
  kind: 'invite' | 'reset'
  token: string
  /** 있으면 함께 보여준다 — 링크를 전달하는 사람이 "언제까지 유효한지"를 말할 수 있어야 한다. */
  expiresAt?: Date | string | null
}) {
  // 라우트는 앱과 같은 출처다(routes.tsx의 비보호 라우트 2개).
  const url = new URL(`/${kind}/${token}`, window.location.origin).toString()
  return (
    <div className="grid gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-3">
      <code className="font-mono text-sm break-all">{url}</code>
      <p className="text-muted-foreground text-xs">
        이 링크는 지금만 볼 수 있습니다 — 창을 닫으면 다시 볼 수 없습니다. 잃으면 새로 발급하세요.
      </p>
      {expiresAt != null && (
        <p className="text-muted-foreground text-xs">
          {new Date(expiresAt).toLocaleString('ko-KR')}까지 유효합니다.
        </p>
      )}
      <Button
        type="button" variant="outline" size="sm" className="justify-self-start"
        onClick={() => {
          void navigator.clipboard?.writeText(url)
          toast.success('복사했습니다')
        }}
      >복사</Button>
    </div>
  )
}
