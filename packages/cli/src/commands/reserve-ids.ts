import { mkdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import type { FileTree } from '@erdd/core'
import { CliError } from '../output.js'
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
 * 여러 파일 중 하나에서 실패하면 그때까지 쓴 것을 그대로 남기고 던진다 — 롤백하지 않는다.
 * 서버로는 아직 아무것도 나가지 않았으므로 서버 상태는 불변이고, 이미 박힌 id는 다음 push에서
 * "로컬 전용 → create"로 그 id를 실은 op가 되어 수렴한다. 지우면 오히려 그 파일이 다음 push에서
 * 다른 id를 새로 받는다.
 *
 * 쓰기 실패는 CliError('VALIDATION')로 감싸 던진다. 감싸지 않으면 원본 fs 오류가 run()의
 * catch-all에 걸려 code:"NETWORK"가 되는데, 이 CLI의 주 소비자인 에이전트는 code로 분기하므로
 * 파일 권한 문제를 전송 실패로 읽고 같은 명령을 영원히 재시도한다(권한이 그대로면 영원히
 * 실패한다). 읽기 실패를 VALIDATION으로 감싸는 tree.ts의 관례와 같은 자리다 — 파일 IO를 하는
 * 쪽이 자기 실패에 무엇을 하면 되는지를 붙인다.
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
    // local에 없는 경로는 새 파일이므로 쓴다(비교할 원본이 없다).
    if (rel in local && canonical(local[rel]) === canonical(content)) continue
    const abs = join(cwd, rel)
    try {
      await mkdir(dirname(abs), { recursive: true })
      // 전송이 실패한 시점에 파일이 디스크에 남아 있어야 의미가 있으므로 fsync까지 한다.
      // darwin의 fsync(2)는 드라이브 캐시를 flush하지 않아 전원 손실까지는 보장하지 않는다
      // (그건 F_FULLFSYNC가 필요한데 Node의 FileHandle에는 없다). 여기서 필요한 것은
      // "이 프로세스가 끝난 뒤에도 디스크에 남아 있다"뿐이고 그에는 충분하다.
      const fh = await open(abs, 'w')
      try {
        await fh.writeFile(stringifyYaml(content), 'utf8')
        await fh.sync()
      } finally {
        await fh.close()
      }
    } catch (err) {
      throw new CliError(
        'VALIDATION',
        `${rel}에 신규 id를 기록하지 못해 서버로 보내지 않았습니다. `
          + `그 파일의 경로와 쓰기 권한을 확인하고 다시 push하세요 (${(err as Error).message})`,
      )
    }
    written.push(rel)
  }
  return written.sort()
}
