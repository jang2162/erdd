import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/** 복사에 실패했을 때 화면이 알려 줄 다음 행동 — 링크는 여전히 상자 안에 있다. */
const COPY_FAILED = '복사할 수 없습니다 — 링크를 직접 선택해 복사하세요'

/**
 * 방금 발급한 일회용 링크를 보여주는 상자. 초대(`/invite/:token`)와 비밀번호 재설정
 * (`/reset/:token`) 양쪽이 쓴다.
 *
 * **평문 토큰은 발급 응답에서만 나온다** — 목록 프로시저는 평문도 해시도 주지 않으므로
 * 이 상자를 닫으면 다시 볼 방법이 없고, 잃으면 조회가 아니라 재발급이다(설계 §3.2).
 * 그래서 "지금만 볼 수 있다"를 문구로 알린다(§6.2). 없으면 관리자가 나중에 다시 찾을 수
 * 있다고 여기고 그대로 닫는다.
 */
export function OneTimeLink({ kind, token, recipient, expiresAt, onDismiss }: {
  kind: 'invite' | 'reset'
  token: string
  /**
   * 이 링크의 수신자. **링크는 이 이메일에 묶여 있다** — 초대는 이 주소로 계정이 만들어지고
   * (`invitation.accept`), 재설정은 이 사람의 비밀번호를 바꾼다. 엉뚱한 사람에게 전달하면 그가
   * 남의 이메일로 계정을 갖는다. 발급 폼은 성공하면 입력을 비우므로, 상자가 스스로 말하지 않으면
   * 화면 어디에도 "누구에게 줄 링크인지"가 남지 않는다.
   */
  recipient?: string
  /** 있으면 함께 보여준다 — 링크를 전달하는 사람이 "언제까지 유효한지"를 말할 수 있어야 한다. */
  expiresAt?: Date | string | null
  /** 있으면 닫기 버튼을 낸다 — 다이얼로그처럼 닫을 자리가 따로 없는 화면에서 쓴다. */
  onDismiss?: () => void
}) {
  // 라우트는 앱과 같은 출처다(routes.tsx의 비보호 라우트 2개).
  const url = new URL(`/${kind}/${token}`, window.location.origin).toString()
  // 클립보드는 secure context에서만 있다. 없거나 거절당했는데 "복사했습니다"라고 말하면
  // 관리자는 붙여넣기가 될 것으로 믿고 상자를 닫는다 — 그러면 링크는 사라진다.
  const copy = async () => {
    // 타입은 항상 있다고 하지만 런타임에는 없을 수 있다(비-secure context).
    const clipboard: Clipboard | undefined = navigator.clipboard
    if (clipboard === undefined) { toast.error(COPY_FAILED); return }
    try {
      await clipboard.writeText(url)
      toast.success('복사했습니다')
    } catch {
      toast.error(COPY_FAILED)
    }
  }
  return (
    <div className="grid gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-3">
      {recipient !== undefined && (
        <p className="text-sm">
          <span className="text-muted-foreground">받는 사람 </span>
          <span className="font-mono">{recipient}</span>
        </p>
      )}
      <code className="font-mono text-sm break-all">{url}</code>
      <p className="text-muted-foreground text-xs">
        이 링크는 지금만 볼 수 있습니다 — 창을 닫으면 다시 볼 수 없습니다. 잃으면 새로 발급하세요.
      </p>
      {expiresAt != null && (
        <p className="text-muted-foreground text-xs">
          {new Date(expiresAt).toLocaleString('ko-KR')}까지 유효합니다.
        </p>
      )}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => { void copy() }}>복사</Button>
        {onDismiss !== undefined && (
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>닫기</Button>
        )}
      </div>
    </div>
  )
}
