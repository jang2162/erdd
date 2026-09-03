import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { uuidv7 } from 'uuidv7'
import {
  MAX_OPS_PER_MUTATION,
  applyLayout, applyOps, createEmptyModel, filesToModel, layoutFromModel, modelToFiles,
  OpApplyError, validateModelIntegrity,
  type FileTree, type LayoutData, type LocalSaveResult, type Note, type Op, type Position,
  type ProjectModel,
  type TableLayout,
} from '@erdd/core'
import { canonical, readTree, writeTreeChanges } from '../tree.js'
import { readDraft, removeDraft, writeDraft, type Draft } from './draft.js'

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

/** 저장·재읽기가 같은 문구를 쓴다 — 사용자가 배너와 토스트에서 같은 말을 봐야 한다. */
const EXTERNAL_MESSAGE = '파일이 밖에서 바뀌었습니다 — 내 편집을 유지할지 파일을 다시 읽을지 고르세요'

/**
 * 겹친 편집 때문에 확정하지 못한 로드를 몇 번까지 다시 읽을지. 한 번이면 대개 충분하다
 * (다시 읽을 때는 편집이 이미 커밋·flush 돼 있다). 상한이 있어야 편집이 쉼 없이 들어오는
 * 동안 무한히 도는 일이 없다.
 */
const MAX_LOAD_ATTEMPTS = 4

/** `#loadOnce` 의 결과. `stale` 이면 겹친 편집 때문에 확정하지 못했다는 뜻이다. */
type LoadAttempt = { state: StoreState; stale: boolean }

/** 정규화 서명. 키 순서·표현 차이를 지운다. */
function signatureOf(tree: FileTree, layout: LayoutData): string {
  return canonical({ ...tree, [LAYOUT_FILE]: layout }, LAYOUT_FILE) ?? ''
}

/**
 * 모델을 **저장했을 때 나올 파일**의 서명. `#dirty` 판정의 양쪽이 모두 이 함수를 지나야 한다 —
 * 한쪽만 정규화하면 손으로 다듬은 YAML 이나 `layout.yaml` 이 없는 프로젝트가 열자마자 「미저장」이
 * 된다(`FileStore.#base` 주석 참조).
 */
function modelSignatureOf(model: ProjectModel): string {
  return signatureOf(modelToFiles(model).tree, layoutFromModel(model))
}

/** 성공한 로드 결과에서 기준선 조각을 만든다. */
function baseOf(outcome: { tree: FileTree; layout: LayoutData; model: ProjectModel }) {
  return {
    tree: outcome.tree,
    layout: outcome.layout,
    modelSignature: modelSignatureOf(outcome.model),
  }
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
  /**
   * 마지막으로 **채택했거나 사용자가 인정한** 디스크 상태. 두 가지 일을 한다.
   * 1. **저장의 비교 기준** — `save()` 가 `writeTreeChanges(cwd, #base.tree, next)` 로 쓴다.
   * 2. **외부 변경 감지의 기준** — 읽어 온 서명이 이것과 다르면 밖에서 바뀐 것이다.
   *
   * 옛 `#written`/`#selfWrite`/`#tree`/`#layout` 이 여기로 합쳐졌다. 옛 자기 쓰기 판정은
   * 「방금 읽은 것 == 내가 마지막으로 쓴 것」이었는데, 드래프트 이후에는 「방금 읽은 것 == 내가
   * 아는 파일 상태」가 **자기 쓰기 거르기와 외부 변경 감지를 동시에** 한다. 비교식은 그대로다 —
   * `load()` 전후의 서명을 비교하는 방식으로는 판정할 수 없다는 옛 주석의 이유도 그대로다
   * (그 서명은 우리가 쓸 때만 움직이므로 언제나 같다).
   *
   * ⚠️ `signature` 의 초깃값 `''` 는 **어떤 실제 서명과도 같을 수 없다**(`canonical` 은 객체에
   * 대해 언제나 문자열을 낸다). 그래서 첫 `load()` 는 언제나 채택한다.
   *
   * ⚠️ **서명이 둘인 이유가 있다 — 하나로 합치지 마라.**
   * - `signature`: 디스크에서 **읽은 그대로**의 서명. 「밖에서 바뀌었는가」를 잰다.
   * - `modelSignature`: 그 디스크 상태가 낸 **모델**을 다시 파일로 만든 것의 서명.
   *   「저장할 것이 남았는가」(`#dirty`)를 잰다.
   *
   * 둘은 정상적으로 다르다. `erdd pull` 로 받아 온 프로젝트에는 `layout.yaml` 이 없어서
   * `layoutFromModel` 이 격자 좌표를 새로 만들어 내고, 사람이 손으로 다듬은 YAML 은 포맷이
   * `modelToFiles` 출력과 어긋난다. **원본 바이트로 `#dirty` 를 재면 아무것도 편집하지 않은
   * 프로젝트가 열자마자 「미저장」이 된다** — 그리고 그것은 「연다고 저장소가 더러워지지 않는다」는
   * 이 사이클의 목적과 정면으로 어긋난다. `#dirty` 는 **모델이 디스크의 모델과 다른가**이다.
   */
  #base: { tree: FileTree; layout: LayoutData; signature: string; modelSignature: string } =
    { tree: {}, layout: EMPTY_LAYOUT, signature: '', modelSignature: '' }

  /**
   * 디스크가 `#base` 와 달라졌는데 **사용자가 아직 고르지 않았다**(설계 D2 — 자동 병합 없음).
   *
   * 밖에서 온 내용을 들고 있지 않고 **플래그 하나**다 — 들고 있으면 그 사이 디스크가 또 바뀌었을
   * 때 낡은 것을 `#base` 로 승격시켜 다음 저장이 그 두 번째 변경을 말없이 덮는다. `keep`·
   * `discard` 가 그 시점에 디스크를 다시 읽으므로 스스로 교정된다.
   */
  #external = false

  /** 아직 얹지 못한 드래프트(첫 `load()` 가 실패했을 때). 로드가 성공하는 순간 얹는다. */
  #pendingDraft: Draft | null = null

  /**
   * 미저장 여부가 **바뀔 때** 부른다. 서버가 SSE `status` 를 내보내는 자리다.
   *
   * 편집마다 부르지 않고 **전이에서만** 부른다 — 드래그 한 번이 초당 수십 건의 mutate 를 내는데
   * 그때마다 내보내면 SSE 가 요동친다. `flush()` 가 디바운스된 자리라 여기가 자연스럽다.
   */
  #onStatusChange: (() => void) | null = null

  onStatusChange(fn: () => void): void { this.#onStatusChange = fn }

  constructor(cwd: string) {
    this.#cwd = cwd
  }

  get cwd(): string { return this.#cwd }
  get state(): StoreState { return this.#state }

  /**
   * **저장할 것**이 남았는가. 플래그가 아니라 **내용 비교 결과**다(`flush()` 가 갱신한다) —
   * 되돌리는 편집(A→B→A)에서 `#draftPending` 은 참이고 이것은 거짓이다. 합치면 「미저장」
   * 표시가 거짓말을 하고 저장 버튼이 쓸 것 없는 저장을 하게 된다.
   */
  get dirty(): boolean { return this.#dirty }

  /** 디스크가 밖에서 바뀌었는데 사용자가 아직 「유지/다시 읽기」를 고르지 않았는가. */
  get external(): boolean { return this.#external }

  /**
   * 지금 아는 디스크 상태의 서명. **이 값이 움직였다 = 디스크 내용을 실제로 채택했다.**
   *
   * 서버가 「브라우저에 reload 를 보낼까」를 판정하는 근거다. 메모리 모델의 변화로 판정하면
   * **내 편집도 「바뀌었다」가 되어** 자기 편집을 되돌려 받아 드래그가 튄다.
   */
  get baseSignature(): string { return this.#base.signature }

  /**
   * 파일에서 모델을 다시 읽는다. **실패해도 마지막 정상 모델을 버리지 않는다** — 호출자가
   * `ok:false` 인 동안 쓰기를 막으므로, 성한 메모리 모델로 깨진 파일을 덮어쓰는 일이 생기지 않는다.
   *
   * 읽는 사이에 편집이 커밋되면 그 결과는 낡은 것이라 확정할 수 없다(`#commitLoad` 참조).
   * **그렇다고 버리기만 하면 그 로드가 들고 온 「밖의 변경」이 통째로 사라진다** — 그 사이
   * 에이전트가 만든 `erdd/tables/*.yaml` 이 메모리 모델에 영영 못 들어오고, 화면에도 안 뜬다.
   * 그래서 **버린 뒤 다시 읽는다.**
   *
   * 겹친 편집을 만나면 **그냥 다시 읽는다.** 옛 구현은 다시 읽기 전에 대기 중인 편집을 먼저
   * flush 했는데, 그것은 디스크가 메모리 모델의 유일한 보관처였기 때문이다(디바운스 대기 중인
   * 편집을 「파일에 없다」로 읽어 되돌리는 사고를 막던 자리). **드래프트 이후에는 읽기가 미저장
   * 편집을 건드릴 수 없으므로** 그 flush 가 필요 없다.
   */
  async load(): Promise<StoreState> {
    for (let attempt = 1; ; attempt += 1) {
      const { state, stale } = await this.#loadOnce()
      if (!stale) return state
      // 재시도 상한. 편집이 끊임없이 들어오면(드래그) 언제까지고 겹칠 수 있다.
      // ⚠️ **그때 결과를 버리지 않고 `#external` 을 세운다.** 옛 구현은 버려도 「자기 flush 가
      // 다시 감시를 깨운다」가 회수해 줬는데, 편집이 더 이상 `erdd/` 를 쓰지 않으므로 그 회수
      // 경로가 사라졌다 — 버리면 이 로드가 들고 온 밖의 변경 알림이 통째로 증발한다. 편집이
      // 쉼 없이 들어오는 중이면 어차피 곧 미저장이므로 「미저장 + 외부 변경」과 같은 처리다.
      if (attempt >= MAX_LOAD_ATTEMPTS) {
        this.#external = true
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
          // ⚠️ **되쓴 것을 tree 에 반영해야 한다.** 안 하면 `#base` 가 디스크보다 뒤처져, 이
          // 쓰기가 깨운 다음 감시가 「밖에서 바뀌었다」로 판정해 **거짓 충돌 배너**를 띄운다.
          // 옛 코드에서는 `#written` 이 `modelToFiles` 결과라 우연히 가려져 있던 갈래다.
          tree[rel] = content
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
   * 안전망이 경합 창에서 조용히 사라진다(`blocked` 가 나가지 않아 편집이 계속 열려 있고, 뒤이은
   * `save()` 가 그 손상된 파일을 메모리 모델로 덮어쓴다). `seq` 는 `seqAtStart`(진입 시점 캡처값)가 아니라
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
        this.#state = { ok: false, model: this.#state.model, seq: this.#state.seq, failures: outcome.failures }
        return { state: this.#state, stale: false }
      }
      if (this.#state.seq !== seqAtStart) return { state: this.#state, stale: true }

      const signature = signatureOf(outcome.tree, outcome.layout)
      const changed = signature !== this.#base.signature
      const unsaved = this.#dirty || this.#draftPending

      if (changed && unsaved) {
        // 미저장 편집이 있는데 밖이 바뀌었다 — **채택하지 않고** 사용자가 고르게 한다
        // (설계 D2, 자동 병합 없음). 모델도 기준선도 그대로 두고 플래그만 세운다.
        this.#external = true
      } else if (changed) {
        // 미저장이 없으니 디스크가 진실이다 — 모델과 기준선을 함께 옮긴다.
        this.#base = { ...baseOf(outcome), signature }
      }

      // ⚠️ **`changed` 가 거짓이어도 여기까지 와야 한다.** 깨졌던 파일이 **원래 내용 그대로**
      // 복구되면 서명이 기준선과 같은데, 조기 반환하면 `ok:false` 가 영영 풀리지 않는다.
      // 미저장 편집이 있으면 메모리 모델(=드래프트)을 지키고, 없으면 디스크 모델을 쓴다.
      this.#state = unsaved
        ? { ok: true, model: this.#state.model, seq: this.#state.seq }
        : { ok: true, model: outcome.model, seq: seqAtStart }
      this.#tryAdoptPending()
      return { state: this.#state, stale: false }
    })
  }

  #chain: Promise<unknown> = Promise.resolve()
  #timer: NodeJS.Timeout | null = null
  /** 드래프트 **파일에 쓸 것**이 남았는가(디바운스 플래그). 옛 `#dirty` 의 역할이다. */
  #draftPending = false
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
    this.#draftPending = true
    if (this.#timer !== null) clearTimeout(this.#timer)
    // 드래그 한 번이 초당 수십 건의 mutate 를 낸다 — 매번 드래프트를 쓰면 디스크가 요동친다.
    // 타이머發 호출은 아무도 반환값을 보지 않으므로 실패를 삼킨다 — #draftPending 은 flush() 가
    // 실패 시 참으로 남기므로 다음 편집이나 명시적 flush() 가 재시도한다.
    this.#timer = setTimeout(() => { this.flush().catch(() => {}) }, WRITE_DEBOUNCE_MS)
    return { seq }
  }

  /**
   * 대기 중인 **드래프트** 쓰기를 지금 끝낸다. 프로세스 종료 전에 반드시 부른다.
   *
   * 옛 구현은 여기서 `erdd/` 에 썼다 — **그 대상이 `.erdd/draft.json` 으로 바뀐 것이 이 사이클의
   * 전부다.** 사용자의 편집이 파일에 닿는 것은 `save()` 뿐이다.
   *
   * `#dirty` 를 여기서 **다시 계산한다.** 내용 비교 비용(`modelToFiles` 한 번)이 드는 유일한
   * 자리이고 디바운스돼 있으므로, 드래그 프레임마다 계산하지 않는다.
   *
   * `#serialize` 를 지난다 — 타이머發 호출과 명시적 호출(서버 종료 훅)이 겹쳐 돌지 않는다.
   * ⚠️ 체인 안에서 이 메서드를 await 하면 자기 자신을 기다려 교착된다 — `mutate`/`setModel` 은
   * 절대 `flush()` 를 부르지 않는다.
   */
  async flush(): Promise<void> {
    return this.#serialize(async () => {
      if (this.#timer !== null) { clearTimeout(this.#timer); this.#timer = null }
      if (!this.#draftPending) return
      const model = this.#state.model
      const dirty = modelSignatureOf(model) !== this.#base.modelSignature
      if (dirty) {
        await writeDraft(this.#cwd, {
          formatVersion: 1,
          baseSignature: this.#base.signature,
          seq: this.#state.seq,
          updatedAt: new Date().toISOString(),
          model,
        })
      } else {
        // 편집이 원래 내용으로 되돌아왔다 — 남겨 둘 드래프트가 없다.
        await removeDraft(this.#cwd)
      }
      // 쓰기가 성공한 뒤에만 내린다 — 실패하면 참으로 남아 다음 flush 가 재시도한다.
      this.#draftPending = false
      const changed = this.#dirty !== dirty
      this.#dirty = dirty
      if (changed) this.#onStatusChange?.()
    })
  }

  /**
   * 드래프트를 파일에 확정한다. **사용자의 편집이 파일에 닿는 유일한 자리다**(신규 id 되쓰기 제외).
   *
   * 🔥 **②의 재읽기가 이 설계의 안전 계약이다.** 감시(150ms 디바운스)가 늦어 배너가 아직 안 떴어도,
   * 저장 직전에 디스크를 다시 읽어 기준선과 다르면 거절한다 — 사용자가 **보지 못한** 외부 변경을
   * 구조적으로 덮지 않는다.
   *
   * 전부 `#serialize` 안에서 한다 — 재읽기와 쓰기 사이에 `mutate` 가 끼어들면 방금 잰 디스크와
   * 다른 모델을 쓰게 된다.
   */
  async save(): Promise<LocalSaveResult> {
    return this.#serialize(async () => {
      if (this.#timer !== null) { clearTimeout(this.#timer); this.#timer = null }
      if (!this.#state.ok) {
        return { ok: false, reason: 'blocked', message: '파일을 읽을 수 없어 저장이 잠겨 있습니다' }
      }
      if (this.#external) {
        return { ok: false, reason: 'external', message: EXTERNAL_MESSAGE }
      }
      // 저장할 것이 없으면 **아무것도 쓰지 않는다.** 열었다 닫는 것만으로 `layout.yaml` 이
      // 생기면 「연다고 저장소가 더러워지지 않는다」가 깨진다(`#base` 주석의 두 서명 참조).
      if (!this.#dirty && !this.#draftPending) {
        return { ok: true, seq: this.#state.seq, written: [], deleted: [] }
      }

      let disk: { tree: FileTree; layout: LayoutData }
      try {
        disk = { tree: await readTree(this.#cwd), layout: await readLayout(this.#cwd) }
      } catch (err) {
        return { ok: false, reason: 'blocked', message: (err as Error).message }
      }
      if (signatureOf(disk.tree, disk.layout) !== this.#base.signature) {
        this.#external = true
        return { ok: false, reason: 'external', message: EXTERNAL_MESSAGE }
      }

      const model = this.#state.model
      // **바뀐 파일만** 쓴다. 매번 전체를 다시 쓰면 손으로 다듬어 둔 YAML 포맷이 무관한 편집
      // 한 번에 전부 정규화된다 — 로컬 모드는 사람·에이전트가 파일을 직접 쓰는 것이 전제라
      // 비정규 포맷이 예외가 아니다. 삭제는 그대로 산다.
      const { tree } = modelToFiles(model)
      const layout = layoutFromModel(model)
      const { written, deleted } = await writeTreeChanges(this.#cwd, this.#base.tree, tree)
      if (canonical(layout, LAYOUT_FILE) !== canonical(this.#base.layout, LAYOUT_FILE)) {
        const abs = join(this.#cwd, LAYOUT_FILE)
        await mkdir(dirname(abs), { recursive: true })
        await writeFile(abs, stringifyYaml(layout), 'utf8')
        written.push(LAYOUT_FILE)
      }

      this.#base = {
        tree, layout, signature: signatureOf(tree, layout), modelSignature: modelSignatureOf(model),
      }
      this.#draftPending = false
      this.#dirty = false
      await removeDraft(this.#cwd)
      return { ok: true, seq: this.#state.seq, written: written.sort(), deleted }
    })
  }

  /**
   * 미저장 편집을 버리고 디스크를 채택한다. 「파일 다시 읽기」의 자리다.
   *
   * 플래그를 **먼저** 내리고 `load()` 를 부르는 순서가 중요하다 — 미저장으로 남은 채 부르면
   * `#commitLoad` 가 「미저장 있음」으로 보고 채택하지 않는다.
   */
  async discard(): Promise<void> {
    await this.#serialize(async () => {
      if (this.#timer !== null) { clearTimeout(this.#timer); this.#timer = null }
      this.#draftPending = false
      this.#dirty = false
      this.#external = false
      this.#pendingDraft = null
      await removeDraft(this.#cwd)
      // 기준선을 비워 다음 load() 가 반드시 채택하게 한다 — 디스크가 기준선과 같아도 모델을
      // 되돌려야 하기 때문이다(편집은 메모리에만 있었다).
      this.#base = { ...this.#base, signature: '', modelSignature: '' }
    })
    await this.load()
  }

  /**
   * 밖의 변경을 인정하되 **내 편집을 유지한다.** 기준선을 지금 디스크로 옮기므로, 이어지는 저장은
   * 화면이 곧 파일이 된다 — 밖에서 추가된 파일도 지워진다(설계 §13 ①, 사용자 확정).
   *
   * `#external` 이 값을 들고 있지 않고 **여기서 디스크를 다시 읽는다** — 그 사이 디스크가 또
   * 바뀌었을 수 있고, 그때 낡은 값을 기준선으로 승격시키면 다음 저장이 그 두 번째 변경을 말없이
   * 덮는다.
   */
  async keep(): Promise<void> {
    return this.#serialize(async () => {
      let tree: FileTree
      let layout: LayoutData
      try {
        tree = await readTree(this.#cwd)
        layout = await readLayout(this.#cwd)
      } catch {
        // 디스크를 못 읽으면 인정할 것이 없다 — 다음 load() 가 blocked 로 알린다.
        return
      }
      const result = filesToModel(tree, { newId: uuidv7 })
      if (!result.ok) return
      this.#base = {
        tree,
        layout,
        signature: signatureOf(tree, layout),
        modelSignature: modelSignatureOf(applyLayout(result.model, layout)),
      }
      this.#external = false
      // 기준선이 움직였으므로 「저장할 것이 남았는가」를 다시 계산해야 한다.
      this.#draftPending = true
    })
  }

  /**
   * 기동 시 1회. 드래프트가 있으면 얹어 「미저장 변경 있음」 상태로 연다.
   *
   * **첫 `load()` 가 성공했을 때만 얹는다** — 실패했으면 얹을 기준선(`#base`)이 없어 판정할
   * 근거가 없고, 어차피 편집이 잠겨 있다. 그때는 들고 있다가 파일이 고쳐져 로드가 성공하는
   * 순간 얹는다(`#tryAdoptPending`).
   *
   * 손상 드래프트는 `readDraft` 가 이미 격리했다 — 여기서는 조용히 넘어간다(파일만 열린다).
   */
  async adoptDraft(): Promise<void> {
    const read = await readDraft(this.#cwd)
    if (read.kind !== 'ok') return
    await this.#serialize(async () => {
      if (!this.#state.ok) { this.#pendingDraft = read.draft; return }
      this.#applyDraft(read.draft)
    })
  }

  /** 로드가 성공한 순간 밀린 드래프트를 얹는다. 이미 `#serialize` 안이다. */
  #tryAdoptPending(): void {
    const draft = this.#pendingDraft
    if (draft === null) return
    this.#pendingDraft = null
    this.#applyDraft(draft)
  }

  #applyDraft(draft: Draft): void {
    if (modelSignatureOf(draft.model) === this.#base.modelSignature) {
      // 드래프트 내용이 파일과 같다 — 얹을 것도 알릴 것도 없다. 파일 삭제는 다음 flush 가 한다.
      this.#draftPending = true
      return
    }
    this.#dirty = true
    this.#state = { ok: true, model: draft.model, seq: Math.max(this.#state.seq, draft.seq) }
    // `serve` 가 꺼진 사이 파일이 바뀌었으면(git pull·checkout) 사용자가 알아야 한다 — 조용히
    // 얹으면 브랜치가 바뀐 줄 모른 채 저장해 남의 변경을 덮는다.
    if (draft.baseSignature !== this.#base.signature) this.#external = true
  }
}
