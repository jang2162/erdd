import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import {
  LOCAL_DISCARD_PATH, LOCAL_KEEP_PATH, LOCAL_SAVE_PATH, type LocalSaveResult,
} from '@erdd/core'
import { useEditorStore } from './store.js'

/**
 * 로컬 모드의 저장·버리기·유지와 `Cmd+S`.
 *
 * ⚠️ **`use-shortcuts.ts` 에 넣지 않는다.** 그 훅은 `isTypingTarget`/`isDialogOpen` 에서 **먼저
 * 물러나는데**, 저장을 가장 누르고 싶은 순간이 바로 편집 패널 입력란에 타이핑하던 중이다.
 * 그리고 그 훅은 `Canvas` 가 마운트된 동안만 산다.
 *
 * ⚠️ **로컬 모드에서만 마운트한다**(`project.tsx` 의 `isLocal` 가드). 서버 모드에서 브라우저의
 * 「페이지 저장」을 가로채면 안 되는데, **마운트 자체를 막으면 그것이 구조적으로 보장된다** —
 * 훅 안에서 모드를 보고 분기하면 그 분기가 빠져도 타입이 잡아 주지 않는다.
 *
 * ⚠️ **`beforeunload` 경고를 붙이지 않는다.** 드래프트는 서버가 들고 있어 탭을 닫아도 잃는 것이
 * 없다 — 경고를 띄우면 거짓말이다.
 */
export function useLocalSave() {
  const { dirty, external, saving } = useEditorStore((s) => s.localSave)

  const post = useCallback(async (path: string): Promise<unknown> => {
    const res = await fetch(path, { method: 'POST' })
    return res.json()
  }, [])

  const save = useCallback(async () => {
    const store = useEditorStore.getState()
    if (store.localSave.saving) return
    store.setSaving(true)
    try {
      const r = await post(LOCAL_SAVE_PATH) as LocalSaveResult
      if (r.ok) {
        useEditorStore.getState().setLocalSaveStatus({ dirty: false, external: false })
        toast.success(r.written.length + r.deleted.length === 0
          ? '저장할 변경이 없습니다'
          : `저장했습니다 (파일 ${r.written.length + r.deleted.length}개)`)
        return
      }
      // 거절의 두 갈래를 그대로 상태에 옮긴다 — external 이면 배너가 뜨고, blocked 면 이미
      // 손상 배너가 떠 있다. 어느 쪽이든 미저장은 남아 있다.
      useEditorStore.getState().setLocalSaveStatus({
        dirty: true, external: r.reason === 'external',
      })
      toast.error(r.message)
    } catch {
      toast.error('저장하지 못했습니다')
    } finally {
      useEditorStore.getState().setSaving(false)
    }
  }, [post])

  const discard = useCallback(async () => {
    try {
      await post(LOCAL_DISCARD_PATH)
      // 모델 되맞춤은 SSE `reload` 가 한다 — 여기서 직접 다시 가져오면 규칙이 두 벌이 된다.
      useEditorStore.getState().setLocalSaveStatus({ dirty: false, external: false })
    } catch {
      toast.error('되돌리지 못했습니다')
    }
  }, [post])

  const keep = useCallback(async () => {
    try {
      await post(LOCAL_KEEP_PATH)
      // 배너만 닫는다. 편집은 그대로 남아 있고, 다음 저장이 화면 내용으로 파일을 덮어쓴다.
      useEditorStore.getState().setLocalSaveStatus({ dirty: true, external: false })
    } catch {
      toast.error('처리하지 못했습니다')
    }
  }, [post])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 's') return
      // 입력 중이든 다이얼로그가 열려 있든 막고 저장한다 — 브라우저의 「페이지 저장」이 뜨면 안 된다.
      e.preventDefault()
      void save()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [save])

  return { dirty, external, saving, save, discard, keep }
}
