import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

export type Watcher = { close: () => void }

const DEFAULT_DEBOUNCE_MS = 150

/**
 * `erdd/`(재귀)와 `erdd.config.yaml` 을 본다.
 *
 * `fs.watch` 는 한 번의 저장을 플랫폼에 따라 여러 이벤트로 낸다(macOS 는 rename + change).
 * 디바운스로 뭉쳐 한 번만 알린다.
 *
 * **자기 쓰기를 걸러내는 것은 호출자의 일이다** — 저장소의 마지막 쓰기 서명과 지금 디스크
 * 상태를 비교해 정한다. 여기서 하면 감시 모듈이 저장소 내부를 알아야 해서 경계가 흐려진다.
 */
export function watchProject(
  cwd: string,
  onChange: () => void,
  opts: { debounceMs?: number } = {},
): Watcher {
  const debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS
  const watchers: FSWatcher[] = []
  let timer: NodeJS.Timeout | null = null
  let closed = false

  const fire = () => {
    if (closed) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; if (!closed) onChange() }, debounceMs)
  }

  /**
   * 감시는 편의 기능이다 — 등록이 실패해도 `serve` 기동을 막지 않는다. 실패해도 브라우저가
   * 외부 변경을 자동으로 못 받을 뿐이고 새로고침으로 해결되며, 그게 에디터가 아예 안 열리는
   * 것보다 훨씬 낫다. `ENOENT`(아직 없는 경로)는 조용히 넘기고, 그 밖의 실패는 콘솔 경고만
   * 남기고 삼킨다. 반환하는 에러 코드는 호출부가 재귀 미지원 폴백이나 「나중에 생기면 등록」을
   * 이어갈지 판단하는 데만 쓴다.
   *
   * `'error'` 리스너도 같은 이유로 단다 — 등록 뒤 비동기로 나는 오류(EMFILE, 감시 중
   * 권한 변경 등)를 그대로 두면 리스너 없는 EventEmitter 특성상 uncaught exception 으로
   * 프로세스 전체가 죽는다.
   */
  const add = (path: string, recursive: boolean, onFire: () => void = fire): FSWatcher | string => {
    try {
      const w = watch(path, { recursive, persistent: false }, onFire)
      w.on('error', (err) => {
        console.warn(`[watchProject] ${path} 감시 중 오류가 나 이 감시를 접습니다:`, err)
        w.close()
      })
      watchers.push(w)
      return w
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') {
        console.warn(`[watchProject] ${path} 감시를 시작하지 못했습니다:`, err)
      }
      return code ?? 'UNKNOWN'
    }
  }

  /**
   * erdd/ 를 등록한다. 재귀 감시가 플랫폼 미지원(ERR_FEATURE_UNAVAILABLE_ON_PLATFORM)으로
   * 막히면 erdd/ 와 erdd/tables/ 를 각각 비재귀로 감시하는 것으로 폴백한다 — 파일 포맷이 이
   * 두 층으로 끝나므로(최상위 *.yaml + tables/*.yaml) 커버리지는 동일하다. erdd/ 가 아직
   * 없으면(ENOENT) 등록하지 못했다고 알린다 — 호출부가 나중에 다시 시도한다.
   */
  const addErdd = (): boolean => {
    const result = add(join(cwd, 'erdd'), true)
    if (result === 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
      add(join(cwd, 'erdd'), false)
      add(join(cwd, 'erdd/tables'), false)
      return true
    }
    return typeof result !== 'string'
  }

  let rootWatcher: FSWatcher | undefined

  if (addErdd()) {
    add(join(cwd, 'erdd.config.yaml'), false)
  } else {
    // erdd/ 가 아직 없다(`init --local` 직후 첫 `serve` 등) — 나중에 생겨도 놓치지 않도록
    // 프로젝트 루트를 비재귀로 감시해 두고, 그 안에 erdd/ 항목이 나타나는 순간 재시도한다.
    // 루트에는 erdd.config.yaml 도 있으니 등록 전까지는 이 감시가 그 변경도 함께 잡아 준다.
    // 등록에 성공하면 이 루트 감시는 닫고 평소처럼 config 파일만 본다 — 무관한 루트 항목
    // 변경으로 계속 깨어나지 않도록.
    const result = add(cwd, false, () => {
      if (closed) return
      if (addErdd()) {
        if (rootWatcher !== undefined) {
          rootWatcher.close()
          const idx = watchers.indexOf(rootWatcher)
          if (idx !== -1) watchers.splice(idx, 1)
          rootWatcher = undefined
        }
        add(join(cwd, 'erdd.config.yaml'), false)
      }
      fire()
    })
    if (typeof result !== 'string') rootWatcher = result
  }

  return {
    close: () => {
      closed = true
      if (timer !== null) { clearTimeout(timer); timer = null }
      for (const w of watchers) w.close()
    },
  }
}
