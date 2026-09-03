import { gzipSync } from 'node:zlib'
import { mkdtemp, mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createEmptyModel } from '@erdd/core'
import {
  SNAPSHOTS_DIR, SNAPSHOTS_INDEX, SnapshotCorruptError,
  deleteSnapshot, listSnapshots, readSnapshot, writeSnapshot, type SnapshotRecord,
} from './snapshots.js'

const dir = () => mkdtemp(join(tmpdir(), 'erdd-snap-'))

/** uuidv7 은 앞 48비트가 타임스탬프라 **사전순 = 시간순**이다. A 가 먼저 만들어진 것이다. */
const ID_A = '018f6b0e-1111-7000-8000-000000000001'
const ID_B = '018f6b12-2222-7000-8000-000000000002'

const rec = (id: string, name: string): SnapshotRecord => ({
  id, name, description: '설명', revisionSeq: 42,
  model: createEmptyModel(), createdAt: '2026-09-03T05:25:30.000Z',
})

/** 라우터를 거치지 않아야 담을 수 있는 모양을 직접 만든다. */
async function writeRawGz(cwd: string, id: string, body: string): Promise<void> {
  await mkdir(join(cwd, SNAPSHOTS_DIR), { recursive: true })
  await writeFile(join(cwd, SNAPSHOTS_DIR, `${id}.json.gz`), gzipSync(Buffer.from(body, 'utf8')))
}

describe('snapshots', () => {
  it('쓰고 읽으면 그대로 돌아온다 — 파일 하나당 스냅샷 하나', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    expect((await readdir(join(cwd, SNAPSHOTS_DIR))).sort())
      .toEqual([`${ID_A}.json.gz`, 'index.yaml'].sort())
    const got = await readSnapshot(cwd, ID_A)
    expect(got).toMatchObject({ id: ID_A, name: '1차', description: '설명', revisionSeq: 42 })
    expect(got!.model).toEqual(createEmptyModel())
  })

  /**
   * 하나당 파일 하나로 두는 이유가 이것이다 — 새 스냅샷이 새 blob 하나만 더하고 기존 blob 을
   * 재사용한다. 단일 파일이면 만들 때마다 전체가 새 blob 이 되어 저장소가 빠르게 부푼다.
   */
  it('스냅샷을 더해도 기존 파일은 다시 쓰이지 않는다', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    const { mtimeMs } = await stat(join(cwd, SNAPSHOTS_DIR, `${ID_A}.json.gz`))
    await writeSnapshot(cwd, rec(ID_B, '2차'))
    expect((await stat(join(cwd, SNAPSHOTS_DIR, `${ID_A}.json.gz`))).mtimeMs).toBe(mtimeMs)
  })

  it('목록은 uuidv7 순서라 시간순이다', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_B, '2차'))
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    expect((await listSnapshots(cwd)).map((s) => s.name)).toEqual(['1차', '2차'])
  })

  /**
   * ⚠️ **디렉터리가 진실이고 인덱스는 라벨이다.** 어느 방향으로도 조용히 사라지지 않아야 한다 —
   * 라벨을 잃은 스냅샷도 복원·삭제할 수 있고, 파일 없는 인덱스 항목이 「있다」고 거짓말하지 않는다.
   */
  it('인덱스에 없는 파일도 목록에 뜬다(라벨만 없다)', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    await writeRawGz(cwd, ID_B, JSON.stringify(rec(ID_B, '인덱스에 없음')))

    const list = await listSnapshots(cwd)
    expect(list.map((s) => s.id)).toEqual([ID_A, ID_B])
    expect(list[1]!.name).toContain(ID_B.slice(0, 8))
    // 라벨이 없어도 복원·삭제는 된다.
    expect(await readSnapshot(cwd, ID_B)).toMatchObject({ id: ID_B })
    expect(await deleteSnapshot(cwd, ID_B)).toBe(true)
  })

  it('파일 없는 인덱스 항목은 목록에 뜨지 않는다', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    await writeFile(join(cwd, SNAPSHOTS_INDEX), [
      'snapshots:',
      `  - id: ${ID_A}`,
      '    name: 1차',
      '    description: 설명',
      '    revisionSeq: 42',
      '    createdAt: 2026-09-03T05:25:30.000Z',
      `  - id: ${ID_B}`,
      '    name: 사라진 것',
      '    description: ""',
      '    revisionSeq: 1',
      '    createdAt: 2026-09-03T05:25:30.000Z',
      '',
    ].join('\n'), 'utf8')

    expect((await listSnapshots(cwd)).map((s) => s.id)).toEqual([ID_A])
    expect(await readSnapshot(cwd, ID_B)).toBeNull()
  })

  /** 인덱스가 깨져도 목록이 통째로 죽으면 안 된다 — 라벨만 잃는다. */
  it('인덱스가 깨져도 파일 목록은 살아 있다', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    await writeFile(join(cwd, SNAPSHOTS_INDEX), ': : 깨진 YAML :', 'utf8')
    expect((await listSnapshots(cwd)).map((s) => s.id)).toEqual([ID_A])
  })

  /**
   * 🔥 **`snapshots.ts` 의 기존 방어를 새 포맷으로 이식한 것이다.** 반쪽짜리 `model` 을 그대로
   * 복원하면 「유효한 빈 모델」이 되어 무결성 검사를 통과하고, 그 뒤 저장이 사용자의 `erdd/` 를
   * 통째로 비운다. `.gz` 는 사람 눈에 내용이 안 보여 손상을 더 늦게 안다.
   *
   * ⚠️ 「없다」가 아니라 **「깨졌다」**로 알린다 — NOT_FOUND 로 뭉개면 사용자는 파일이 보이는데
   * 없다는 말을 듣고 무엇을 고쳐야 하는지 알 수 없다.
   */
  const BROKEN: [name: string, body: string][] = [
    ['model 키가 없다', JSON.stringify({ id: ID_B, name: 'x', description: '', revisionSeq: 0, createdAt: 'x' })],
    ['model 이 빈 객체다', JSON.stringify({ id: ID_B, model: {} })],
    ['필수 컬렉션이 모자란다', JSON.stringify({ id: ID_B, model: { tables: {}, columns: {} } })],
    ['JSON 이 아니다', 'not json'],
  ]

  for (const [label, body] of BROKEN) {
    it(`손상 스냅샷은 깨졌다고 던진다 — ${label}`, async () => {
      const cwd = await dir()
      await writeRawGz(cwd, ID_B, body)
      await expect(readSnapshot(cwd, ID_B)).rejects.toThrow(SnapshotCorruptError)
    })
  }

  it('gzip 이 아닌 파일도 깨진 것으로 본다', async () => {
    const cwd = await dir()
    await mkdir(join(cwd, SNAPSHOTS_DIR), { recursive: true })
    await writeFile(join(cwd, SNAPSHOTS_DIR, `${ID_B}.json.gz`), 'plain text', 'utf8')
    await expect(readSnapshot(cwd, ID_B)).rejects.toThrow(SnapshotCorruptError)
  })

  /** 손상 판정이 정상 경로를 막지 않는다는 증거. 없으면 「빈 모델 전부 거절」로 조여도 초록이다. */
  it('정당하게 비어 있는 스냅샷은 그대로 읽힌다', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '빈 상태'))
    expect((await readSnapshot(cwd, ID_A))!.model).toEqual(createEmptyModel())
  })

  /** ⚠️ 옛 스냅샷에는 나중에 생긴 컬렉션 키가 없다. 반환이 **파싱 결과**여야 보충이 살아 온다. */
  it('옛 모양(누락 컬렉션)은 보충해서 읽는다', async () => {
    const cwd = await dir()
    await writeRawGz(cwd, ID_B, JSON.stringify({
      ...rec(ID_B, '옛 것'),
      model: {
        tables: {}, columns: {}, relationships: {}, indexes: {}, notes: {},
        tableGroups: {}, domains: {},
      },
    }))
    const got = await readSnapshot(cwd, ID_B)
    expect(got!.model.words).toEqual({})
    expect(got!.model.terms).toEqual({})
    expect(got!.model.customFields).toEqual({})
  })

  it('삭제는 파일과 인덱스를 함께 지우고, 없던 것은 false 다', async () => {
    const cwd = await dir()
    await writeSnapshot(cwd, rec(ID_A, '1차'))
    expect(await deleteSnapshot(cwd, ID_A)).toBe(true)
    expect(await listSnapshots(cwd)).toEqual([])
    expect(await deleteSnapshot(cwd, ID_A)).toBe(false)
  })

  it('스냅샷이 하나도 없으면 빈 목록이다', async () => {
    expect(await listSnapshots(await dir())).toEqual([])
  })

  /**
   * 읽기-수정-쓰기가 겹치면 한쪽이 읽은 목록 위에 다른 쪽이 덮어써 **인덱스 항목 하나가 조용히
   * 사라진다.** 탭 둘이나 빠른 연속 클릭으로 충분히 만들어진다(옛 `updateSnapshots` 의 이유 그대로).
   */
  it('동시에 만든 스냅샷 두 개가 둘 다 인덱스에 남는다', async () => {
    const cwd = await dir()
    await Promise.all([
      writeSnapshot(cwd, rec(ID_A, '가')),
      writeSnapshot(cwd, rec(ID_B, '나')),
    ])
    expect((await listSnapshots(cwd)).map((s) => s.name).sort()).toEqual(['가', '나'])
  })
})
