#!/usr/bin/env node
// apps/web 의 빌드 산출물을 `packages/cli/web/` 로 복사한다.
//
// 왜 복사가 필요한가: 게시된 `@erdd/cli` 는 `node_modules/@erdd/cli` 안에 홀로 놓인다. 저장소에서
// 쓰던 `../../../../apps/web/dist` 는 그 배치에서 `node_modules/apps/web/dist` 라는 없는 곳을
// 가리키고, 그러면 `erdd serve` 가 정적 서빙을 등록하지 못해 `/p/<id>` 가 404 를 낸다.
// 그래서 tarball 안(`files` 의 `web`)에 번들을 통째로 동봉한다.
//
// 이 디렉터리는 빌드 산출물이라 커밋하지 않는다(`.gitignore`). 게시 직전에 이 스크립트로 만든다.
import { existsSync } from 'node:fs'
import { cp, rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pkgRoot = path.resolve(here, '..')                          // packages/cli
const src = path.resolve(pkgRoot, '../../apps/web/dist')          // <저장소 루트>/apps/web/dist
const dest = path.join(pkgRoot, 'web')

if (!existsSync(src)) {
  console.error(`\`apps/web/dist\` 가 없습니다. 먼저 \`pnpm -C apps/web build\` 를 실행하세요. (찾은 경로: ${src})`)
  process.exit(1)
}

// 멱등하게 만든다 — 지난 번들의 잔재(이름이 바뀐 해시 청크 등)가 남으면 tarball 만 커진다.
await rm(dest, { recursive: true, force: true })
await cp(src, dest, { recursive: true })

console.log(`web 번들을 복사했습니다: ${src} → ${dest}`)
