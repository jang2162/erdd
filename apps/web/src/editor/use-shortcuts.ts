import { useEffect } from 'react'
import { deleteColumnCascade, type ProjectModel } from '@erdd/core'
import { useEditorStore } from './store.js'
import { useModelMutation } from './use-model.js'
import { newId } from './uid.js'
import { parseClipboard, serializeColumns, serializeTables } from './clipboard.js'
import {
  pasteColumns, pasteTables, planPasteColumnIds, planPasteTableIds,
} from './clipboard-edits.js'
import { removeTable } from './model-edits.js'

/** 붙여넣은 테이블을 원본 위에 겹치지 않게 밀어 놓는 거리(px). */
const PASTE_OFFSET = { x: 40, y: 40 }

/** 입력 중인가 — 그렇다면 단축키를 전부 브라우저 기본 동작에 넘긴다. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

/**
 * 다이얼로그가 열려 있는가 — 그렇다면 단축키를 전부 브라우저 기본 동작에 넘긴다(설계 §3.7:
 * "편집 다이얼로그 안의 복사·붙여넣기는 브라우저 기본 동작이어야 한다").
 *
 * `e.target`이 아니라 **문서 전체**를 본다. 다이얼로그가 떠 있어도 포커스는 닫기 버튼·
 * DialogContent 자신처럼 입력란이 아닌 곳에 있을 수 있고, 그때 Delete가 모달 뒤의 선택
 * 테이블을 지우는 것이 이 가드가 막는 사고다.
 *
 * 표식으로 `[role="dialog"]`를 쓴다. 실측(Radix Dialog + components/ui/dialog.tsx):
 * - 닫혀 있을 때 Content는 **언마운트**된다 → `[role="dialog"]` 0개. 잔류 오탐이 없다.
 * - 열리면 DialogContent에 `role="dialog" data-state="open" data-slot="dialog-content"`가 붙는다.
 * - ⚠️ `[data-state="open"]`만으로는 안 된다 — 다이얼로그 하나가 열렸을 때 3개가 잡힌다.
 *   **트리거 버튼**도 `data-state="open"`을 달기 때문이다(드롭다운·셀렉트 트리거도 마찬가지).
 * `[data-state="open"]`을 AND로 묶지 않는 것은 fail-safe 쪽을 택한 것이다 — role만 보면
 * forceMount·닫힘 애니메이션 중에도 계속 막는다(막는 방향이 안전한 실패다).
 */
function isDialogOpen(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
}

/**
 * 캔버스 단축키. document에 걸되 입력 중에는 아무것도 하지 않는다.
 * 붙여넣기는 paste 이벤트로 받는다 — navigator.clipboard.readText()는 권한 프롬프트를 띄우는
 * 브라우저가 있어 Cmd+V 경로에 쓸 수 없다(설계 §3.8).
 */
export function useEditorShortcuts({ projectId }: { projectId: string }) {
  const mutate = useModelMutation(projectId)

  useEffect(() => {
    const copyPayload = (model: ProjectModel, tableIds: string[], columnIds: string[]) =>
      (columnIds.length > 0 ? serializeColumns(model, columnIds) : serializeTables(model, tableIds))

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || isDialogOpen()) return
      const s = useEditorStore.getState()
      const { model, canEdit, selectedTableIds, selectedColumnIds } = s
      const mod = e.metaKey || e.ctrlKey
      const nothingSelected = selectedTableIds.length === 0

      if (mod && e.key.toLowerCase() === 'c') {
        if (nothingSelected) return
        e.preventDefault()
        void navigator.clipboard.writeText(JSON.stringify(
          copyPayload(model, selectedTableIds, selectedColumnIds)))
        return
      }

      if (mod && e.key.toLowerCase() === 'x') {
        if (!canEdit || nothingSelected) return
        e.preventDefault()
        // 복사와 삭제를 한 mutation으로 — Revision 1건 · undo 1회(설계 §3.6)
        void navigator.clipboard.writeText(JSON.stringify(
          copyPayload(model, selectedTableIds, selectedColumnIds)))
        const columnIds = [...selectedColumnIds]
        const tableIds = [...selectedTableIds]
        void mutate(
          (m) => (columnIds.length > 0
            ? columnIds.reduce((acc, id) => deleteColumnCascade(acc, id), m)
            : tableIds.reduce((acc, id) => removeTable(acc, id), m)),
          { summary: '잘라내기' },
        )
        s.select(null)
        return
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!canEdit || nothingSelected) return
        e.preventDefault()
        const columnIds = [...selectedColumnIds]
        const tableIds = [...selectedTableIds]
        void mutate(
          (m) => (columnIds.length > 0
            ? columnIds.reduce((acc, id) => deleteColumnCascade(acc, id), m)
            : tableIds.reduce((acc, id) => removeTable(acc, id), m)),
          { summary: columnIds.length > 0 ? '컬럼 삭제' : '테이블 삭제' },
        )
        // 지운 대상은 선택에서 빼야 한다. 컬럼을 지웠을 때 잔재를 남기면 모델에 없는 컬럼 id가
        // selectedColumnIds에 남고, 이어지는 Cmd+C가 `{"kind":"columns","columns":[]}` 빈
        // 페이로드로 **시스템 클립보드를 덮는다**(사용자는 테이블을 복사한 줄 안다).
        // 그렇다고 select(null)로 통째 비우면 보던 테이블에서 벗어난다 — 테이블 선택은 남긴다.
        // `select(tableId)`가 CLEARED_SELECTION을 거쳐 그 테이블만 남기고 컬럼을 비운다.
        // 컬럼 선택은 테이블이 하나일 때만 성립하므로(store 불변식) tableIds[0]가 그 테이블이다.
        s.select(columnIds.length > 0 ? tableIds[0]! : null)
      }
    }

    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || isDialogOpen()) return
      const s = useEditorStore.getState()
      if (!s.canEdit) return
      const text = e.clipboardData?.getData('text/plain') ?? ''
      const payload = parseClipboard(text)
      if (!payload) return          // 이 앱이 쓴 것이 아니면 조용히 무시한다
      e.preventDefault()

      if (payload.kind === 'columns') {
        const tableId = s.selectedTableIds.length === 1 ? s.selectedTableIds[0] : undefined
        if (tableId === undefined) return
        const ids = planPasteColumnIds(payload, newId)     // producer 밖에서 발급
        void mutate((m) => pasteColumns(m, payload, { tableId, ids }), { summary: '컬럼 붙여넣기' })
        return
      }

      const ids = planPasteTableIds(payload, newId)
      void mutate((m) => pasteTables(m, payload, { ids, offset: PASTE_OFFSET }),
        { summary: '테이블 붙여넣기' })
      s.selectTables(ids.map((i) => i.tableId))
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('paste', onPaste)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('paste', onPaste)
    }
  }, [mutate])
}
