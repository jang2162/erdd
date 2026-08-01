import { afterEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './store.js'

afterEach(() => { useEditorStore.getState().reset() })

describe('editor store 권한 상태', () => {
  it('기본값은 fail-closed다 — 서버 판정이 오기 전에는 편집할 수 없다', () => {
    expect(useEditorStore.getState().canEdit).toBe(false)
    expect(useEditorStore.getState().canManage).toBe(false)
  })

  it('setPermissions가 두 값을 함께 반영한다', () => {
    useEditorStore.getState().setPermissions({ canEdit: true, canManage: false })
    expect(useEditorStore.getState().canEdit).toBe(true)
    expect(useEditorStore.getState().canManage).toBe(false)
  })

  it('reset은 권한을 fail-closed로 되돌린다', () => {
    useEditorStore.getState().setPermissions({ canEdit: true, canManage: true })
    useEditorStore.getState().reset()
    expect(useEditorStore.getState().canEdit).toBe(false)
    expect(useEditorStore.getState().canManage).toBe(false)
  })
})
