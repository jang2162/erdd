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
import { canonical, readTree, writeTree } from '../tree.js'

export const LAYOUT_FILE = 'erdd/layout.yaml'
const WRITE_DEBOUNCE_MS = 300

export class LocalStoreError extends Error {}

export type LoadFailure = { path: string; message: string }

export type StoreState =
  | { ok: true; model: ProjectModel; seq: number }
  | { ok: false; model: ProjectModel; seq: number; failures: LoadFailure[] }

const EMPTY_LAYOUT: LayoutData = { tables: [], notes: [] }

/** 자기 쓰기 판정용 정규화 서명. 키 순서·표현 차이를 지운다. */
function signatureOf(tree: FileTree, layout: LayoutData): string {
  return canonical({ ...tree, [LAYOUT_FILE]: layout }, LAYOUT_FILE) ?? ''
}

/** layout.yaml 은 스키마 파일이 아니다 — 깨져 있으면 배치만 잃고 모델은 연다. */
async function readLayout(cwd: string): Promise<LayoutData> {
  let raw: string
  try {
    raw = await readFile(join(cwd, LAYOUT_FILE), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_LAYOUT
    throw err
  }
  try {
    const parsed: unknown = parseYaml(raw)
    if (typeof parsed !== 'object' || parsed === null) return EMPTY_LAYOUT
    const rec = parsed as Record<string, unknown>
    return {
      tables: asArray(rec['tables']).filter(isTableLayout),
      notes: asArray(rec['notes']).filter(isNote),
    }
  } catch {
    return EMPTY_LAYOUT
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
   * 파일 IO 는 `#serialize` 체인 **밖**에서 한다(감시 콜백·서버 기동이 체인 밖에서 이 메서드를
   * 부르므로, 체인 안에서 이 메서드를 기다리는 경로를 만들면 교착된다). 다만 **읽은 결과로
   * `#state` 를 확정하는 순간**은 `#commitLoad` 를 거쳐 체인 안에서 돈다 — 그래야 이 메서드가
   * 여러 번 `await` 로 양보하는 동안 끼어든 `mutate`/`setModel` 의 편집을 덮어쓰지 않는다.
   */
  async load(): Promise<StoreState> {
    const seqAtStart = this.#state.seq
    const fail = (failures: LoadFailure[]): Promise<StoreState> =>
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

    // layout.yaml 을 읽지 못한 IO 오류(권한 없음 등)도 load() 를 던지게 두면 안 된다 —
    // 파싱 실패(깨진 YAML)와 달리 이건 fail() 로 보낸다. 파싱 실패는 readLayout 내부에서
    // 이미 좌표만 잃고 넘어가므로 여기 닿지 않는다.
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
   * 다르면, 이 사이에 `mutate`/`setModel` 이 커밋됐다는 뜻이다. 그러면 지금 든 결과는 이미 낡은
   * 것이므로 버리고 **현재 상태를 그대로** 돌려준다. 안 이러면 늦게 끝난 `load()` 가 방금 커밋된
   * 편집을 조용히 되돌리고, `#dirty` 는 참으로 남아 다음 `flush()` 가 그 되돌아간 모델을
   * 디스크에 쓴다 — 편집 한 건이 오류도 로그도 없이 증발한다.
   */
  #commitLoad(
    seqAtStart: number,
    outcome:
      | { ok: true; tree: FileTree; layout: LayoutData; model: ProjectModel }
      | { ok: false; failures: LoadFailure[] },
  ): Promise<StoreState> {
    return this.#serialize(async () => {
      if (this.#state.seq !== seqAtStart) return this.#state
      if (!outcome.ok) {
        // 깨진 파일은 자기 쓰기로 설명되지 않는다 — 반드시 알려야 하므로 언제나 false 다.
        this.#selfWrite = false
        this.#state = { ok: false, model: this.#state.model, seq: seqAtStart, failures: outcome.failures }
        return this.#state
      }
      // **읽은 것**의 서명을 **쓴 것**과 비교한다. 같으면 이 감시 이벤트는 자기 쓰기다.
      this.#selfWrite = signatureOf(outcome.tree, outcome.layout) === this.#written
      this.#state = { ok: true, model: outcome.model, seq: seqAtStart }
      return this.#state
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
      const { tree } = modelToFiles(model)
      await writeTree(this.#cwd, tree)
      const layout = layoutFromModel(model)
      const abs = join(this.#cwd, LAYOUT_FILE)
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, stringifyYaml(layout), 'utf8')
      // 쓰기가 전부 성공한 뒤에만 dirty 를 내린다 — 실패하면 참으로 남아 다음 flush 가 재시도한다.
      this.#dirty = false
      // 다음 load 가 이 서명과 같은 것을 읽으면 그 감시 이벤트는 자기 쓰기다.
      this.#written = signatureOf(tree, layout)
      this.#selfWrite = true
    })
  }
}
