/**
 * 일회용 링크(초대·비밀번호 재설정)로 더 진행할 수 없을 때 폼 대신 보여준다.
 *
 * 폼을 남겨 두지 않는 것이 의도다 — 이 화면에서 서버가 거절하는 사유(기한이 지남, 이미 사용됨,
 * 이미 가입한 이메일)는 전부 다시 제출해도 달라지지 않는다. 사유는 서버 문구를 그대로 쓴다.
 * 서버가 "없는 토큰"과 "기한이 지난 토큰"을 같은 문구로 주므로(존재 오라클 방지) 화면이
 * 그 둘을 구분하려 들지 않는다.
 */
export function LinkFailure({ reason }: { reason: string }) {
  return (
    <div className="grid gap-2 text-center">
      <p role="alert" className="text-sm text-destructive">{reason}</p>
      <p className="text-sm text-muted-foreground">관리자에게 문의해 새 링크를 받으세요.</p>
    </div>
  )
}
