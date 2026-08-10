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
      if (isTypingTarget(e.target)) return
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
        if (columnIds.length === 0) s.select(null)
      }
    }

    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return
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
