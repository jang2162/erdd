#!/usr/bin/env node
// 저장소 루트 `docs/manual/<lang>/*.md` 를 `packages/cli/docs/<lang>/` 로 복사한다.
//
// 왜 복사가 필요한가: npm 은 **패키지 디렉터리 밖의 파일을 팩하지 않는다.** `files` 에
// `../../docs/manual/**/*.md` 를 적어도 tarball 에 들어가지 않는다. 그래서 매뉴얼을 패키지 안으로
// 한 번 옮겨 놓는다 — `web` 번들이 `bundle-web.mjs` 로 `packages/cli/web/` 에 놓이는 것과 같은 패턴이다.
//
// 왜 언어마다 넷을 다 넣는가: 문서끼리 상대 링크로 엮여 있다(`local-guide.md` 하나가 나머지 셋을 30번
// 넘게 가리킨다). 일부만 넣으면 설치본에서 깨진 링크가 된다. 언어 폴더 구조를 그대로 두고 같은 폴더에
// 넷을 나란히 두면 원본의 상대 링크가 그대로 산다 — 그래서 **링크를 고쳐 쓰지 않고 원본을 그대로 복사한다.**
//
// ⚠️ 살아나는 것은 **같은 언어 폴더 넷 사이의** 링크다. `docs/manual/` **밖**을 가리키는 링크는
// 동봉본(tarball)에서 깨진다. 그래도 절대 URL 로 바꾸지 않는다 — 저장소 안에서 매일 쓰는 클릭 이동을
// 잃고, 저장소 주소나 기본 브랜치가 바뀌면 그때 깨진다. 그런 링크는 기여자용이라 패키지를 설치한 사람이
// 볼 일이 없어 **알고 그대로 둔다.** 매뉴얼에 manual 밖을 가리키는 링크를 새로 넣으면 같은 일이 생긴다는
// 것만 알고 넣어라. 정본은 `docs/guides/release.md` 의 「매뉴얼 — `packages/cli/docs/`」 절이다.
//
// 이 디렉터리는 빌드 산출물이라 커밋하지 않는다(`.gitignore`). `prepack` 이 팩 직전에 만들므로
// CI 든 손으로 `pnpm pack` 하든 언제나 최신 매뉴얼이 들어간다.
import { existsSync } from 'node:fs'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..') // packages/cli
const srcRoot = path.resolve(pkgRoot, '../../docs/manual') // <저장소 루트>/docs/manual
const destRoot = path.join(pkgRoot, 'docs')

// 영어가 원본이고 한국어가 번역본이다. 언어를 더하면 여기에도 더한다.
const languages = ['en', 'ko']
// 넷이 서로를 상대 경로로 참조한다 — 하나라도 빠지면 동봉본의 링크가 깨진다.
const manuals = ['local-guide.md', 'cli-guide.md', 'user-guide.md', 'install.md']

// 언어 폴더마다 따로 검사한다 — 한 언어만 다 있어도 다른 언어의 동봉본은 깨지기 때문이다.
const missing = languages.flatMap((lang) =>
  manuals
    .filter((name) => !existsSync(path.join(srcRoot, lang, name)))
    .map((name) => `${lang}/${name}`),
)
if (missing.length > 0) {
  console.error(
    `동봉할 매뉴얼이 없습니다: ${missing.join(', ')} (찾은 경로: ${srcRoot})\n` +
      `저장소 루트의 docs/manual 아래 언어 폴더(${languages.join(', ')})마다 네 문서가 모두 있어야 합니다.\n` +
      '(일부만 동봉하면 설치본에서 문서끼리의 상대 링크가 깨집니다.)',
  )
  process.exit(1)
}

// 멱등하게 만든다 — 이름이 바뀌거나 지워진 옛 문서가 남아 tarball 에 유령 파일이 들어가지 않게 한다.
await rm(destRoot, { recursive: true, force: true })
for (const lang of languages) {
  const destDir = path.join(destRoot, lang)
  await mkdir(destDir, { recursive: true })
  for (const name of manuals) {
    await copyFile(path.join(srcRoot, lang, name), path.join(destDir, name))
  }
}

console.log(
  `매뉴얼 ${languages.length * manuals.length}개(${languages.join(', ')} × ${manuals.length})를 복사했습니다: ${srcRoot} → ${destRoot}`,
)
