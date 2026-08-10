import { create } from 'zustand'
import {
  createEmptyModel, DEFAULT_NAMING_RULES, type Dialect, type NamingRules, type Op, type Peer,
  type ProjectModel,
} from '@erdd/core'

export type ViewMode = 'logical' | 'physical' | 'mixed'
const HISTORY_CAP = 100

type EditorState = {
  model: ProjectModel
  seq: number
  loaded: boolean
  loadedProjectId: string | null
  namingRules: NamingRules
  dialects: Dialect[]
  /** 모델을 편집할 수 있는가(서버 판정). 로드 전 기본값 false — fail-closed. */
  canEdit: boolean
  /** 프로젝트를 관리할 수 있는가(스냅샷 복원·삭제). 로드 전 기본값 false. */
  canManage: boolean
  viewMode: ViewMode
  /**
   * 선택된 테이블들. **마지막 원소가 주 선택**(상세 패널·포커스 대상)이다.
   * `readonly` 인 이유: 빈 선택은 모두 같은 배열 인스턴스(`NO_TABLES`)를 공유하므로
   * 제자리 변형은 전역 상수를 오염시킨다. 타입으로 막는다.
   */
  selectedTableIds: readonly string[]
  selectedRelationshipId: string | null
  selectedNoteId: string | null
  selectedGroupId: string | null
  focusTableId: string | null
  activeGroupView: string | null
  undoStack: Op[][]
  redoStack: Op[][]
  peers: Peer[]
  /**
   * 모델을 **통째로 갈아 끼운다**(최초 로드·프로젝트 전환·스냅샷 복원). 화면 상태를 전부 처음으로
   * 되돌린다 — 히스토리·그룹 뷰·참여자에 이어 **선택도 비운다**. 같은 프로젝트를 서버 상태로
   * 되맞추는 것은 이것이 아니라 resync다.
   */
  setLoaded: (model: ProjectModel, seq: number, projectId: string) => void
  setProjectConfig: (namingRules: NamingRules, dialects: Dialect[]) => void
  setPermissions: (perms: { canEdit: boolean; canManage: boolean }) => void
  setModel: (model: ProjectModel) => void
  setSeq: (seq: number) => void
  setPeers: (peers: Peer[]) => void
  /**
   * **같은 프로젝트**를 서버 상태로 되맞춘다(실시간 seq 간극·재접속·mutation 거절 복구).
   * setLoaded와 달리 그룹 뷰·참여자를 유지하고, 선택은 비우지 않고 **살아남은 것만** 남긴다.
   */
  resync: (model: ProjectModel, seq: number) => void
  /** 모델에서 사라진 대상만 선택에서 걷어낸다(살아남은 선택은 유지). */
  pruneSelection: (model: ProjectModel) => void
  setViewMode: (viewMode: ViewMode) => void
  select: (tableId: string | null) => void
  toggleTable: (tableId: string) => void
  selectTables: (tableIds: readonly string[]) => void
  selectRelationship: (id: string | null) => void
  selectNote: (id: string | null) => void
  selectGroup: (id: string | null) => void
  focus: (tableId: string) => void
  consumeFocus: () => void
  enterGroupView: (groupId: string) => void
  exitGroupView: () => void
  recordEdit: (ops: Op[]) => void
  moveUndoToRedo: () => Op[] | null
  moveRedoToUndo: () => Op[] | null
  reset: () => void
}

/** 주 선택 = 마지막으로 고른 테이블. 이 규칙이 흩어지지 않게 셀렉터를 여기서만 정의한다. */
export const primaryTableId = (s: EditorState): string | null => s.selectedTableIds.at(-1) ?? null

/** 모든 "비운 상태"가 같은 배열 인스턴스를 공유한다 — 불필요한 리렌더를 막는다. 절대 변형하지 마라. */
const NO_TABLES: readonly string[] = []

const CLEARED_SELECTION = {
  selectedTableIds: NO_TABLES, selectedRelationshipId: null, selectedNoteId: null, selectedGroupId: null,
}

/**
 * 모델에 아직 존재하는 선택만 남긴다. **resync와 실시간 삭제 수신이 이 한 규칙을 공유한다** —
 * 같은 삭제 사건이 도착 경로(op 배치 / seq 간극 리로드)에 따라 다른 결과를 내면 안 되기 때문이다.
 * 규칙이 두 벌이면 언젠가 갈린다.
 *
 * 참조 규약: 전부 살아남았으면 **원래 배열 참조를 그대로** 돌려준다(리렌더 억제 — 실시간 op는 초당
 * 여러 번 온다). 전부 사라졌으면 새 빈 배열이 아니라 **빈 선택의 공유 참조**(`NO_TABLES`)를 쓴다.
 */
function keptSelection(s: EditorState, model: ProjectModel) {
  const keep = (id: string | null, rec: Record<string, unknown>) =>
    (id !== null && Object.hasOwn(rec, id) ? id : null)
  const keptTables = s.selectedTableIds.filter((id) => Object.hasOwn(model.tables, id))
  return {
    selectedTableIds: keptTables.length === s.selectedTableIds.length
      ? s.selectedTableIds
      : keptTables.length === 0 ? NO_TABLES : keptTables,
    selectedRelationshipId: keep(s.selectedRelationshipId, model.relationships),
    selectedNoteId: keep(s.selectedNoteId, model.notes),
    selectedGroupId: keep(s.selectedGroupId, model.tableGroups),
  }
}

export const useEditorStore = create<EditorState>((set, get) => ({
  model: createEmptyModel(),
  seq: 0,
  loaded: false,
  loadedProjectId: null,
  namingRules: DEFAULT_NAMING_RULES,
  dialects: [],
  canEdit: false,
  canManage: false,
  viewMode: 'physical',
  selectedTableIds: NO_TABLES,
  selectedRelationshipId: null,
  selectedNoteId: null,
  selectedGroupId: null,
  focusTableId: null,
  activeGroupView: null,
  undoStack: [],
  redoStack: [],
  peers: [],
  // 선택도 함께 비운다. 프로덕션에 store.reset() 호출부가 한 군데도 없어, 프로젝트 전환은
  // setLoaded 하나로만 이뤄진다 — 비우지 않으면 **이전 프로젝트의 선택 배열이 새 프로젝트로
  // 그대로 넘어와** BulkPanel이 "N개 테이블 선택됨 + 빈 목록"으로 뜨고 죽은 id의 선택이
  // presence로 계속 나간다. keptSelection(살아남은 것만 남기기)을 쓰지 않는 이유: 모델이 통째로
  // 바뀌었으므로 "살아남았다"의 기준이 다른 모델이고, 걸러 남는 것이 있다면 id가 우연히 겹친
  // 것뿐이다. 같은 프로젝트를 서버 상태로 되맞추는 경로는 resync가 맡는다(설계 §4 — 규칙 한 벌).
  setLoaded: (model, seq, projectId) =>
    set({
      model, seq, loaded: true, loadedProjectId: projectId,
      undoStack: [], redoStack: [], activeGroupView: null, peers: [],
      ...CLEARED_SELECTION,
    }),
  setProjectConfig: (namingRules, dialects) => set({ namingRules, dialects }),
  setPermissions: ({ canEdit, canManage }) => set({ canEdit, canManage }),
  setModel: (model) => set({ model }),
  setSeq: (seq) => set((s) => ({ seq: Math.max(s.seq, seq) })),
  setPeers: (peers) => set({ peers }),
  // undo 스택은 버린다(되돌리려는 op가 이미 사라진 대상을 가리킬 수 있다).
  // activeGroupView는 유지한다 — 남이 편집할 때마다 그룹 뷰에서 튕기면 못 쓴다.
  // 선택은 대상이 아직 존재할 때만 남긴다.
  resync: (model, seq) => set((s) => ({
    model, seq, loaded: true, undoStack: [], redoStack: [],
    ...keptSelection(s, model),
  })),
  pruneSelection: (model) => set((s) => keptSelection(s, model)),
  setViewMode: (viewMode) => set({ viewMode }),
  select: (tableId) => set({ ...CLEARED_SELECTION, selectedTableIds: tableId === null ? NO_TABLES : [tableId] }),
  toggleTable: (tableId) => set((s) => {
    const next = s.selectedTableIds.includes(tableId)
      ? s.selectedTableIds.filter((id) => id !== tableId)
      : [...s.selectedTableIds, tableId]
    return { ...CLEARED_SELECTION, selectedTableIds: next.length === 0 ? NO_TABLES : next }
  }),
  // 빈 배열은 다른 종류 선택을 지우지 않는다 — 캔버스에서 메모를 클릭하면
  // ReactFlow가 테이블 해제로 빈 배열을 쏘는데, 그것이 같은 클릭의 selectNote를 지우면 안 된다.
  // 이미 비어 있는지 따로 보지 않는다 — zustand는 어떤 partial을 받든 새 루트 상태를 만들어
  // 리스너를 전부 호출하므로 `{}` 를 돌려줘도 리렌더가 줄지 않는다. 억제는 **같은 참조**가 한다.
  selectTables: (tableIds) => set(
    tableIds.length === 0
      ? { selectedTableIds: NO_TABLES }
      : { ...CLEARED_SELECTION, selectedTableIds: [...tableIds] }),
  selectRelationship: (selectedRelationshipId) => set({ ...CLEARED_SELECTION, selectedRelationshipId }),
  selectNote: (selectedNoteId) => set({ ...CLEARED_SELECTION, selectedNoteId }),
  selectGroup: (selectedGroupId) => set({ ...CLEARED_SELECTION, selectedGroupId }),
  focus: (id) => set({ ...CLEARED_SELECTION, focusTableId: id, selectedTableIds: [id] }),
  consumeFocus: () => set({ focusTableId: null }),
  enterGroupView: (activeGroupView) => set({ ...CLEARED_SELECTION, activeGroupView }),
  exitGroupView: () => set({ ...CLEARED_SELECTION, activeGroupView: null }),
  recordEdit: (ops) =>
    set((s) => ({ undoStack: [...s.undoStack, ops].slice(-HISTORY_CAP), redoStack: [] })),
  moveUndoToRedo: () => {
    const { undoStack, redoStack } = get()
    const ops = undoStack[undoStack.length - 1]
    if (!ops) return null
    set({ undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, ops] })
    return ops
  },
  moveRedoToUndo: () => {
    const { undoStack, redoStack } = get()
    const ops = redoStack[redoStack.length - 1]
    if (!ops) return null
    set({ redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, ops] })
    return ops
  },
  reset: () => set({
    model: createEmptyModel(), seq: 0, loaded: false, loadedProjectId: null,
    namingRules: DEFAULT_NAMING_RULES, dialects: [], peers: [], canEdit: false, canManage: false,
    ...CLEARED_SELECTION, focusTableId: null, activeGroupView: null, undoStack: [], redoStack: [],
  }),
}))
