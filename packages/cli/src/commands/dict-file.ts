import { readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { TREE_ROOT, formatLibraryFileIssues, parseLibraryFile, type LibraryFileDoc } from '@erdd/core'
import { CliError } from '../output.js'

/**
 * 구독에 적을 사전 파일 경로. 커밋되는 config 가 가리키므로 프로젝트 안이어야 하고(다른 체크아웃에서도
 * 같은 파일), `erdd/` 는 모델 파일 트리라 둘 수 없다.
 */
export function subscriptionPath(cwd: string, raw: string): string {
  const rel = relative(cwd, resolve(cwd, raw))
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new CliError('USAGE', `사전 파일은 프로젝트 안에 두세요: ${raw} — erdd.config.yaml 이 다른 체크아웃에서도 같은 파일을 가리켜야 합니다`)
  }
  const posix = rel.split(sep).join('/')
  if (posix === TREE_ROOT || posix.startsWith(`${TREE_ROOT}/`)) {
    throw new CliError('USAGE', `사전 파일을 ${TREE_ROOT}/ 안에 둘 수 없습니다: ${posix} — 그 디렉터리는 모델 파일 트리입니다`)
  }
  return posix
}

export async function readDistributionFile(cwd: string, path: string): Promise<LibraryFileDoc> {
  let text: string
  try {
    text = await readFile(join(cwd, path), 'utf8')
  } catch (err) {
    throw new CliError('VALIDATION', `사전 파일을 읽지 못했습니다: ${path} — ${(err as Error).message}`)
  }
  const parsed = parseLibraryFile(text, 'distribution')
  if (!parsed.ok) {
    throw new CliError('VALIDATION', [
      `${path}: 서버에서 내보낸 파일만 받을 수 있습니다(library.id·항목 id·version 필요) — 오류 ${parsed.issues.length}건`,
      ...formatLibraryFileIssues(parsed.issues).map((l) => `  ${l}`),
    ].join('\n'))
  }
  return parsed.doc
}
