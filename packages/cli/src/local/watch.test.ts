import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { watchProject } from './watch.js'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
})
