#!/usr/bin/env node
// `prepack` 가드 — 웹 번들 없이 tarball 이 나가는 것을 막는다.
//
// CI 의 publish 잡에도 같은 취지의 가드가 있지만, 그것은 **CI 안에서만** 돈다.
// 손으로 `pnpm publish` / `pnpm pack` 하면 그 가드를 통째로 우회해서 `web/` 이 빠진
// tarball 이 조용히 성공한다(리뷰에서 `총 파일: 26 | web/ 파일: 0` 으로 재현됐다).
// 그렇게 나간 패키지는 설치본에서 서버는 뜨는데 `/p/<id>` 만 404 를 내서 원인을 짚기 어렵다.
//
// `prepack` 은 `npm pack`·`pnpm pack`·`npm publish`·`pnpm publish` 가 **팩 직전에** 부르므로
// 어느 경로로 게시하든 이 검사를 지나야 한다. CI 가 `--ignore-scripts` 를 쓰지 않는 것도
// 이 훅이 거기서도 돌게 하기 위한 것이다.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const indexHtml = path.join(pkgRoot, 'web', 'index.html')

if (!existsSync(indexHtml)) {
  console.error(
    `웹 번들이 없어 팩할 수 없습니다: ${indexHtml}\n` +
    '먼저 `pnpm -C apps/web build && pnpm -C packages/cli run bundle:web` 를 실행하세요.\n' +
    '(번들 없이 게시하면 설치한 쪽에서 erdd serve 의 /p/<id> 가 404 를 냅니다.)',
  )
  process.exit(1)
}
