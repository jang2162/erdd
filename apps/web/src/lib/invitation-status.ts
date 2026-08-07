export type InvitationStatus = 'pending' | 'used' | 'expired'

export const INVITATION_STATUS_LABEL: Record<InvitationStatus, string> = {
  pending: '대기 중', used: '사용됨', expired: '만료됨',
}

/**
 * 초대 행의 상태. 조직 초대 목록(`invitation.listForOrg`)과 관리자 초대 목록
 * (`admin.invitations.list`)이 같은 판정을 써야 하므로 한 곳에 둔다 — 목록이 둘이라고
 * 판정도 둘이면 한쪽만 고쳐질 수 있다.
 *
 * **사용됨을 만료보다 먼저 본다** — 서버 `assertLive`와 같은 순서다. 사용된 뒤 기한까지
 * 지난 초대는 "이미 사용"이 더 정확한 안내다.
 *
 * 취소는 별도 상태가 아니다 — 서버가 `expiresAt`을 현재로 당기므로 만료로 보인다.
 */
export function invitationStatus(
  row: { expiresAt: Date | string; usedAt: Date | string | null },
): InvitationStatus {
  if (row.usedAt !== null) return 'used'
  return new Date(row.expiresAt).getTime() <= Date.now() ? 'expired' : 'pending'
}
