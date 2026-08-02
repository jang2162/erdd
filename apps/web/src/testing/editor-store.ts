import { useEditorStore } from '@/editor/store'

/**
 * 테스트용: 편집 권한을 부여한다.
 *
 * store 기본값은 fail-closed(canEdit=false)라, 편집 동작을 검증하는 테스트는 setLoaded 뒤에
 * 이것을 불러야 한다. 읽기 전용 동작을 검증하는 테스트는 부르지 않거나 canEdit:false로 덮는다.
 */
export function grantEditPermission(
  perms: { canEdit: boolean; canManage: boolean } = { canEdit: true, canManage: true },
): void {
  useEditorStore.getState().setPermissions(perms)
}
