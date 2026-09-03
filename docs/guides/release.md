# 릴리스 — 사내 레지스트리에 CLI 패키지를 게시한다

게시 대상은 **사내 GitLab(`gitlab.develma.com`) 패키지 레지스트리의 프로젝트 엔드포인트**(Project ID 45)다.
**공개 npm 에는 올리지 않는다.**

배포 형태는 **원본 TypeScript 그대로**다(빌드 산출물이 아니다 — 소비처에 `tsx` 가 필요하다).
`apps/web` 의 빌드 산출물을 `packages/cli/web/` 로 복사해 **tarball 에 동봉**한다. 그래야 설치본에서도
`erdd serve` 가 화면을 낸다. **문서도 함께 동봉된다** — 패키지 루트의 `README.md` 와
`docs/manual/*.md` 네 편이다. 두 패키지 모두 `engines.node: ">=22"` 를 선언한다.

---

## 절차

```bash
# 1) 버전을 올린다
#    packages/cli/package.json  의 "version"  — 항상
#    packages/core/package.json 의 "version"  — packages/core 를 고쳤으면 반드시(아래 가드가 죽인다)

# 2) 커밋하고 태그를 push 한다. 파이프라인은 이 태그에서만 돈다
git tag cli-v0.1.0 && git push origin cli-v0.1.0
```

`.gitlab-ci.yml` 의 `workflow.rules` 가 `cli-v<SemVer>` 태그에만 파이프라인을 만든다 —
**브랜치 push·MR 로는 아무것도 돌지 않는다**(이 저장소의 유일한 CI 다).

`verify` → `publish` 두 단계다. `verify` 가 `pnpm install --frozen-lockfile` · `pnpm -r typecheck` ·
**core·cli·web 테스트** · `apps/web build` · `pnpm -C packages/cli run bundle:web` 을 돌려
`packages/cli/web/` 를 artifact 로 넘긴다. `publish` 는 그것을 그대로 받아 게시한다 —
**재빌드하지 않는다**(검증한 것과 게시하는 것이 같아야 한다).

⚠️ **`pnpm -C apps/web test` 는 빼지 마라.** 그 빌드 산출물이 그대로 tarball 의 `web/` 이 되어
소비처에서 서빙된다 — **게시물의 대부분이 web 이다.** 그 줄이 없으면 어떤 테스트도 거치지 않은 것이
게시되는 경로가 열린다. `build` 앞에 둔 것도 의도다(깨졌으면 빌드에 시간을 쓰기 전에 죽는다).

⚠️ **`apps/server` 테스트는 이 파이프라인이 돌리지 않는다** — 실제 PostgreSQL 이 필요한데 CI 에
DB 서비스가 없다. 게시 대상도 아니다.

---

## 게시를 막는 가드 다섯

| 가드 | 어디서 | 무엇을 막나 |
|---|---|---|
| 태그 버전 == `packages/cli/package.json` 의 `version` | CI publish | 태그만 올리고 매니페스트를 잊는 것. 그대로 나가면 레지스트리에 태그와 다른 버전이 올라간다 |
| 패키지 이름이 `@erdd/` 스코프 | CI publish | `.npmrc` 는 `@erdd:` 에만 레지스트리·토큰을 매단다. 스코프를 벗어나면 그 설정이 통째로 안 먹어 **공개 npm 으로 나갈 수 있다** |
| `packages/cli/web/index.html` 존재 | CI publish | 번들 없는 게시. 설치한 쪽에서 서버는 뜨는데 `/p/<id>` 만 404 를 내는, 원인을 짚기 어려운 상태가 된다 |
| **core 버전 누락** | CI publish | 「새 cli + 옛 core」가 조용히 나가는 것. 아래 절 |
| **`prepack`**(`check-web-bundle.mjs` → `bundle-docs.mjs`) | pack·publish 어디서나 | 웹 번들 없이 팩하는 것. CI 가드와 겹치지만 **CI 밖의 손 게시까지** 덮는다. CI 가 `--ignore-scripts` 를 쓰지 않는 것이 이 훅을 거기서도 돌게 하려는 것이다 |

### core 를 고쳤으면 `packages/core/package.json` 의 `version` 을 반드시 올려라

publish 잡은 `npm view "@erdd/core@<버전>"` 으로 「이미 있으면 건너뛴다」를 한다(cli 만 고친
릴리스에서 409 로 죽지 않게 하려는 의도된 동작이다). **건너뛰기 직전에 직전 `cli-v*` 태그와 이번
태그를 비교한다.** 조건은 **둘이 모두** 참일 때다.

```bash
[ "$PREV_CORE_VERSION" = "$CORE_VERSION" ] && ! git diff --quiet "$PREV_TAG" "$CI_COMMIT_TAG" -- packages/core
```

즉 **직전 태그의 core `version` 이 지금과 같은데 `packages/core` 파일이 바뀐 경우**만 잡고
이렇게 죽는다.

```
packages/core 가 cli-v0.1.1 이후 바뀌었는데 version(0.1.0)이 그대로입니다.
packages/core/package.json 의 version 을 올리고 태그를 다시 미세요.
```

⚠️ **version 비교가 조건에 들어가는 이유 — 없으면 릴리스가 영구히 막힌다.** 「파일이 바뀌었나」만
보면 core 를 고치고 **version 도 올바로 올린** 릴리스에서 오탐한다. 실제로 걸리는 상황은
**publish 잡 재시도**다 — 첫 실행이 `@erdd/core` 게시까지 성공하고 그다음 cli 게시에서 죽으면
(레지스트리 순간 오류·네트워크) 재시도에서는 core 가 이미 레지스트리에 있으므로 건너뛰기 분기로
들어가고, 거기서 파일 변경만 보는 가드가 발동해 **그 태그로는 다시는 성공할 수 없게 된다.**

이 판정에는 **알고 쓰는 실패 모드**가 있다.

| 상황 | 어느 쪽으로 기우나 |
|---|---|
| 직전 태그를 못 찾는다(첫 태그·얕은 클론) | **통과.** 첫 태그에서는 core 도 미게시라 애초에 게시 분기로 가서 이 검사에 닿지 않고, 얕은 클론은 publish 잡의 `GIT_DEPTH: "0"` 으로 없앴다 |
| 직전 태그의 `packages/core/package.json` 을 못 읽는다 | **통과.** `PREV_CORE_VERSION` 이 빈 문자열이 되어 version 비교가 어긋난다 — 못 읽는 것은 「버전을 안 올렸다」의 증거가 전혀 아니라, 거짓 실패로 릴리스를 막는 쪽이 더 나쁘다고 보고 고른 방향이다 |
| `git diff` 자체가 실패한다(객체 없음 등) | **실패.** 다만 version 비교를 먼저 통과해야 하므로 **버전이 그대로일 때만** 그렇다 |

---

## 손 게시(CI 밖)

번들이 없으면 `prepack` 이 종료 코드 `1` 로 막는다. 먼저 이 둘을 돌려라.

```bash
pnpm -C apps/web build && pnpm -C packages/cli run bundle:web
```

⚠️ **`publishConfig.registry` 를 매니페스트에 두지 않는다.** 그룹 엔드포인트는 읽기 전용이라 게시가
거절된다(형제 저장소가 그 사고를 겪었다). 레지스트리는 잡 안에서 만드는 `.npmrc` 로만 지정한다.
저장소 루트의 `.npmrc` 는 **로컬 `pnpm publish` 가 기본값인 공개 npm 을 향하지 않게** 못 박는 것이고,
**토큰은 거기 적지 않는다**(머신마다 한 번
`pnpm config set "//gitlab.develma.com/:_authToken" "<토큰>"`).

## 소비처 설치

사용자 매뉴얼과 같은 내용이다. 머신마다 한 번
`pnpm config set "//gitlab.develma.com/:_authToken" "<토큰>"`, 프로젝트 `.npmrc` 에
`@erdd:registry=https://gitlab.develma.com/api/v4/projects/45/packages/npm/`, 그다음
`pnpm add -D @erdd/cli tsx`.

⚠️ **`tsx` 를 함께 적는 것을 빼지 마라.** `@erdd/cli` 는 `tsx` 를 끌어오지 않고, 패키지 관리자가
무엇이든 소비처가 직접 선언해야 한다. **`dependencies` 에 넣어 대신 해결하려는 시도는 하지 마라** —
선언이 `npx` 에게 「이미 설치됨」으로 오판을 시키는데 pnpm 은 그 bin 을 어떤 `.bin` 에도 링크하지 않아
되던 것이 `sh: tsx: command not found`(127) 가 된다. 근본 해결은 셰방을 바꾸는 것이다
(→ 「알려진 한계」).

---

## 번들되는 것

### 웹 번들 — `packages/cli/web/`

⚠️ **커밋하지 않는다**(gitignore). 로컬에서 저장소 배치로 `erdd serve` 를 쓰던 사람은
`pnpm -C apps/web build` 만 하면 된다.

**후보 순서는 저장소 우선이다** — `webDistCandidates` 가 `apps/web/dist` 를 먼저 보고 없을 때만
`<패키지 루트>/web` 으로 떨어진다. 게시 준비로 `bundle:web` 을 돌려 복사본이 남아 있어도
**로컬 `serve` 는 계속 최신 빌드를 본다.** `packages/cli/web/` 은 gitignore 라 `git clean -fd` 로도
안 지워져서, 반대 순서였을 때 그 잔재가 최신 빌드를 가리는 함정이 실제로 재현됐다.
설치본에서 저장소 후보가 잡히는 일은 없다 — `<소비처>/node_modules/apps/web/dist` 로 풀려
`node_modules` 안이라 구조적으로 성립하지 않는다.

### 매뉴얼 — `packages/cli/docs/`

`packages/cli/README.md` 는 저장소에 커밋돼 있고 npm 이 `files` 와 무관하게 자동 동봉한다
(GitLab 패키지 레지스트리 페이지도 그것을 렌더한다). 매뉴얼은 다르다 — **npm 은 패키지 디렉터리
밖의 파일을 팩하지 않아서** `files` 에 `../../docs/manual/*.md` 를 적어도 들어가지 않는다.
그래서 `packages/cli/scripts/bundle-docs.mjs` 가 `docs/manual/` 의 **네 편 전부**
(`local-guide`·`cli-guide`·`user-guide`·`install`)를 `packages/cli/docs/` 로 복사하고
`prepack` 이 `check-web-bundle.mjs` 다음에 그것을 돌린다. **매뉴얼 원본이 하나라도 없으면
거기서 종료 코드 `1` 이다.**

- **`packages/cli/docs/` 는 커밋하지 않는다**(gitignore). 빌드 산출물이라 거기 있는 파일을 고쳐도
  다음 팩에서 덮어써진다 — **원본인 `docs/manual/` 을 고친다.**
- **넷을 다 넣는 것이 요점이다.** 문서끼리 상대 링크로 엮여 있어 일부만 넣으면 설치본에서 깨진
  링크가 된다. 같은 디렉터리에 나란히 두면 원본 링크가 그대로 살아서 **링크를 고쳐 쓸 필요가 없다** —
  `bundle-docs.mjs` 는 내용을 손대지 않고 복사만 한다.
- **`web` 과 달리 CI artifact 로 넘기지 않는다.** 빌드가 필요 없는 단순 복사라 `prepack` 에서 하면
  CI 든 손으로 `pnpm pack` 하든 항상 최신 매뉴얼이 들어간다. 그래서 `.gitlab-ci.yml` 에는 문서 관련
  단계가 없다 — **넣지 마라.** prepack 이 어느 경로에서도 도는 것이 이 설계의 요점이다.
- 동봉 문서를 가리키는 상대 링크(`./docs/local-guide.md`)가 `README.md` 에 있다. **저장소에서는
  그 경로가 비어 있는 것이 정상이다**(팩할 때 생긴다).
- ⚠️ **살아나는 것은 「매뉴얼 넷 사이」의 링크다.** `docs/manual/` **밖**을 가리키는 링크는
  동봉본에서 열리지 않는다 — 팩된 tarball 에서 그런 링크는 깨진다. **알고 그대로 두었다**:
  기여자용·저장소 내부 문서라 패키지를 설치한 사람이 볼 일이 없고, 절대 URL 로 바꾸면 저장소 안에서
  매일 쓰는 클릭 이동을 잃는 데다 사내 GitLab 주소가 바뀌면 그때 깨진다.
  **매뉴얼 넷에 manual 밖을 가리키는 링크를 새로 넣으면 같은 방식으로 깨진다** — 넣을 거면 알고 넣어라.

---

## 알려진 한계

- **소비처가 `tsx` 를 직접 설치해야 한다.** `bin` 셰방을 `#!/usr/bin/env node` + 얇은 `.mjs` 런처로
  바꾸고 런타임에서 tsx 를 로드하면 그 선언이 필요 없어진다. **방법은 실증됐다** —
  `createRequire(realpathSync(런처 경로))` 로 pnpm 심볼릭을 실경로로 풀면 `tsx` 가 해석된다.
  ⚠️ **이것이 유일한 근본 해결책이다** — `dependencies` 선언만으로는 **pnpm 에서 오히려 회귀한다**
  (실측해서 되돌렸다). 비용은 진입점 교체와 두 배치(pnpm 격리·npm 평면)·전역 설치·
  `npx @erdd/cli` 재검증, 그리고 `tsx/esm/api` 라는 프로그램적 API 에 묶이는 것이다.
- **`npm view` 의 401/403 을 「없음」으로 읽는다.** core 게시 판정이 인증 오류·네트워크 오류를
  「미게시」로 보고 게시를 시도한다. 그때는 409 로 시끄럽게 죽으므로 조용히 잘못되지는 않는다.
  GitLab Packages API 조회로 바꾸는 편이 낫다.
- **게시본에 죽은 항목이 남는다.** tarball 의 `package.json` 에 `scripts.bundle:web`·
  `scripts.bundle:docs` 가 남는데 `scripts/` 는 동봉되지 않는다. `devDependencies` 의
  `@erdd/server` 버전도 어느 레지스트리에도 없다. 둘 다 소비처에 실질 피해는 없다.
- **`image: node:22` 가 떠 있는 태그다.** 재현 가능한 파이프라인을 원하면 digest 나 `node:22.x.y` 로
  고정한다.
- **태그 정규식이 빌드 메타데이터를 잡지 않는다.** `cli-v0.1.0+build.1` 형태는 파이프라인을 만들지
  않는다. 의도라면 그대로 둬도 된다.
- **`erdd --version` 이 없다.** 게시되는 CLI 인데 버전을 물을 방법이 없다(`--version` 은
  `알 수 없는 명령` 이다).
- **Linux 에서 `erdd serve` 의 파일 감시가 조용히 죽는다.** `fs.watch(dir, { recursive: true })` 는
  Linux 에서 퍼미션 `0o000` 인 디렉터리에도 **던지지 않고 `'error'` 이벤트도 내지 않는다** —
  같은 디렉터리에 **비재귀** watch 는 EACCES 로 던지고 `readdirSync` 도 EACCES 다(재귀만 다르다).
  `watchProject` 는 항상 재귀부터 걸므로 catch 분기에 닿지 못해 **경고조차 남지 않고**, 권한을
  되돌려도 그 감시는 되살아나지 않는다. 새로고침하면 보이므로 치명적이지는 않다.
  **제품 코드를 일부러 고치지 않았다** — 감지하려면 등록 뒤 접근 가능 여부를 따로 확인해야 한다.
  이 때문에 `packages/cli/src/local/watch.test.ts` 의 「감시 등록이 그 밖의 이유로 실패해도 던지지
  않는다」는 **macOS 에서만 검증력이 있어** `skipIf` 에 플랫폼을 함께 뒀다(CI 를 비-root 로 돌려야
  드러난다 — root 일 때는 그 `skipIf` 에 걸려 보이지 않는다).
- **러너 환경에 의존하는 것들은 파이프라인이 실제로 돌 때만 확인된다.** `corepack` 활성화가 사내
  러너의 네트워크 정책을 타는 것(막히면 `COREPACK_NPM_REGISTRY` 로 사내 미러를 가리킨다 —
  `npm i -g pnpm` 은 **같은 네트워크를 타므로 대안이 아니다**), `GIT_DEPTH: "0"` 이 실제로 전체
  히스토리를 받는지, `git describe --match 'cli-v*'` 가 detached HEAD 태그 체크아웃에서 같게 도는지,
  `pnpm -C apps/web test` 가 러너에서 타임아웃 없이 끝나는지가 그것이다.
