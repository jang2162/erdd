import { mkdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import type { FileTree } from '@erdd/core'
import { canonical } from '../tree.js'

/**
 * push가 서버로 보내기 직전에, 이번 계획이 발급한 신규 id를 로컬 파일에 박아 둔다.
 * 이것이 push 멱등성의 전부다 — 커밋 뒤 응답이 유실돼도 다음 push가 같은 id를 쓰므로
 * 서버는 "이미 있는 것"으로 보고 사본을 만들지 않는다.
 *
 * writeTree를 쓰지 않는다. 그 함수는 삭제·개명 패스를 함께 돌리는데, 여기서 파일명이
 * 정규화되면(tableFileName은 물리명으로 파일명을 정하고 충돌 시 id 뒷자리를 붙인다)
 * 사용자가 만든 파일과 갈려 같은 테이블이 두 파일에 남고, 다음 filesToModel이 id 중복
 * 으로 push 자체를 막는다. 원래 경로에 내용만 다시 쓴다.
 *
 * 반환은 실제로 기록한 상대 경로들이다(정렬됨).
 */
export async function reserveIds(
  cwd: string, local: FileTree, assigned: FileTree | undefined,
): Promise<string[]> {
  if (assigned === undefined) return []
  const written: string[] = []
  for (const [rel, content] of Object.entries(assigned)) {
    // id가 실제로 늘어난 파일만 쓴다. 매번 전부 쓰면 push할 때마다 사용자 트리가 재작성된다.
    if (canonical(local[rel]) === canonical(content)) continue
    const abs = join(cwd, rel)
    await mkdir(dirname(abs), { recursive: true })
    // 전송이 실패한 시점에 디스크에 남아 있어야 의미가 있으므로 fsync까지 한다.
    const fh = await open(abs, 'w')
    try {
      await fh.writeFile(stringifyYaml(content), 'utf8')
      await fh.sync()
    } finally {
      await fh.close()
    }
    written.push(rel)
  }
  return written.sort()
}
