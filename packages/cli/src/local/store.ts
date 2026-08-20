import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { uuidv7 } from 'uuidv7'
import {
  MAX_OPS_PER_MUTATION,
  applyLayout, applyOps, createEmptyModel, filesToModel, layoutFromModel, modelToFiles,
  OpApplyError, validateModelIntegrity,
  type FileTree, type LayoutData, type Note, type Op, type Position, type ProjectModel,
  type TableLayout,
} from '@erdd/core'
import { canonical, readTree, writeTreeChanges } from '../tree.js'

export const LAYOUT_FILE = 'erdd/layout.yaml'
const WRITE_DEBOUNCE_MS = 300

export class LocalStoreError extends Error {}

/** layout.yaml 을 파일 단위로 파싱하지 못했다. `load()` 가 이것을 `fail()` 로 옮긴다. */
class LayoutParseError extends Error {}

export type LoadFailure = { path: string; message: string }

export type StoreState =
  | { ok: true; model: ProjectModel; seq: number }
  | { ok: false; model: ProjectModel; seq: number; failures: LoadFailure[] }

const EMPTY_LAYOUT: LayoutData = { tables: [], notes: [] }

/**
 * 겹친 편집 때문에 확정하지 못한 로드를 몇 번까지 다시 읽을지. 한 번이면 대개 충분하다
 * (다시 읽을 때는 편집이 이미 커밋·flush 돼 있다). 상한이 있어야 편집이 쉼 없이 들어오는
 * 동안 무한히 도는 일이 없다.
 */
const MAX_LOAD_ATTEMPTS = 4

/** `#loadOnce` 의 결과. `stale` 이면 겹친 편집 때문에 확정하지 못했다는 뜻이다. */
type LoadAttempt = { state: StoreState; stale: boolean }

/** 자기 쓰기 판정용 정규화 서명. 키 순서·표현 차이를 지운다. */
function signatureOf(tree: FileTree, layout: LayoutData): string {
  return canonical({ ...tree, [LAYOUT_FILE]: layout }, LAYOUT_FILE) ?? ''
}

/**
 * layout.yaml 을 읽는다. **파싱에 실패하면 던진다** — 호출자가 `fail()` 퍼널로 보내 편집을 잠근다.
 *
 * ⚠️ 「layout = 배치라서 잃어도 된다」가 아니다. 이 파일에는 **메모 본문**(`notes[].content`)이
 * 함께 들어 있고 그것은 사용자가 쓴 콘텐츠다. 파싱 실패를 삼켜 빈 layout 으로 열면 메모가
 * 화면에서 조용히 사라지고, 편집이 잠기지 않으므로 다음 `flush()` 가 `notes: []` 로 그 손실을
 * 파일에 확정한다(설계 §6 은 그 경우 읽기 전용으로 전환하라고 적었고, 같은 이유로
 * `snapshots.json` 에는 이미 같은 방어가 있다).
 *
 * 파일이 **아예 없는 것**은 손상이 아니다 — 빈 layout 으로 연다(`pull` 로 받아 온 프로젝트의
 * 정상 상태다). 빈 문서(주석만 있는 파일)도 마찬가지다.
 *
 * **항목 단위 방어는 관대한 채로 둔다** — 좌표가 숫자가 아닌 항목 하나 때문에 파일 전체를
 * 거절하면 복구가 더 어렵다(아래 `isTableLayout` 주석 참조).
 */
async function readLayout(cwd: string): Promise<LayoutData> {
  let raw: string
  try {
    raw = await readFile(join(cwd, LAYOUT_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_LAYOUT
    throw err
  }
  let parsed: unknown
  try {
    parsed = parseYaml(raw)
  } catch (err) {
    throw new LayoutParseError(`YAML 을 파싱하지 못했습니다: ${(err as Error).message}`)
  }
  // 빈 문서(`null`)는 빈 layout 이다. 스칼라·배열이 최상위에 온 것은 이 파일 형식이 아니다.
  if (parsed === null || parsed === undefined) return EMPTY_LAYOUT
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new LayoutParseError('최상위가 tables·notes 를 담은 매핑이 아닙니다')
  }
  const rec = parsed as Record<string, unknown>
  return {
    tables: asArray(rec['tables']).filter(isTableLayout),
    notes: asArray(rec['notes']).filter(isNote),
  }
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const isPosition = (v: unknown): v is Position =>
  typeof v === 'object' && v !== null
  && typeof (v as Position).x === 'number' && Number.isFinite((v as Position).x)
  && typeof (v as Position).y === 'number' && Number.isFinite((v as Position).y)

/**
 * layout.yaml 은 사람이 손으로 고칠 수 있는 커밋 대상 파일이다. 좌표가 없거나 숫자가 아닌
 * 항목을 그냥 통과시키면 `position` 이 `{}` 인 테이블이 모델에 들어가 캔버스가 NaN 으로 깨진다.
 * **거른 항목은 좌표만 잃고 격자로 떨어진다** — 파일 전체를 거절하지 않는다.
 */
function isTableLayout(v: unknown): v is TableLayout {
  if (typeof v !== 'object' || v === null) return false
  const t = v as TableLayout
  if (typeof t.id !== 'string' || t.id === '') return false
  if (!isPosition(t.position)) return false
  return t.groupPosition === null || t.groupPosition === undefined || isPosition(t.groupPosition)
}

function isNote(v: unknown): v is Note {
  if (typeof v !== 'object' || v === null) return false
  const n = v as Note
  return typeof n.id === 'string' && n.id !== ''
    && typeof n.content === 'string' && typeof n.color === 'string' && isPosition(n.position)
}

export class FileStore {
  #cwd: string
  #state: StoreState = { ok: true, model: createEmptyModel(), seq: 0 }
  /** flush 가 마지막으로 디스크에 쓴 내용의 정규화 서명. */
  #written = ''
  /** 마지막 load 가 읽은 것이 그 서명과 같았는가. */
  #selfWrite = false
  /**
   * 디스크와 맞춰 둔 것으로 아는 마지막 트리·layout. `flush` 는 **이것과 달라진 것만** 쓴다
   * (`writeTreeChanges`). 성공한 load 와 성공한 flush 만 이 값을 옮긴다.
   */
  #tree: FileTree = {}
  #layout: LayoutData = EMPTY_LAYOUT

  constructor(cwd: string) {
    this.#cwd = cwd
  }

  get cwd(): string { return this.#cwd }
  get state(): StoreState { return this.#state }

  /**
   * 마지막 `load()` 가 읽은 디스크 내용이 **우리가 마지막으로 쓴 것과 같은가.**
   *
   * 감시 이벤트가 자기 쓰기인지 남의 변경인지 가르는 값이다. ⚠️ `load()` 전후의 서명을
   * 비교하는 방식으로는 판정할 수 없다 — 서명은 `flush()` 만 바꾸므로 언제나 같다.
   * **읽은 것**과 **쓴 것**을 비교해야 한다. 로드가 실패하면 언제나 `false` 다(파일이 깨진 것은
   * 자기 쓰기로 설명되지 않으므로 반드시 알려야 한다).
   */
  get isSelfWrite(): boolean { return this.#selfWrite }

  /**
   * 파일에서 모델을 다시 읽는다. **실패해도 마지막 정상 모델을 버리지 않는다** — 호출자가
   * `ok:false` 인 동안 쓰기를 막으므로, 성한 메모리 모델로 깨진 파일을 덮어쓰는 일이 생기지 않는다.
   *
   * 읽는 사이에 편집이 커밋되면 그 결과는 낡은 것이라 확정할 수 없다(`#commitLoad` 참조).
   * **그렇다고 버리기만 하면 그 로드가 들고 온 「밖의 변경」이 통째로 사라진다** — 그 사이
   * 에이전트가 만든 `erdd/tables/*.yaml` 이 메모리 모델에 영영 못 들어오고, 화면에도 안 뜬다
   * (옛 flush 는 그 파일을 지우기까지 했다 — 최종 리뷰 I-2). 그래서 **버린 뒤 다시 읽는다.**
   *
   * 다시 읽기 전에 **대기 중인 편집을 먼저 flush 한다.** 안 그러면 디바운스 때문에 아직 디스크에
   * 없는 그 편집을 「파일에 없다」로 읽어 방금 커밋된 편집을 되돌린다 — seq 가드가 막으려던 바로
   * 그 사고다. flush 가 **바뀐 파일만** 쓰므로(`writeTreeChanges`) 이 flush 가 밖에서 온 파일을
   * 건드리는 일도 없다. 그렇게 디스크가 「편집 + 밖의 변경」을 모두 담은 뒤 다시 읽으면 둘 다 산다.
   */
  async load(): Promise<StoreState> {
    for (let attempt = 1; ; attempt += 1) {
      const { state, stale } = await this.#loadOnce()
      if (!stale) return state
      // 재시도 상한. 편집이 끊임없이 들어오면(드래그) 언제까지고 겹칠 수 있다 — 그때는 지금
      // 상태를 그대로 두고 물러난다. **아무것도 지워지지 않는다**(flush 는 자기가 아는 트리와의
      // 차이만 쓴다). 이 flush 가 낸 쓰기가 다시 감시를 깨워 다음 load 가 밖의 변경을 데려온다.
      if (attempt >= MAX_LOAD_ATTEMPTS) return state
      try {
        await this.flush()
      } catch {
        // 쓰기가 막힌 상태(권한·EISDIR 등)에서 다시 읽으면 편집을 되돌린다 — 물러난다.
        // #dirty 는 참으로 남아 다음 flush 가 재시도하고, load() 는 여전히 던지지 않는다.
        return state
      }
    }
  }

  /**
   * `load()` 의 한 번 시도. 파일 IO 는 `#serialize` 체인 **밖**에서 한다(감시 콜백·서버 기동이
   * 체인 밖에서 이 메서드를 부르므로, 체인 안에서 이 메서드를 기다리는 경로를 만들면 교착된다).
   * 다만 **읽은 결과로 `#state` 를 확정하는 순간**은 `#commitLoad` 를 거쳐 체인 안에서 돈다 —
   * 그래야 이 메서드가 여러 번 `await` 로 양보하는 동안 끼어든 `mutate`/`setModel` 의 편집을
   * 덮어쓰지 않는다.
   */
  async #loadOnce(): Promise<LoadAttempt> {
    const seqAtStart = this.#state.seq
    const fail = (failures: LoadFailure[]): Promise<LoadAttempt> =>
      this.#commitLoad(seqAtStart, { ok: false, failures })

    let tree: FileTree
    try {
      tree = await readTree(this.#cwd)
    } catch (err) {
      return fail([{ path: 'erdd/', message: (err as Error).message }])
    }

    // newId 를 넘겨 **처음부터 최종 id 로** 조립한다. 나중에 리맵하면 참조 필드 하나만
    // 빠뜨려도 조용히 깨진다(file-format.ts 의 주석과 같은 이유).
    const result = filesToModel(tree, { newId: uuidv7 })
    if (!result.ok) {
      return fail(result.issues.map((i) => ({ path: i.path, message: i.message })))
    }

    const issues = validateModelIntegrity(result.model)
    if (issues.length > 0) {
      return fail(issues.map((i) => ({ path: 'erdd/', message: i.message })))
    }

    // 발급한 id 를 파일에 되쓴다. 안 쓰면 다음 로드가 또 새 id 를 발급해 같은 테이블이
    // 매번 다른 객체가 된다(CLI push 의 reserve-ids 와 같은 문제). 되쓰기가 실패했는데
    // 성공한 척 진행하면 메모리 모델은 새 id 를 갖고 디스크는 갖지 않아 다음 로드에서
    // 또 다른 id 가 발급된다 — IO 실패는 던지지 말고 fail() 로 보내 읽기 전용으로 잠근다.
    if (result.assignedTree !== undefined) {
      for (const [rel, content] of Object.entries(result.assignedTree)) {
        if (canonical(tree[rel], rel) === canonical(content, rel)) continue
        const abs = join(this.#cwd, rel)
        try {
          await mkdir(dirname(abs), { recursive: true })
          await writeFile(abs, stringifyYaml(content), 'utf8')
        } catch (err) {
          return fail([{ path: rel, message: (err as Error).message }])
        }
      }
    }

    // layout.yaml 을 읽지 못한 IO 오류(권한 없음 등)도, 파일 전체의 파싱 실패도 여기서
    // fail() 로 보낸다 — load() 는 던지지 않고 ok:false 로 알리고, 호출자가 그 동안 쓰기를
    // 막는다. **메모 본문이 이 파일에 있으므로** 깨진 채로 열어 두면 다음 flush 가 그것을
    // 지운다(readLayout 주석 참조).
    let layout: LayoutData
    try {
      layout = await readLayout(this.#cwd)
    } catch (err) {
      return fail([{ path: LAYOUT_FILE, message: (err as Error).message }])
    }
    const model = applyLayout(result.model, layout)
    return this.#commitLoad(seqAtStart, { ok: true, tree, layout, model })
  }

  /**
   * `load()` 가 읽어 온 결과를 확정한다. `mutate`/`setModel`/`flush` 와 같은 `#chain` 을 타므로,
   * `load()` 가 IO 로 양보하는 사이 끼어든 편집과 순서가 뒤섞이지 않는다.
   *
   * `seqAtStart` 는 `load()` 진입 시점의 `seq` 다 — 지금(커밋 시점) `#state.seq` 가 그것과
   * 다르면, 이 사이에 `mutate`/`setModel` 이 커밋됐다는 뜻이다. **성공** 결과는 그러면 이미 낡은
   * 것이므로 확정하지 않고 `stale` 로 알린다. 안 이러면 늦게 끝난 `load()` 가 방금 커밋된
   * 편집을 조용히 되돌리고, `#dirty` 는 참으로 남아 다음 `flush()` 가 그 되돌아간 모델을
   * 디스크에 쓴다 — 편집 한 건이 오류도 로그도 없이 증발한다. **`stale` 은 끝이 아니다** —
   * `load()` 가 편집을 flush 한 뒤 다시 읽어, 이 로드가 들고 왔던 밖의 변경도 함께 살린다.
   *
   * ⚠️ **이 seq 가드는 실패(`!outcome.ok`) 결과에는 적용하지 않는다.** 실패는 모델을 덮지 않고
   * `ok:false` + `failures` 만 세우므로(마지막 정상 모델은 그대로 `this.#state.model` 을 쓴다)
   * 경합과 무관하게 언제나 반영돼야 한다 — 안 그러면 「파일이 깨지면 쓰기를 멈추고 알린다」는
   * 안전망이 경합 창에서 조용히 사라진다(`isSelfWrite` 가 직전 `flush()` 의 `true` 를 그대로
   * 물고 있어 자기 쓰기로 오인되고, `blocked` 도 나가지 않고, 뒤이은 `flush()` 가 그 손상된
   * 파일을 메모리 모델로 덮어쓴다). `seq` 는 `seqAtStart`(진입 시점 캡처값)가 아니라
   * `this.#state.seq`(지금 값)를 쓴다 — `seqAtStart` 를 쓰면 성공 경로에서 고친 seq 되돌림이
   * 실패 경로로 되돌아온다.
   */
  #commitLoad(
    seqAtStart: number,
    outcome:
      | { ok: true; tree: FileTree; layout: LayoutData; model: ProjectModel }
      | { ok: false; failures: LoadFailure[] },
  ): Promise<LoadAttempt> {
    return this.#serialize(async () => {
      if (!outcome.ok) {
        // 깨진 파일은 자기 쓰기로 설명되지 않는다 — 반드시 알려야 하므로 언제나 false 다.
        this.#selfWrite = false
        this.#state = { ok: false, model: this.#state.model, seq: this.#state.seq, failures: outcome.failures }
        return { state: this.#state, stale: false }
      }
      if (this.#state.seq !== seqAtStart) return { state: this.#state, stale: true }
      // **읽은 것**의 서명을 **쓴 것**과 비교한다. 같으면 이 감시 이벤트는 자기 쓰기다.
      this.#selfWrite = signatureOf(outcome.tree, outcome.layout) === this.#written
      // 방금 읽은 것이 디스크의 현재 모습이다 — 다음 flush 의 비교 기준을 여기로 옮긴다.
      this.#tree = outcome.tree
      this.#layout = outcome.layout
      this.#state = { ok: true, model: outcome.model, seq: seqAtStart }
      return { state: this.#state, stale: false }
    })
  }

  #chain: Promise<unknown> = Promise.resolve()
  #timer: NodeJS.Timeout | null = null
  #dirty = false

  /** 서버의 프로젝트 행 FOR UPDATE 락에 대응하는 자리. 모든 쓰기가 이 체인을 지난다. */
  #serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(fn, fn)
    this.#chain = run.then(() => undefined, () => undefined)
    return run
  }

  async mutate(ops: Op[]): Promise<{ seq: number }> {
    return this.#serialize(async () => {
      if (!this.#state.ok) {
        throw new LocalStoreError('파일을 읽을 수 없어 편집이 잠겨 있습니다')
      }
      if (ops.length > MAX_OPS_PER_MUTATION) {
        throw new LocalStoreError(
          `변경이 ${ops.length}건으로 한 번에 반영할 수 있는 ${MAX_OPS_PER_MUTATION}건을 넘습니다`,
        )
      }
      // applyOps 는 내부에서 이미 무결성을 검사하고 위반이면 OpApplyError 를 던진다 — 여기서
      // 다시 검사하면 언제나 빈 배열만 본다(죽은 코드). LocalStoreError 로 바꿔 던져 다음 태스크의
      // 라우터가 무결성 위반을 400 으로 매핑하는 관례를 유지한다.
      let next: ProjectModel
      try {
        next = applyOps(this.#state.model, ops)
      } catch (err) {
        if (err instanceof OpApplyError) throw new LocalStoreError(err.message)
        throw err
      }
      return this.#commit(next)
    })
  }

  /** 스냅샷 복원처럼 모델을 통째로 갈아끼우는 경로. */
  async setModel(model: ProjectModel): Promise<{ seq: number }> {
    return this.#serialize(async () => {
      if (!this.#state.ok) {
        throw new LocalStoreError('파일을 읽을 수 없어 편집이 잠겨 있습니다')
      }
      const issues = validateModelIntegrity(model)
      if (issues.length > 0) throw new LocalStoreError(issues[0]!.message)
      return this.#commit(model)
    })
  }

  #commit(model: ProjectModel): { seq: number } {
    const seq = this.#state.seq + 1
    this.#state = { ok: true, model, seq }
    this.#dirty = true
    if (this.#timer !== null) clearTimeout(this.#timer)
    // 드래그 한 번이 초당 수십 건의 mutate 를 낸다 — 매번 파일을 쓰면 감시 루프와 함께 요동친다.
    // 타이머發 호출은 아무도 반환값을 보지 않으므로 실패를 삼킨다 — #dirty 는 flush() 가 실패
    // 시 참으로 남기므로 다음 편집이나 명시적 flush() 가 재시도한다.
    this.#timer = setTimeout(() => { this.flush().catch(() => {}) }, WRITE_DEBOUNCE_MS)
    return { seq }
  }

  /**
   * 대기 중인 쓰기를 지금 끝낸다. 프로세스 종료 전에 반드시 부른다.
   *
   * `#serialize` 를 지난다 — 타이머發 호출과 명시적 호출(예: 다음 태스크의 서버 종료 훅)이
   * 동시에 들어와도 `writeTree` 두 개가 겹쳐 돌지 않는다(`writeTree` 는 삭제·쓰기 패스가 나뉘어
   * 있어 원자적이지 않다). ⚠️ 체인 안에서 이 메서드를 await 하면 자기 자신을 기다려 교착된다 —
   * `mutate`/`setModel` 은 절대 `flush()` 를 부르지 않는다.
   */
  async flush(): Promise<void> {
    return this.#serialize(async () => {
      if (this.#timer !== null) { clearTimeout(this.#timer); this.#timer = null }
      if (!this.#dirty) return
      const model = this.#state.model
      // **바뀐 파일만** 쓴다(설계 §4). 매번 전체를 다시 쓰면 손으로 다듬어 둔 YAML 포맷이
      // 무관한 편집 한 번에 전부 정규화된다 — 로컬 모드는 에이전트가 파일을 직접 쓰는 것이
      // 전제라 비정규 포맷이 예외가 아니다. 삭제는 그대로 산다(#tree 에 있었는데 모델에서
      // 사라진 파일은 지워진다).
      const { tree } = modelToFiles(model)
      await writeTreeChanges(this.#cwd, this.#tree, tree)
      const layout = layoutFromModel(model)
      if (canonical(layout, LAYOUT_FILE) !== canonical(this.#layout, LAYOUT_FILE)) {
        const abs = join(this.#cwd, LAYOUT_FILE)
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, stringifyYaml(layout), 'utf8')
      }
      // 쓰기가 전부 성공한 뒤에만 dirty 를 내린다 — 실패하면 참으로 남아 다음 flush 가 재시도한다.
      this.#dirty = false
      this.#tree = tree
      this.#layout = layout
      // 다음 load 가 이 서명과 같은 것을 읽으면 그 감시 이벤트는 자기 쓰기다.
      this.#written = signatureOf(tree, layout)
      this.#selfWrite = true
    })
  }
}
