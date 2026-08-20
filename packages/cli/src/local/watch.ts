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

  const add = (path: string, recursive: boolean) => {
    try {
      // ENOENT 는 정상이다 — erdd/ 가 아직 없는 새 프로젝트에서 serve 할 수 있다.
      watchers.push(watch(path, { recursive, persistent: false }, fire))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  add(join(cwd, 'erdd'), true)
  add(join(cwd, 'erdd.config.yaml'), false)

  return {
    close: () => {
      closed = true
      if (timer !== null) { clearTimeout(timer); timer = null }
      for (const w of watchers) w.close()
    },
  }
}
