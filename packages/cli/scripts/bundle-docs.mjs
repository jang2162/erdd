#!/usr/bin/env node
// 저장소 루트 `docs/manual/*.md` 를 `packages/cli/docs/` 로 복사한다.
//
// 왜 복사가 필요한가: npm 은 **패키지 디렉터리 밖의 파일을 팩하지 않는다.** `files` 에
// `../../docs/manual/*.md` 를 적어도 tarball 에 들어가지 않는다. 그래서 매뉴얼을 패키지 안으로
// 한 번 옮겨 놓는다 — `web` 번들이 `bundle-web.mjs` 로 `packages/cli/web/` 에 놓이는 것과 같은 패턴이다.
//
// 왜 넷을 다 넣는가: 문서끼리 상대 링크로 엮여 있다(`local-guide.md` 하나가 나머지 셋을 30번 넘게
// 가리킨다). 일부만 넣으면 설치본에서 깨진 링크가 된다. 같은 디렉터리에 넷을 나란히 두면 원본의
// 상대 링크가 그대로 산다 — 그래서 **링크를 고쳐 쓰지 않고 원본을 그대로 복사한다.**
//
// ⚠️ 살아나는 것은 **넷 사이의** 링크다. `docs/manual/` **밖**을 가리키는 링크는 동봉본에서 열리지
// 않는다 — 지금은 `install.md` 의 둘(`../superpowers/HANDOFF.md` · `../18-account.md`)뿐이고, 둘 다
// 기여자용·저장소 내부 문서라 설치한 사람이 볼 일이 없어 **의도적으로 그대로 둔다.** 절대 URL 로
// 바꾸면 저장소 안의 클릭 이동을 잃고 사내 GitLab 주소가 바뀔 때 깨진다. 매뉴얼에 manual 밖을
// 가리키는 링크를 새로 넣으면 여기서도 같은 일이 생긴다는 것만 알고 쓰면 된다.
//
// 이 디렉터리는 빌드 산출물이라 커밋하지 않는다(`.gitignore`). `prepack` 이 팩 직전에 만들므로
// CI 든 손으로 `pnpm pack` 하든 언제나 최신 매뉴얼이 들어간다.
import { existsSync } from 'node:fs'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')                          // packages/cli
const srcDir = path.resolve(pkgRoot, '../../docs/manual')         // <저장소 루트>/docs/manual
const destDir = path.join(pkgRoot, 'docs')

// 넷이 서로를 상대 경로로 참조한다 — 하나라도 빠지면 동봉본의 링크가 깨진다.
const manuals = ['local-guide.md', 'cli-guide.md', 'user-guide.md', 'install.md']

const missing = manuals.filter((name) => !existsSync(path.join(srcDir, name)))
if (missing.length > 0) {
  console.error(
    `동봉할 매뉴얼이 없습니다: ${missing.join(', ')} (찾은 경로: ${srcDir})\n` +
    '저장소 루트의 docs/manual 아래에 네 문서가 모두 있어야 합니다.\n' +
    '(일부만 동봉하면 설치본에서 문서끼리의 상대 링크가 깨집니다.)',
  )
  process.exit(1)
}

// 멱등하게 만든다 — 이름이 바뀌거나 지워진 옛 문서가 남아 tarball 에 유령 파일이 들어가지 않게 한다.
await rm(destDir, { recursive: true, force: true })
await mkdir(destDir, { recursive: true })
for (const name of manuals) {
  await copyFile(path.join(srcDir, name), path.join(destDir, name))
}

console.log(`매뉴얼 ${manuals.length}개를 복사했습니다: ${srcDir} → ${destDir}`)
