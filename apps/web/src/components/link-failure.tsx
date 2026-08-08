import { Link } from 'react-router'
import type { TerminalLinkFailure } from '@/lib/link-error'

/**
 * 일회용 링크(초대·비밀번호 재설정)로 더 진행할 수 없을 때 폼 대신 보여준다.
 *
 * 폼을 남겨 두지 않는 것이 의도다 — 이 화면에서 서버가 종료성으로 표시한 사유는 전부 다시
 * 제출해도 달라지지 않는다. 사유 문구는 서버 것을 그대로 쓴다. 서버가 "없는 토큰"과 "기한이
 * 지난 토큰"을 같은 문구로 주므로(존재 오라클 방지) 화면이 그 둘을 구분하려 들지 않는다.
 *
 * **다음 행동은 갈래에 따라 갈린다.** 그 이메일에 이미 계정이 있으면 "새 링크를 받으세요"는
 * 불가능한 것을 안내하는 것이다 — 그 이메일로는 초대를 다시 만들 수 없으므로(서버가 CONFLICT로
 * 거절한다) 새 링크는 존재할 수 없다. 그 경우의 다음 행동은 로그인이다. 여기 오는 것은 둘이다:
 * **소비된 초대 링크를 다시 연 경우**(수락이 계정 생성과 소비를 한 트랜잭션으로 하므로 계정이
 * 확정된다 — 가입을 마친 사람이 북마크로 다시 여는 흔한 경로다)와 **수락이 "이미 가입한
 * 이메일"로 거절된 경우**. 갈래 판정은 화면이 하지 않는다 — 서버가 `data.linkReissuable`로
 * 말하고(`lib/link-error.ts`), 기한이 지난 초대·소비된 재설정 링크는 실제로 다시 받을 수
 * 있으므로 이 갈래가 아니다.
 */
export function LinkFailure({ failure }: { failure: TerminalLinkFailure }) {
  return (
    <div className="grid gap-2 text-center">
      <p role="alert" className="text-sm text-destructive">{failure.reason}</p>
      {failure.kind === 'registered' ? (
        <p className="text-sm text-muted-foreground">
          이 이메일에는 이미 계정이 있습니다 — 새 링크를 받을 수는 없으니{' '}
          <Link to="/login" className="underline underline-offset-4">로그인</Link>하세요.
          비밀번호를 모르면 관리자에게 재설정 링크를 요청하세요.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">관리자에게 문의해 새 링크를 받으세요.</p>
      )}
    </div>
  )
}
