import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { watch } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { watchProject } from './watch.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// erdd/ 재귀 감시가 플랫폼에서 막히는 경우(Linux 구버전 등)는 이 워크트리(darwin)에서
// 실제로 재현할 수 없다 — recursive:true 는 여기서 지원된다. 그래서 fs.watch 자체는
// 실제 파일시스템으로 위임하되, 첫 호출(=erdd/ 재귀 감시 시도)만 mockImplementationOnce
// 로 가로채 ERR_FEATURE_UNAVAILABLE_ON_PLATFORM 을 던지게 해서 폴백 분기를 실제로 태운다.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, watch: vi.fn(actual.watch) }
})

const mockWatch = vi.mocked(watch)

afterEach(() => {
  // 호출 이력만 지운다 — 기본 구현(실제 watch 로 위임)은 유지해야 다음 테스트가 정상 동작한다.
  mockWatch.mockClear()
})

describe('watchProject', () => {
  it('erdd/ 안의 파일 변경을 알린다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    await mkdir(join(dir, 'erdd/tables'), { recursive: true })
    let hits = 0
    const w = watchProject(dir, () => { hits += 1 }, { debounceMs: 20 })
    try {
      await sleep(50)
      await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'name: MBR\n', 'utf8')
      await sleep(200)
      expect(hits).toBeGreaterThanOrEqual(1)
    } finally { w.close() }
  })

  it('연속 변경을 한 번으로 뭉친다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    await mkdir(join(dir, 'erdd/tables'), { recursive: true })
    let hits = 0
    const w = watchProject(dir, () => { hits += 1 }, { debounceMs: 80 })
    try {
      await sleep(50)
      for (let i = 0; i < 5; i++) {
        await writeFile(join(dir, `erdd/tables/T${i}.yaml`), `name: T${i}\n`, 'utf8')
      }
      await sleep(300)
      expect(hits).toBe(1)
    } finally { w.close() }
  })

  it('erdd.config.yaml 변경도 알린다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    await mkdir(join(dir, 'erdd'), { recursive: true })
    await writeFile(join(dir, 'erdd.config.yaml'), 'dialects: [postgresql]\n', 'utf8')
    let hits = 0
    const w = watchProject(dir, () => { hits += 1 }, { debounceMs: 20 })
    try {
      await sleep(50)
      await writeFile(join(dir, 'erdd.config.yaml'), 'dialects: [oracle]\n', 'utf8')
      await sleep(200)
      expect(hits).toBeGreaterThanOrEqual(1)
    } finally { w.close() }
  })

  it('erdd/ 가 없어도 던지지 않는다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    const w = watchProject(dir, () => {}, { debounceMs: 20 })
    w.close()
  })

  it('close 뒤에는 알리지 않는다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    await mkdir(join(dir, 'erdd/tables'), { recursive: true })
    // macOS FSEvents 는 재귀 감시자를 만들기 직전(수~십수 ms 이내)에 일어난 디렉터리 생성을
    // "이력" 이벤트로 뒤늦게 배달할 때가 있다 — mkdir 바로 뒤에 watchProject 를 부르면 그
    // mkdir 자체가 close() 전에 onChange 를 한 번 울려 이 테스트(닫힌 뒤의 무시)가 흔들린다
    // (실측: 지연 없이 10/10 재현, 이 지연을 두면 0/10). 검사 대상과 무관한 잡음이므로 없앤다.
    await sleep(50)
    let hits = 0
    const w = watchProject(dir, () => { hits += 1 }, { debounceMs: 20 })
    await sleep(50)
    w.close()
    await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'name: MBR\n', 'utf8')
    await sleep(200)
    expect(hits).toBe(0)
  })

  // root 로 도는 환경(CI 컨테이너 등)은 권한 검사를 우회해 EACCES 가 나지 않는다.
  it.skipIf(process.getuid?.() === 0)('감시 등록이 그 밖의 이유로 실패해도 던지지 않는다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    const target = join(dir, 'erdd')
    await mkdir(target, { recursive: true })
    await chmod(target, 0o000)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      let w: ReturnType<typeof watchProject> | undefined
      expect(() => {
        w = watchProject(dir, () => {}, { debounceMs: 20 })
      }).not.toThrow()
      w?.close()
      // 경고를 실제로 남겼는지까지 확인해 이 테스트가 catch 분기를 정말로 탔음을 보장한다.
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
      await chmod(target, 0o700)
    }
  })

  it('재귀 감시가 플랫폼에서 막히면 erdd/ 와 erdd/tables/ 를 비재귀로 감시한다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    await mkdir(join(dir, 'erdd/tables'), { recursive: true })
    const unsupported = Object.assign(
      new Error('recursive watch unsupported'),
      { code: 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM' },
    )
    // 첫 호출(=erdd/ 재귀 시도)만 실패시키고 나머지는 실제 fs.watch 로 위임한다.
    mockWatch.mockImplementationOnce(() => { throw unsupported })
    let hits = 0
    const w = watchProject(dir, () => { hits += 1 }, { debounceMs: 20 })
    try {
      const paths = mockWatch.mock.calls.map(([p]) => p)
      expect(paths).toContain(join(dir, 'erdd'))
      expect(paths).toContain(join(dir, 'erdd/tables'))

      await sleep(50)
      await writeFile(join(dir, 'erdd/tables/MBR.yaml'), 'name: MBR\n', 'utf8')
      await sleep(200)
      expect(hits).toBeGreaterThanOrEqual(1)
    } finally { w.close() }
  })

  it('FSWatcher 오류가 나도 프로세스가 죽지 않는다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-watch-'))
    await mkdir(join(dir, 'erdd/tables'), { recursive: true })
    const w = watchProject(dir, () => {}, { debounceMs: 20 })
    try {
      // erdd/ 를 감시하는 실제 FSWatcher 를 잡아 비동기 오류를 흉내낸다. 리스너가 없는
      // EventEmitter 에 'error' 를 emit 하면 Node 가 그 자리에서 다시 던진다 — 'error'
      // 리스너가 붙어 있어야 여기서 던지지 않는다.
      const rawWatcher = mockWatch.mock.results[0]?.value
      expect(() => rawWatcher.emit('error', new Error('EMFILE 흉내'))).not.toThrow()
    } finally { w.close() }
  })
})
