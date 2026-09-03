import { create } from 'zustand'
import {
  createEmptyModel, DEFAULT_NAMING_RULES, DEFAULT_TABLE_OPTIONS,
  type Dialect, type NamingRules, type Op, type Peer,
  type ProjectModel, type TableOptions,
} from '@erdd/core'

export type ViewMode = 'logical' | 'physical' | 'mixed'
const HISTORY_CAP = 100

type EditorState = {
  model: ProjectModel
  seq: number
  loaded: boolean
  loadedProjectId: string | null
  namingRules: NamingRules
  /** 프로젝트 수준 테이블 옵션(방언 4키). DDL 내보내기가 그대로 붙인다. */
  tableOptions: TableOptions
  dialects: Dialect[]
  /** 프로젝트 이름(버전 모델 밖, project.get). DBML 의 Project 블록에 쓴다. */
  projectName: string | null
  /** 모델을 편집할 수 있는가(서버 판정). 로드 전 기본값 false — fail-closed. */
  canEdit: boolean
  /** 프로젝트를 관리할 수 있는가(스냅샷 복원·삭제). 로드 전 기본값 false. */
  canManage: boolean
  /** 로컬 모드에서 파일이 깨져 편집이 잠긴 상태. null 이면 정상. */
  blocked: { path: string; message: string }[] | null
  /**
   * 로컬 모드의 저장 상태. **서버(FileStore)가 진실**이고 SSE `status` 로 받는다
   * (`use-local-watch`). 서버 모드에서는 전부 false 로 남아 아무 UI 도 뜨지 않는다.
   * - `dirty`: 저장할 것이 남았다
   * - `external`: 파일이 밖에서 바뀌었는데 아직 「유지/다시 읽기」를 고르지 않았다
   * - `saving`: 저장 요청이 도는 중(버튼 중복 클릭 방지)
   */
  localSave: { dirty: boolean; external: boolean; saving: boolean }
  viewMode: ViewMode
  /**
   * 선택된 테이블들. 순서 = 선택한 순서이고 **`[0]`이 주 선택**(presence·사이드바의 기준)이다.
   * `readonly` 인 이유: 빈 선택은 모두 같은 배열 인스턴스(`NO_TABLES`)를 공유하므로
   * 제자리 변형은 전역 상수를 오염시킨다. 타입으로 막는다.
   */
  selectedTableIds: readonly string[]
  /**
   * 선택된 컬럼. `selectedTableIds.length === 1` 일 때만 비어 있지 않을 수 있다(불변식).
   * 테이블 선택과 같은 이유로 `readonly` + 공유 빈 참조(`NO_COLUMNS`)를 쓴다 — 캔버스가 이 값을
   * `derived` 노드 메모의 의존으로 읽으므로, 매번 새 빈 배열이면 노드 전체가 다시 만들어진다.
   */
  selectedColumnIds: readonly string[]
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
  setProjectConfig: (
    namingRules: NamingRules, dialects: Dialect[], projectName: string | null,
    tableOptions: TableOptions,
  ) => void
  setPermissions: (perms: { canEdit: boolean; canManage: boolean }) => void
  /** 로컬 모드 파일 손상으로 편집을 잠그거나(failures) 푼다(null). canEdit 을 함께 내린다. */
  setBlocked: (failures: { path: string; message: string }[] | null) => void
  setLocalSaveStatus: (s: { dirty: boolean; external: boolean }) => void
  setSaving: (saving: boolean) => void
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
  selectColumn: (tableId: string, columnId: string, mode: 'replace' | 'toggle' | 'range') => void
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

/**
 * 주 선택 = **처음** 고른 테이블. 순서는 선택한 순서이므로 `[0]`이 "가장 먼저 잡은 것"이다.
 * 이 규칙이 흩어지지 않게 셀렉터를 여기서만 정의한다.
 */
export const primaryTableId = (s: EditorState): string | null => s.selectedTableIds[0] ?? null

/** 모든 "비운 상태"가 같은 배열 인스턴스를 공유한다 — 불필요한 리렌더를 막는다. 절대 변형하지 마라. */
const NO_TABLES: readonly string[] = []
/** 컬럼 선택의 빈 공유 참조. `NO_TABLES`와 같은 이유(리렌더 억제 + 변형 방지)다. */
const NO_COLUMNS: readonly string[] = []

const CLEARED_SELECTION = {
  selectedTableIds: NO_TABLES, selectedColumnIds: NO_COLUMNS,
  selectedRelationshipId: null, selectedNoteId: null, selectedGroupId: null,
}

/**
 * 모델에 아직 존재하는 선택만 남긴다. **resync와 실시간 삭제 수신이 이 한 규칙을 공유한다** —
 * 같은 삭제 사건이 도착 경로(op 배치 / seq 간극 리로드)에 따라 다른 결과를 내면 안 되기 때문이다.
 * 규칙이 두 벌이면 언젠가 갈린다.
 *
 * 참조 규약: 전부 살아남았으면 **원래 배열 참조를 그대로** 돌려준다(리렌더 억제 — 실시간 op는 초당
 * 여러 번 온다). 전부 사라졌으면 새 빈 배열이 아니라 **빈 선택의 공유 참조**를 쓴다.
 */
function keptSelection(s: EditorState, model: ProjectModel) {
  const keep = (id: string | null, rec: Record<string, unknown>) =>
    (id !== null && Object.hasOwn(rec, id) ? id : null)
  const keptTables = s.selectedTableIds.filter((id) => Object.hasOwn(model.tables, id))
  const selectedTableIds = keptTables.length === s.selectedTableIds.length
    ? s.selectedTableIds
    : keptTables.length === 0 ? NO_TABLES : keptTables
  /*
   * 컬럼은 **테이블에 종속된 선택**이라(canvas-clipboard 설계 D-C1) 테이블이 걸러진 뒤에도
   * 불변식 `selectedTableIds.length !== 1 → selectedColumnIds가 빈 배열`이 유지돼야 한다.
   * 그래서 남은 테이블이 정확히 하나일 때만, 그 테이블에 아직 붙어 있는 컬럼만 남긴다.
   * 이 규칙은 원래 resync 안에만 있었다 — pruneSelection(로컬 편집·남의 삭제 수신)이 같은 사건을
   * 다르게 처리하지 않도록 keptSelection 안으로 들였다.
   */
  const keptColumns = selectedTableIds.length === 1
    ? s.selectedColumnIds.filter((id) => model.columns[id]?.tableId === selectedTableIds[0])
    : []
  return {
    selectedTableIds,
    selectedColumnIds: keptColumns.length === s.selectedColumnIds.length
      ? s.selectedColumnIds
      : keptColumns.length === 0 ? NO_COLUMNS : keptColumns,
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
  tableOptions: DEFAULT_TABLE_OPTIONS,
  dialects: [],
  projectName: null,
  canEdit: false,
  canManage: false,
  blocked: null,
  localSave: { dirty: false, external: false, saving: false },
  viewMode: 'physical',
  ...CLEARED_SELECTION,
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
  setProjectConfig: (namingRules, dialects, projectName, tableOptions) =>
    set({ namingRules, dialects, projectName, tableOptions }),
  // blocked(파일 손상) 상태에서는 project.get이 다시 도착해도 편집을 열지 않는다 — 두 곳이
  // canEdit을 다투지 않도록 setBlocked가 내린 잠금을 여기서 존중한다.
  setPermissions: ({ canEdit, canManage }) =>
    set((s) => ({ canEdit: s.blocked !== null ? false : canEdit, canManage })),
  setBlocked: (failures) => set({ blocked: failures, canEdit: failures === null }),
  setLocalSaveStatus: ({ dirty, external }) =>
    set((s) => ({ localSave: { ...s.localSave, dirty, external } })),
  setSaving: (saving) => set((s) => ({ localSave: { ...s.localSave, saving } })),
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
  // 컬럼 선택은 테이블이 하나일 때만 성립한다(불변식) — CLEARED_SELECTION이 함께 비운다.
  // 토글은 정의상 그 id를 넣거나 빼므로 "같은 단일 테이블이 그대로 남는" 갈래가 존재하지 않는다.
  toggleTable: (tableId) => set((s) => {
    const next = s.selectedTableIds.includes(tableId)
      ? s.selectedTableIds.filter((id) => id !== tableId)
      : [...s.selectedTableIds, tableId]
    return { ...CLEARED_SELECTION, selectedTableIds: next.length === 0 ? NO_TABLES : next }
  }),
  // 빈 배열은 **다른 종류의** 선택(메모·관계·그룹)을 지우지 않는다 — 캔버스에서 메모를 클릭하면
  // ReactFlow가 테이블 해제로 빈 배열을 쏘는데, 그것이 같은 클릭의 selectNote를 지우면 안 된다.
  // **컬럼은 예외다**: 형제가 아니라 테이블에 종속된 선택이라(D-C1) 테이블이 비면 불변식상
  // 함께 비어야 한다. 이미 비어 있는지 따로 보지 않는다 — zustand는 어떤 partial을 받든 새 루트
  // 상태를 만들어 리스너를 전부 호출하므로 `{}` 를 돌려줘도 리렌더가 줄지 않는다. 억제는
  // **같은 참조**가 한다.
  selectTables: (tableIds) => set(
    tableIds.length === 0
      ? { selectedTableIds: NO_TABLES, selectedColumnIds: NO_COLUMNS }
      : { ...CLEARED_SELECTION, selectedTableIds: [...tableIds] }),
  selectColumn: (tableId, columnId, mode) => set((s) => {
    const sameTable = s.selectedTableIds.length === 1 && s.selectedTableIds[0] === tableId
    const base: readonly string[] = sameTable ? s.selectedColumnIds : NO_COLUMNS
    let next: string[]
    if (mode === 'toggle') {
      next = base.includes(columnId) ? base.filter((x) => x !== columnId) : [...base, columnId]
    } else if (mode === 'range' && base.length > 0) {
      const anchor = base[base.length - 1]!
      const ordered = Object.values(s.model.columns)
        .filter((c) => c.tableId === tableId)
        .sort((a, b) => a.order - b.order)
        .map((c) => c.id)
      const i = ordered.indexOf(anchor)
      const j = ordered.indexOf(columnId)
      next = i === -1 || j === -1 ? [columnId] : ordered.slice(Math.min(i, j), Math.max(i, j) + 1)
    } else {
      next = [columnId]
    }
    return {
      ...CLEARED_SELECTION,
      selectedTableIds: [tableId],
      selectedColumnIds: next.length === 0 ? NO_COLUMNS : next,
    }
  }),
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
    namingRules: DEFAULT_NAMING_RULES, tableOptions: DEFAULT_TABLE_OPTIONS,
    dialects: [], projectName: null, peers: [],
    canEdit: false, canManage: false, blocked: null,
    localSave: { dirty: false, external: false, saving: false },
    ...CLEARED_SELECTION, focusTableId: null, activeGroupView: null, undoStack: [], redoStack: [],
  }),
}))
