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

/**
 * 취소 버튼을 낼지. **만료로 보이는 초대에도 낸다** — 판정 기준은 `usedAt`뿐이다.
 *
 * 위 만료 판정은 **클라이언트 시계**(`Date.now()`) 기준이다. 시계가 앞서 있으면 아직 살아 있는
 * 초대가 '만료됨'으로 보이는데, 그 행에서 취소 버튼을 지우면 **그 초대를 죽일 방법이 없어진다** —
 * 화면 어디에도 다른 취소 수단이 없다. 헛되게 눌린 취소의 대가는 그보다 훨씬 작다: 서버가
 * 조건부 UPDATE(`usedAt IS NULL`)라 이미 사용된 것은 되살리지도 덮어쓰지도 않는다.
 *
 * 이미 사용된 초대에는 내지 않는다 — 되돌릴 것이 없고 서버도 거절한다. 그 판정은 서버가 보낸
 * `usedAt`이라 클라이언트 시계와 무관하다.
 */
export function canRevokeInvitation(row: { usedAt: Date | string | null }): boolean {
  return row.usedAt === null
}
