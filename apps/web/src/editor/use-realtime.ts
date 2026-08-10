import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  applyOps, parseServerMessage,
  WS_CLOSE_FORBIDDEN, WS_CLOSE_UNAUTHORIZED,
  type ClientMessage, type Op, type PeerSelection, type ProjectModel, type ServerMessage,
} from '@erdd/core'
import { useTRPC } from '@/lib/trpc'
import { useEditorStore } from './store.js'
import { serializeMutation } from './use-model.js'

/** 인증 실패로 닫힌 소켓은 재시도하지 않는다 — 백오프가 무한 루프가 된다. */
const NO_RETRY_CODES = new Set<number>([WS_CLOSE_UNAUTHORIZED, WS_CLOSE_FORBIDDEN])
const BACKOFF_MS = [1000, 2000, 4000, 8000]
/** 선택은 드래그·연속 클릭으로 잦게 바뀐다 — 마지막 값만 보낸다. */
const SELECTION_THROTTLE_MS = 100

/** 서버와 같은 오리진의 소켓 주소. 스킴만 ws/wss로 바꾼다. */
export function wsUrl(projectId: string, href: string): string {
  const u = new URL('/ws', href)
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:'
  u.searchParams.set('projectId', projectId)
  return u.toString()
}

export type SelectionImpact = 'deleted' | 'changed' | null

type SelectionSource = {
  selectedTableIds: readonly string[]
  selectedRelationshipId: string | null
  selectedNoteId: string | null
  selectedGroupId: string | null
}

/** 스토어 선택 상태를 프로토콜의 selections 배열로 좁힌다. 테이블은 여러 건일 수 있다. */
function selectionsOf(s: SelectionSource): PeerSelection[] {
  if (s.selectedTableIds.length > 0) {
    return s.selectedTableIds.map((id) => ({ kind: 'table' as const, id }))
  }
  if (s.selectedRelationshipId !== null) return [{ kind: 'relationship', id: s.selectedRelationshipId }]
  if (s.selectedNoteId !== null) return [{ kind: 'note', id: s.selectedNoteId }]
  if (s.selectedGroupId !== null) return [{ kind: 'group', id: s.selectedGroupId }]
  return []
}

/**
 * 수신 op 배치가 내가 보고 있는 대상(테이블·관계·메모와 그 하위 컬럼·인덱스)을 건드렸는지.
 * 삭제가 수정을 이긴다 — "삭제됐다"가 사용자에게 더 중요한 사실이다.
 * 모델은 **적용 전** 상태여야 한다(삭제된 컬럼의 소속 테이블을 여기서 조회한다).
 */
export function selectionImpact(
  model: ProjectModel,
  ops: readonly Op[],
  selected: { tableIds: readonly string[]; relationshipId: string | null; noteId: string | null },
): SelectionImpact {
  const tableIds = new Set(selected.tableIds)
  const targets = new Set<string>(tableIds)
  if (selected.relationshipId !== null) targets.add(selected.relationshipId)
  if (selected.noteId !== null) targets.add(selected.noteId)
  if (targets.size === 0) return null
  let impact: SelectionImpact = null
  for (const op of ops) {
    if (targets.has(op.entityId)) {
      if (op.action === 'delete') return 'deleted'
      impact = 'changed'
      continue
    }
    if (tableIds.size > 0 && (op.entity === 'column' || op.entity === 'index')) {
      const owner = op.action === 'create'
        ? (op.data as { tableId?: unknown }).tableId
        : op.entity === 'column'
          ? model.columns[op.entityId]?.tableId
          : model.indexes[op.entityId]?.tableId
      if (typeof owner === 'string' && tableIds.has(owner)) impact = 'changed'
    }
  }
  return impact
}

/**
 * 프로젝트 실시간 채널에 붙는다. 모델이 로드된 뒤에만 연결하고, 프로젝트가 바뀌면 다시 연다.
 * 수신 처리는 전부 serializeMutation 체인 안에서 돈다 — 내 낙관적 mutation과 절대 교차하지 않는다.
 */
export function useRealtime(projectId: string): void {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const ready = useEditorStore((s) => s.loaded && s.loadedProjectId === projectId)
  const socketRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!ready) return
    let disposed = false
    let attempt = 0
    let timer: ReturnType<typeof setTimeout> | undefined

    const reload = async () => {
      try {
        const fresh = await queryClient.fetchQuery(trpc.model.get.queryOptions({ projectId }))
        if (useEditorStore.getState().loadedProjectId === projectId) {
          useEditorStore.getState().resync(fresh.model, fresh.seq)
        }
      } catch {
        toast.error('서버 상태를 불러오지 못했습니다. 새로고침해 주세요.')
      }
    }

    const handle = (msg: ServerMessage) => serializeMutation(async () => {
      const s = useEditorStore.getState()
      if (s.loadedProjectId !== projectId) return

      if (msg.type === 'presence') { s.setPeers(msg.peers); return }
      if (msg.type === 'ready') {
        s.setPeers(msg.peers)
        if (msg.seq !== s.seq) await reload()
        return
      }
      if (msg.seq <= s.seq) return              // 내 변경의 에코이거나 중복
      if (msg.seq !== s.seq + 1) { await reload(); return }   // 간극 → 통째 리로드

      let next: ProjectModel
      try {
        next = applyOps(s.model, msg.ops)
      } catch {
        await reload()
        return
      }
      const impact = selectionImpact(s.model, msg.ops, {
        tableIds: s.selectedTableIds,
        relationshipId: s.selectedRelationshipId,
        noteId: s.selectedNoteId,
      })
      useEditorStore.getState().setModel(next)
      useEditorStore.getState().setSeq(msg.seq)
      // 배치당 최대 1건 — 대량 op에서 토스트가 쏟아지지 않게.
      if (impact === 'deleted') {
        // 선택 전체를 비우지 않고 **사라진 것만** 걷어낸다. 다중 선택 중 하나만 삭제됐는데
        // 나머지까지 잃으면 안 되고, 무엇보다 같은 사건을 seq 간극·재접속으로 받았을 때
        // (resync) 와 결과가 달라지면 안 된다 — 그래서 store의 같은 규칙을 부른다.
        useEditorStore.getState().pruneSelection(next)
        toast.info(useEditorStore.getState().selectedTableIds.length > 0
          ? '다른 사용자가 선택 항목 중 일부를 삭제했습니다'
          : '다른 사용자가 이 항목을 삭제했습니다')
      } else if (impact === 'changed') {
        toast.info('다른 사용자가 이 항목을 수정했습니다')
      }
    })

    const connect = () => {
      if (disposed) return
      const socket = new WebSocket(wsUrl(projectId, window.location.href))
      socketRef.current = socket
      socket.onopen = () => {
        attempt = 0
        // 재접속 시 서버 쪽 Entry는 빈 selections로 새로 시작한다. 로컬 선택이 그대로여도
        // 다시 알리지 않으면(발신 effect는 "값이 바뀔 때만" 보낸다) 다른 참여자에게는
        // 이 사용자의 하이라이트가 재접속 전까지 사라진 채로 남는다.
        const msg: ClientMessage = { type: 'selection', selections: selectionsOf(useEditorStore.getState()) }
        socket.send(JSON.stringify(msg))
      }
      socket.onmessage = (ev) => {
        const msg = parseServerMessage(String(ev.data))
        if (msg) void handle(msg)
      }
      socket.onclose = (ev) => {
        socketRef.current = null
        if (disposed || NO_RETRY_CODES.has(ev.code)) return
        const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!
        attempt += 1
        timer = setTimeout(connect, delay)
      }
    }
    connect()

    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      const socket = socketRef.current
      socketRef.current = null
      socket?.close()
      useEditorStore.getState().setPeers([])
    }
  }, [projectId, ready, queryClient, trpc])

  // 로컬 선택 → 서버. 소켓 수명주기와 독립이므로 별도 effect다(재접속 중이면 조용히 버린다).
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = JSON.stringify(selectionsOf(useEditorStore.getState()))

    const flush = () => {
      timer = undefined
      const socket = socketRef.current
      if (!socket || socket.readyState !== 1) return // 1 = OPEN
      const msg: ClientMessage = { type: 'selection', selections: selectionsOf(useEditorStore.getState()) }
      socket.send(JSON.stringify(msg))
    }

    const unsubscribe = useEditorStore.subscribe((s) => {
      const current = JSON.stringify(selectionsOf(s))
      if (current === last) return
      last = current
      if (timer === undefined) timer = setTimeout(flush, SELECTION_THROTTLE_MS)
    })

    return () => {
      unsubscribe()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])
}
