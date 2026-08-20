import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { uuidv7 } from 'uuidv7'
import {
  applyLayout, createEmptyModel, filesToModel, validateModelIntegrity,
  type FileTree, type LayoutData, type Note, type Position, type ProjectModel, type TableLayout,
} from '@erdd/core'
import { canonical, readTree } from '../tree.js'

export const LAYOUT_FILE = 'erdd/layout.yaml'

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
   */
  async load(): Promise<StoreState> {
    const seq = this.#state.seq
    const fail = (failures: LoadFailure[]): StoreState => {
      // 깨진 파일은 자기 쓰기로 설명되지 않는다 — 반드시 알려야 하므로 언제나 false 다.
      this.#selfWrite = false
      this.#state = { ok: false, model: this.#state.model, seq, failures }
      return this.#state
    }

    let tree
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
    // 매번 다른 객체가 된다(CLI push 의 reserve-ids 와 같은 문제).
    if (result.assignedTree !== undefined) {
      for (const [rel, content] of Object.entries(result.assignedTree)) {
        if (canonical(tree[rel], rel) === canonical(content, rel)) continue
        const abs = join(this.#cwd, rel)
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, stringifyYaml(content), 'utf8')
      }
    }

    const layout = await readLayout(this.#cwd)
    // **읽은 것**의 서명을 **쓴 것**과 비교한다. 같으면 이 감시 이벤트는 자기 쓰기다.
    this.#selfWrite = signatureOf(tree, layout) === this.#written
    const model = applyLayout(result.model, layout)
    this.#state = { ok: true, model, seq }
    return this.#state
  }
}
