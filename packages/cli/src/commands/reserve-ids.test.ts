import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { FileTree } from '@erdd/core'
import { reserveIds } from './reserve-ids.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'erdd-reserve-'))
  await mkdir(join(dir, 'erdd/tables'), { recursive: true })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

const write = (rel: string, v: unknown) => writeFile(join(dir, rel), stringifyYaml(v), 'utf8')
const raw = (rel: string) => readFile(join(dir, rel), 'utf8')
const read = async (rel: string) => parseYaml(await raw(rel)) as Record<string, unknown>

describe('reserveIds', () => {
  it('id가 늘어난 파일만 쓰고 나머지는 손대지 않는다', async () => {
    const untouchedBody = { name: 'ORD', logicalName: '주문', id: 'tb2', columns: [] }
    // 키 순서를 stringifyYaml 출력과 다르게 둔다 — 재작성되면 원문이 달라지므로 파일시스템
    // mtime 해상도에 기대지 않고 "손대지 않았다"를 잡는다.
    const untouchedRaw = 'id: tb2\nlogicalName: 주문\nname: ORD\ncolumns: []\n'
    await write('erdd/tables/MBR.yaml', { name: 'MBR', logicalName: '회원', columns: [] })
    await writeFile(join(dir, 'erdd/tables/ORD.yaml'), untouchedRaw, 'utf8')

    const local: FileTree = {
      'erdd/tables/MBR.yaml': { name: 'MBR', logicalName: '회원', columns: [] },
      'erdd/tables/ORD.yaml': untouchedBody,
    }
    const assigned: FileTree = {
      'erdd/tables/MBR.yaml': { name: 'MBR', logicalName: '회원', columns: [], id: 'tb1' },
      'erdd/tables/ORD.yaml': untouchedBody,
    }

    const written = await reserveIds(dir, local, assigned)
    expect(written).toEqual(['erdd/tables/MBR.yaml'])
    expect((await read('erdd/tables/MBR.yaml'))['id']).toBe('tb1')
    // 안 바뀐 파일은 다시 쓰지도 않는다 — 매번 전부 쓰면 사용자 트리가 push마다 흔들린다.
    expect(await raw('erdd/tables/ORD.yaml')).toBe(untouchedRaw)
  })

  it('assigned에 없는 파일은 그대로 남는다 — writeTree의 삭제 패스가 돌면 안 된다', async () => {
    const body = { name: 'MBR', logicalName: '회원', columns: [] }
    // 사용자가 만들었지만 이번 계획이 손대지 않는 파일들. writeTree로 쓰면 그 함수의 두 삭제
    // 패스가 이것들을 지운다 — 테이블 디렉터리 스캔이 KEEP.yaml을, TOP_LEVEL_FILES 정리가
    // domains.yaml을 keep에 없다고 보고 지운다.
    const keep = { name: 'KEEP', logicalName: '유지', id: 'tb7', columns: [] }
    const domains = { domains: [] }
    await write('erdd/tables/MBR.yaml', body)
    await write('erdd/tables/KEEP.yaml', keep)
    await write('erdd/domains.yaml', domains)

    const written = await reserveIds(
      dir,
      { 'erdd/tables/MBR.yaml': body, 'erdd/tables/KEEP.yaml': keep, 'erdd/domains.yaml': domains },
      { 'erdd/tables/MBR.yaml': { ...body, id: 'tb1' } },
    )

    expect(written).toEqual(['erdd/tables/MBR.yaml'])
    expect(await read('erdd/tables/KEEP.yaml')).toEqual(keep)
    expect(await read('erdd/domains.yaml')).toEqual(domains)
  })

  it('local에 없는 경로는 새 파일로 만든다 — 디렉터리가 없어도', async () => {
    await rm(join(dir, 'erdd/tables'), { recursive: true })

    const written = await reserveIds(dir, {}, {
      // 삽입 순서를 일부러 역순으로 둔다 — 반환은 정렬돼야 한다.
      'erdd/tables/ZZ.yaml': { name: 'ZZ', id: 'tb9', columns: [] },
      'erdd/tables/AA.yaml': { name: 'AA', id: 'tb8', columns: [] },
    })

    expect(written).toEqual(['erdd/tables/AA.yaml', 'erdd/tables/ZZ.yaml'])
    expect((await read('erdd/tables/ZZ.yaml'))['id']).toBe('tb9')
  })

  it('쓴 파일마다 fsync한다 — 전송이 실패해도 디스크에 남아 있어야 한다', async () => {
    const probe = await open(join(dir, 'probe'), 'w')
    const handle = Object.getPrototypeOf(probe) as { sync: () => Promise<void> }
    await probe.close()
    const sync = vi.spyOn(handle, 'sync')

    const body = { name: 'MBR', logicalName: '회원', columns: [] }
    await write('erdd/tables/MBR.yaml', body)
    await reserveIds(dir,
      { 'erdd/tables/MBR.yaml': body },
      { 'erdd/tables/MBR.yaml': { ...body, id: 'tb1' } })

    expect(sync).toHaveBeenCalledTimes(1)
  })

  it('중간에 실패해도 그때까지 쓴 것은 남기고 던진다 — 서버로 나간 것이 없으므로 안전하다', async () => {
    const aa = { name: 'AA', columns: [] }
    const zz = { name: 'ZZ', columns: [] }
    await write('erdd/tables/AA.yaml', aa)
    // ZZ 경로를 디렉터리로 만들어 두 번째 파일의 open이 EISDIR로 던지게 한다(권한·EIO 등
    // 어떤 쓰기 실패든 같다).
    await mkdir(join(dir, 'erdd/tables/ZZ.yaml'))

    await expect(reserveIds(
      dir,
      { 'erdd/tables/AA.yaml': aa, 'erdd/tables/ZZ.yaml': zz },
      { 'erdd/tables/AA.yaml': { ...aa, id: 'tb1' }, 'erdd/tables/ZZ.yaml': { ...zz, id: 'tb2' } },
    )).rejects.toThrow()

    // 롤백하지 않는다 — 이 id는 다음 push에서 create로 수렴한다.
    expect((await read('erdd/tables/AA.yaml'))['id']).toBe('tb1')
  })

  it('assigned가 없으면 아무것도 하지 않는다', async () => {
    const body = { name: 'MBR', logicalName: '회원', columns: [] }
    await write('erdd/tables/MBR.yaml', body)
    const before = await raw('erdd/tables/MBR.yaml')

    const written = await reserveIds(dir, { 'erdd/tables/MBR.yaml': body }, undefined)
    expect(written).toEqual([])
    expect(await raw('erdd/tables/MBR.yaml')).toBe(before)
  })
})
