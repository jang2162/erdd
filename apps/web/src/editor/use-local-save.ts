import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import {
  LOCAL_DISCARD_PATH, LOCAL_KEEP_PATH, LOCAL_SAVE_PATH, type LocalSaveResult,
} from '@erdd/core'
import { formatCount } from '@/lib/format'
import { useEditorStore } from './store.js'
import { failedMutationCount, serializeMutation } from './use-model.js'

/**
 * 편집 중인 입력을 모델에 반영하고, **그 편집이 서버에 닿을 때까지** 기다린다 — 입력란은 blur 에서
 * 커밋하므로 이것 없이 저장하면 방금 친 값이 빠진 채 성공 토스트가 뜬다. 기다린 편집 중 하나라도
 * 거절됐으면 false 다. 단계마다 무엇을 막는지는 `docs/guides/editor-state.md`
 * 「저장은 편집 중인 입력을 먼저 반영한다(로컬 모드)」.
 */
async function flushPendingEdits(): Promise<boolean> {
  const failedBefore = failedMutationCount()
  const el = document.activeElement
  const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null
  typing?.blur()
  await new Promise((r) => setTimeout(r, 0))
  await serializeMutation(() => Promise.resolve())
  if (typing) restoreFocus(typing)
  return failedMutationCount() === failedBefore
}

/**
 * blur 로 떠난 칸에 포커스를 되돌린다 — body 에 두면 단축키 가드가 풀려 이어 친 Backspace 가 선택
 * 테이블을 지운다. 커밋으로 리마운트된 칸(`key={value}`)은 **같은 id 의 새 요소**로 찾는다.
 */
function restoreFocus(el: HTMLInputElement | HTMLTextAreaElement): void {
  if (document.activeElement !== document.body && document.activeElement !== null) return
  const target = el.isConnected ? el : (el.id ? document.getElementById(el.id) : null)
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return
  target.focus()
  // 리마운트된 칸은 커서가 맨 앞에 선다 — 치던 자리(끝)로 옮긴다. color 등은 선택 API 가 없다.
  try { target.setSelectionRange(target.value.length, target.value.length) } catch { /* 지원 안 함 */ }
}

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
 * ⚠️ **`beforeunload` 경고를 붙이지 않는다.** 커밋된 편집은 서버가 드래프트로 들고 있어 탭을 닫아도
 * 잃지 않는다 — 미저장 편집을 이유로 경고하면 거짓말이다. 잃는 것은 **포커스를 빼기 전에 치고 있던
 * 한 칸**뿐이고(매뉴얼 4.4 의 예외), 그것 하나 때문에 닫을 때마다 경고하는 것이 더 나쁘다.
 */
export function useLocalSave() {
  const { dirty, external, saving } = useEditorStore((s) => s.localSave)

  /**
   * ⚠️ **상태 코드를 봐야 한다.** `store.save()` 는 디스크 가득참·권한 오류에서 예외를 내고
   * 그것은 Fastify 500 이 된다 — `LocalSaveResult` 가 약속하지 않는 **세 번째 결과**다. 그대로
   * 캐스트하면 `r.ok === undefined` 라 거절 갈래로 떨어져 참이던 `external` 을 거짓으로 덮고
   * 영문 오류를 토스트로 띄운다. 403(낯선 Origin)도 같은 길로 샌다.
   */
  const post = useCallback(async (path: string): Promise<unknown> => {
    const res = await fetch(path, { method: 'POST' })
    if (!res.ok) throw new Error(`요청이 실패했습니다 (HTTP ${res.status})`)
    return res.json()
  }, [])

  const save = useCallback(async () => {
    const store = useEditorStore.getState()
    if (store.localSave.saving) return
    store.setSaving(true)
    try {
      // 거절된 편집은 모델에서 되돌려졌는데 `CommitInput` 은 그 값을 그대로 보여 준다. 저장하고
      // 성공을 띄우면 「친 값이 빠진 채 성공」 그대로다 — 거절 사유 토스트는 useSubmit 이 이미 띄웠다.
      if (!await flushPendingEdits()) {
        toast.error('반영되지 않은 편집이 있어 저장하지 않았습니다')
        return
      }
      const r = await post(LOCAL_SAVE_PATH) as LocalSaveResult
      if (r.ok) {
        useEditorStore.getState().setLocalSaveStatus({ dirty: false, external: false })
        toast.success(r.written.length + r.deleted.length === 0
          ? '저장할 변경이 없습니다'
          : `저장했습니다 (파일 ${formatCount(r.written.length + r.deleted.length)}개)`)
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
