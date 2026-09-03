import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEmptyModel } from '@erdd/core'
import { DRAFT_FILE, hasDraft, readDraft, removeDraft, writeDraft, type Draft } from './draft.js'

const dir = () => mkdtemp(join(tmpdir(), 'erdd-draft-'))

const draftOf = (over: Partial<Draft> = {}): Draft => ({
  formatVersion: 1,
  baseSignature: 'sig-1',
  seq: 7,
  updatedAt: '2026-09-03T05:25:30.000Z',
  model: createEmptyModel(),
  ...over,
})

/** 라우터를 거치지 않아야 담을 수 있는 모양을 직접 만든다. */
async function writeRaw(cwd: string, body: string): Promise<void> {
  await mkdir(join(cwd, '.erdd'), { recursive: true })
  await writeFile(join(cwd, DRAFT_FILE), body, 'utf8')
}

describe('draft', () => {
  it('없으면 none 이고 hasDraft 는 false 다', async () => {
    const cwd = await dir()
    expect(await readDraft(cwd)).toEqual({ kind: 'none' })
    expect(await hasDraft(cwd)).toBe(false)
  })

  it('쓰고 읽으면 그대로 돌아온다', async () => {
    const cwd = await dir()
    await writeDraft(cwd, draftOf())
    expect(await hasDraft(cwd)).toBe(true)
    const r = await readDraft(cwd)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.draft.baseSignature).toBe('sig-1')
    expect(r.draft.seq).toBe(7)
    expect(r.draft.model).toEqual(createEmptyModel())
  })

  it('임시 파일을 남기지 않는다 — .erdd 에는 draft.json 하나만 남는다', async () => {
    const cwd = await dir()
    await writeDraft(cwd, draftOf())
    await writeDraft(cwd, draftOf({ seq: 8 }))
    expect(await readdir(join(cwd, '.erdd'))).toEqual(['draft.json'])
  })

  /**
   * 🔥 **이 사이클에서 가장 중요한 방어다.** 반쪽짜리 `model` 을 그대로 얹으면
   * `{ ...createEmptyModel(), ...model }` 정규화가 「유효한 빈 모델」을 만들고, 그것은 무결성
   * 검사에 걸릴 것이 없어 통과한 뒤 **다음 저장이 사용자의 `erdd/` 를 통째로 비운다.**
   * `snapshots.ts` 의 `snapshotModel` 이 막는 것과 같은 사고이고 **더 나쁘다** — 스냅샷은
   * 사용자가 복원을 눌러야 닿지만 드래프트는 기동 시 자동으로 얹힌다.
   *
   * ⚠️ **손상 드래프트를 지우지 않는다.** 사용자의 미저장 작업이 든 유일한 사본일 수 있다.
   */
  const BROKEN: [name: string, body: string][] = [
    ['JSON 이 잘렸다', '{"formatVersion":1,"model":{'],
    ['model 키가 없다', JSON.stringify({ formatVersion: 1, baseSignature: 's', seq: 1, updatedAt: 'x' })],
    ['model 이 빈 객체다', JSON.stringify({ formatVersion: 1, baseSignature: 's', seq: 1, updatedAt: 'x', model: {} })],
    ['필수 컬렉션이 모자란다', JSON.stringify({ formatVersion: 1, baseSignature: 's', seq: 1, updatedAt: 'x', model: { tables: {}, columns: {} } })],
    ['최상위가 배열이다', '[]'],
  ]

  for (const [label, body] of BROKEN) {
    it(`손상 드래프트는 corrupt 로 알리고 지우지 않는다 — ${label}`, async () => {
      const cwd = await dir()
      await writeRaw(cwd, body)
      const r = await readDraft(cwd)
      expect(r.kind).toBe('corrupt')
      if (r.kind !== 'corrupt') return
      // 원본 내용이 백업 파일에 그대로 살아 있다.
      expect(await readFile(r.backupPath, 'utf8')).toBe(body)
      // 격리했으므로 다음 기동은 드래프트가 없는 상태로 깨끗하게 시작한다.
      expect(await hasDraft(cwd)).toBe(false)
    })
  }

  /**
   * ⚠️ 손상 판정이 **정상 경로를 막지 않는다**는 증거다. 이것이 없으면 위 잠금은
   * 「빈 모델을 전부 거절」로 과하게 조여도 초록으로 남는다.
   */
  it('정당하게 비어 있는 모델은 통과한다', async () => {
    const cwd = await dir()
    await writeDraft(cwd, draftOf({ model: createEmptyModel() }))
    expect((await readDraft(cwd)).kind).toBe('ok')
  })

  /**
   * ⚠️ 옛 드래프트에는 나중에 생긴 컬렉션 키가 없을 수 있다. 반환값이 원본이 아니라 **파싱
   * 결과**여야 그 보충이 살아 온다(`snapshots.ts` 와 같은 이유).
   */
  it('신규 컬렉션 키가 없는 옛 모양도 보충해서 읽는다', async () => {
    const cwd = await dir()
    await writeRaw(cwd, JSON.stringify({
      formatVersion: 1, baseSignature: 's', seq: 1, updatedAt: 'x',
      model: {
        tables: {}, columns: {}, relationships: {}, indexes: {}, notes: {},
        tableGroups: {}, domains: {},
      },
    }))
    const r = await readDraft(cwd)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    expect(r.draft.model.words).toEqual({})
    expect(r.draft.model.terms).toEqual({})
    expect(r.draft.model.customFields).toEqual({})
  })

  it('removeDraft 는 없어도 던지지 않는다', async () => {
    const cwd = await dir()
    await expect(removeDraft(cwd)).resolves.toBeUndefined()
    await writeDraft(cwd, draftOf())
    await removeDraft(cwd)
    expect(await hasDraft(cwd)).toBe(false)
  })
})
