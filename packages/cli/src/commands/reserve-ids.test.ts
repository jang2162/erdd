import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
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
afterEach(() => rm(dir, { recursive: true, force: true }))

const write = (rel: string, v: unknown) => writeFile(join(dir, rel), stringifyYaml(v), 'utf8')
const read = async (rel: string) => parseYaml(await readFile(join(dir, rel), 'utf8')) as Record<string, unknown>

describe('reserveIds', () => {
  it('id가 늘어난 파일만 쓰고 나머지는 손대지 않는다', async () => {
    const untouchedBody = { name: 'ORD', logicalName: '주문', id: 'tb2', columns: [] }
    await write('erdd/tables/MBR.yaml', { name: 'MBR', logicalName: '회원', columns: [] })
    await write('erdd/tables/ORD.yaml', untouchedBody)
    const mtimeBefore = (await stat(join(dir, 'erdd/tables/ORD.yaml'))).mtimeMs

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
    expect((await stat(join(dir, 'erdd/tables/ORD.yaml'))).mtimeMs).toBe(mtimeBefore)
  })

  it('assigned가 없으면 아무것도 하지 않는다', async () => {
    await write('erdd/tables/MBR.yaml', { name: 'MBR', logicalName: '회원', columns: [] })
    const mtimeBefore = (await stat(join(dir, 'erdd/tables/MBR.yaml'))).mtimeMs

    const written = await reserveIds(dir, { 'erdd/tables/MBR.yaml': {} }, undefined)
    expect(written).toEqual([])
    expect((await stat(join(dir, 'erdd/tables/MBR.yaml'))).mtimeMs).toBe(mtimeBefore)
  })
})
