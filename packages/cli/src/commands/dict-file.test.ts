import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDistributionFile, subscriptionPath } from './dict-file.js'

describe('subscriptionPath', () => {
  const cwd = '/work/proj'
  it('프로젝트 루트 기준 POSIX 상대 경로로 정규화한다', () => {
    expect(subscriptionPath(cwd, './vendor/../vendor/std.erdd-lib.yaml')).toBe('vendor/std.erdd-lib.yaml')
    expect(subscriptionPath(cwd, '/work/proj/lib/a.yaml')).toBe('lib/a.yaml')
  })
  it('erdd/ 안과 루트 밖을 거부한다', () => {
    expect(() => subscriptionPath(cwd, 'erdd/std.erdd-lib.yaml')).toThrow(/erdd\//)
    expect(() => subscriptionPath(cwd, '../other/std.erdd-lib.yaml')).toThrow(/프로젝트 안/)
    expect(() => subscriptionPath(cwd, '/tmp/std.erdd-lib.yaml')).toThrow(/프로젝트 안/)
  })
  it('..로 시작하는 이름의 디렉터리는 루트 밖이 아니다', () => {
    expect(subscriptionPath(cwd, '..vendor/a.yaml')).toBe('..vendor/a.yaml')
  })
})

describe('readDistributionFile', () => {
  it('배포 파일이 아니면 서버에서 내보낸 파일만 받는다고 멈춘다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-dict-file-'))
    await mkdir(join(dir, 'vendor'))
    await writeFile(join(dir, 'vendor/a.yaml'), 'format: erdd-library\nformatVersion: 1\nlibrary: { name: x }\nwords: []\n')
    await expect(readDistributionFile(dir, 'vendor/a.yaml')).rejects.toThrow(/서버에서 내보낸 파일만/)
  })
  it('없는 파일은 경로를 담아 멈춘다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'erdd-dict-file-'))
    await expect(readDistributionFile(dir, 'vendor/none.yaml')).rejects.toThrow(/vendor\/none.yaml/)
  })
})
