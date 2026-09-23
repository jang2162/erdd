# 릴리스 — 공개 npm 에 CLI 패키지를 게시한다

게시 대상은 **공개 npm(registry.npmjs.org)** 이고 패키지는 `@erdd/core`·`@erdd/cli` 둘이다.
게시는 GitHub Actions 의 `.github/workflows/release.yml` 이 하고, 인증은 **npm trusted publishing(OIDC)**,
게시본에는 **provenance** 가 붙는다. 예외는 **새 패키지의 첫 버전** 하나다 — 로컬에서 손으로 올리고
그 버전에는 provenance 가 없다(→ 「첫 게시 — 패키지가 아직 없을 때」).

배포 형태는 **원본 TypeScript 그대로**다(빌드 산출물이 아니다 — 소비처에 `tsx` 가 필요하다).
`apps/web` 의 빌드 산출물을 `packages/cli/web/` 로 복사해 **tarball 에 동봉**한다. 그래야 설치본에서도
`erdd serve` 가 화면을 낸다. **문서도 함께 동봉된다** — 패키지 루트의 `README.md`·`LICENSE` 와
`docs/manual/*.md` 네 편이다. 두 패키지 모두 `engines.node: ">=22"` 를 선언한다.

---

## 절차

```bash
# 1) 버전을 올린다
#    packages/cli/package.json  의 "version"  — 항상
#    packages/core/package.json 의 "version"  — packages/core 를 고쳤으면 반드시(아래 가드가 죽인다)

# 2) 커밋하고 태그를 GitHub 원격에 push 한다. 게시 파이프라인은 이 태그에서만 돈다
git tag cli-v0.1.0 && git push <GitHub 원격> cli-v0.1.0
```

⚠️ **태그는 GitHub 원격(`jang2162/erdd`)에 민다.** 게시는 GitHub Actions 가 하므로 다른 원격(옛 저장소
미러 등)에 밀면 아무것도 돌지 않는다 — 오류도 없이 게시가 시작되지 않는다. 체크아웃마다 원격 이름이
다르니 `git remote -v` 로 GitHub 을 가리키는 이름을 확인하고 쓴다.

⚠️ **게시할 태그는 혼자 push 한다 — 다른 태그와 한 번에 밀지 마라.** GitHub 은 한 번의 push 에 태그가
셋을 넘으면 태그 이벤트를 만들지 않는다(GitHub Docs 「Events that trigger workflows」 의 `push` 절).
`git push --tags` 로 밀린 태그를 한꺼번에 올리거나 옛 태그 묶음에 새 태그를 섞으면 **새 태그의 게시도
시작되지 않는다** — 실패한 실행이 남지 않아 Actions 화면에서도 조용하다. 저장소에 없는 옛 태그를 올려야
하면 그 묶음을 먼저 따로 밀고(이벤트가 생기지 않는 것이 정상이다) 게시할 태그는 그 뒤에 혼자 민다.

`release.yml` 은 `cli-v<SemVer>` 태그 push 에서만 뜬다. GitHub 의 태그 필터는 정규식이 아니라 글롭이라
`cli-v[0-9]+.[0-9]+.[0-9]+` 와 그 뒤 `-*` 을 넓게 받고, publish 잡의 「태그 형식 확인」 단계가 정확한
SemVer 로 좁힌다(어긋나면 거기서 죽는다). 프리릴리스 버전(`0.4.0-rc.1` 등)은 npm dist-tag `next` 로,
나머지는 `latest` 로 올라간다 — npm 11 은 프리릴리스를 `--tag` 없이 게시하면 거절한다.

**새 패키지의 첫 버전은 이 절차로 올리지 않는다** — 레지스트리에 없는 패키지에는 trusted publisher 를
걸 수 없다. → 「첫 게시 — 패키지가 아직 없을 때」.

### 서버를 먼저 배포한다

**CLI 가 새 서버 프로시저를 부르게 됐으면, 그 프로시저를 토큰에 연 서버가 떠 있는 뒤에 CLI 를 게시한다.**
`erdd dict …`·`erdd init --create` 가 그런 명령이다([cli.md](cli.md) 「액세스 토큰 인증」의 표).
순서가 뒤집히면 옛 서버가 그 호출을 세션 전용 거절(401)이나 프로시저 부재(404)로 막고, CLI 는 그것을
「서버가 이 기능을 지원하지 않습니다 — 서버를 업그레이드하세요」로 번역해 **시끄럽게** 멈춘다 — 데이터가
틀어지지는 않지만 새 버전을 받은 사용자 전원이 그 명령을 못 쓴다. 반대 방향(새 서버 + 옛 CLI)은 안전하다
— 서버는 옛 CLI 가 부르는 프로시저를 그대로 둔다.

---

## CI — 검증과 게시

워크플로는 둘이다.

| 파일 | 언제 | 무엇을 |
|---|---|---|
| `.github/workflows/ci.yml` | PR, `main` push, **그리고 `release.yml` 이 부를 때**(`workflow_call`) | `verify` 잡: `pnpm install --frozen-lockfile` · `pnpm -r typecheck` · **core·cli·web 테스트** · `apps/web build` · `bundle:web`. `server` 잡: PostgreSQL 서비스를 띄워 `apps/server` 테스트 |
| `.github/workflows/release.yml` | `cli-v<SemVer>` 태그 push | `verify`(= `ci.yml` 전체) → `publish` |

**게시 전 검증은 PR 검증을 그대로 부른다.** `release.yml` 의 `verify` 잡은 `ci.yml` 을 `workflow_call` 로
부르고 `upload-web-bundle: true` 를 넘겨, `ci.yml` 의 `verify` 잡이 빌드한 `packages/cli/web/` 를
artifact(`cli-web-bundle`)로 올리게 한다. `publish` 는 그것을 그대로 받아 게시한다 —
**재빌드하지 않는다**(검증한 것과 게시하는 것이 같아야 한다). 검증 단계를 `release.yml` 에 따로
적지 마라 — 두 곳이 갈리면 PR 에서 통과한 것과 게시 전에 도는 것이 달라진다.

⚠️ **`pnpm -C apps/web test` 는 빼지 마라.** 그 빌드 산출물이 그대로 tarball 의 `web/` 이 되어
소비처에서 서빙된다 — **게시물의 대부분이 web 이다.** 그 줄이 없으면 어떤 테스트도 거치지 않은 것이
게시되는 경로가 열린다. `build` 앞에 둔 것도 의도다(깨졌으면 빌드에 시간을 쓰기 전에 죽는다).

`server` 잡의 DB 배선과 skip 판정은 [setup.md](setup.md) 「CI 의 서버 테스트」 절이 갖는다.
그 잡도 `ci.yml` 의 일부라 **게시 전 검증에 함께 들어간다.**

⚠️ **잡을 `container:` 로 옮기지 마라.** GitHub 호스트 러너는 비-root 사용자(`runner`)로 돈다.
cli 의 퍼미션 테스트 둘 — `packages/cli/src/commands/push.test.ts` 의 「기록에 실패하면 model.push를
보내지 않고 …」와 `packages/cli/src/local/store.test.ts` 의 「신규 id 되쓰기의 쓰기 실패는 … ok:false 로
알린다」 — 는 `chmod 444` 로 EACCES 를 유도하는데, **root 는 퍼미션을 무시하고 쓴다.** 그래서 root 로
돌면 둘 다 죽는다(앞의 것은 root 를 감지해 일부러, 뒤의 것은 기대한 쓰기 실패가 나지 않아서).
테스트를 무르게 고치지 말고 비-root 로 돌려라 — 컨테이너 잡은 기본이 root 다.

---

## 게시를 막는 가드 넷

워크플로 주석도 같은 번호·이름으로 부른다. 「태그 형식 확인」 단계는 트리거 조건의 일부라 가드에 넣지 않는다.

| # | 가드 | 어디서 | 무엇을 막나 |
|---|---|---|---|
| 1 | **태그 버전** — 태그의 버전 == `packages/cli/package.json` 의 `version` | CI publish | 태그만 올리고 매니페스트를 잊는 것. 그대로 나가면 npm 에 태그와 다른 버전이 올라간다 |
| 2 | **웹 번들** — `packages/cli/web/index.html` 존재 | CI publish | 번들 없는 게시. 설치한 쪽에서 서버는 뜨는데 `/p/<id>` 만 404 를 내는, 원인을 짚기 어려운 상태가 된다 |
| 3 | **core 버전 누락** | CI publish | 「새 cli + 옛 core」가 조용히 나가는 것. 아래 절 |
| 4 | **`prepack`**(`check-web-bundle.mjs` → `bundle-docs.mjs`) | pack·publish 어디서나 | 웹 번들 없이 팩하는 것. CI 가드와 겹치지만 **CI 밖의 손 게시까지** 덮는다. CI 의 `pnpm pack` 이 `--ignore-scripts` 를 쓰지 않는 것이 이 훅을 거기서도 돌게 하려는 것이다 |

**패키지 이름을 검사하는 가드는 두지 않는다.** 게시 권한은 패키지 이름마다 npmjs.com 에 건 trusted
publisher 설정이 쥔다 — 설정하지 않은 이름으로는 OIDC 게시가 거절된다(→ 「게시 경로와 인증」).

**cli 는 「이미 있으면 건너뛰기」를 하지 않는다.** 태그가 가리키는 버전이 이미 있다면 태그를 잘못 단
것이고, npm 이 거절해 잡이 죽는 것이 맞다 — 조용히 넘어가면 「게시됐다」는 초록 파이프라인만 남는다.

### core 를 고쳤으면 `packages/core/package.json` 의 `version` 을 반드시 올려라

publish 잡은 `npm view "@erdd/core@<버전>"` 으로 「이미 있으면 건너뛴다」를 한다(cli 만 고친
릴리스에서 이미 있는 버전을 다시 올리다 죽지 않게 하려는 의도된 동작이다).
**판정은 404 만 「없음」으로 읽는다** — `npm view` 가 `E404` 가 아닌 이유(네트워크·인증·레지스트리
오류)로 실패하면 출력을 그대로 남기고 **멈춘다.** 게시 여부를 모르는 채 어느 쪽으로도 가지 않는다.

**건너뛰기 직전에 직전 `cli-v*` 태그와 이번 태그를 비교한다.** 조건은 **둘이 모두** 참일 때다.

```bash
[ "$PREV_CORE_VERSION" = "$CORE_VERSION" ] && ! git diff --quiet "$PREV_TAG" "$TAG" -- packages/core
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
(레지스트리 순간 오류·네트워크) 재시도에서는 core 가 이미 npm 에 있으므로 건너뛰기 분기로
들어가고, 거기서 파일 변경만 보는 가드가 발동해 **그 태그로는 다시는 성공할 수 없게 된다.**

⚠️ **이 판정은 저장소에 `cli-v*` 태그가 전부 있어야 성립한다.** 그래서 publish 잡은 체크아웃을
`fetch-depth: 0` 으로 하고(직전 태그까지 커밋 **깊이**가 있어야 `git describe`·`git diff` 가 돈다),
그 **바로 다음**, 가드보다 **앞**에서 태그를 refspec 을 명시해 따로 fetch 한다
(`git fetch origin '+refs/tags/*:refs/tags/*'`). 체크아웃 옵션이 태그를 함께 가져오는지에 판정을
기대지 않고, 못 가져오면 **릴리스를 죽인다. `|| true` 로 넘기게 고치지 마라** — 태그가 없는 상태의
「직전 태그 없음」은 첫 릴리스와 구분되지 않아, 가드가 발동해야 할 때 조용히 통과한다. 그 조용한
통과가 이 가드가 막으려는 사고 그 자체다.

⚠️ **fetch 직후에 받은 `cli-v*` 목록을 로그에 찍는다 — 걷어내지 마라.** 가드는 「직전 태그 없음」을
첫 릴리스와 구분하지 못하므로, 「태그가 실제로 들어왔는가」는 그 목록으로만 판정된다. 없으면
「태그가 안 들어왔다」와 「직전 태그가 원래 없다」를 로그에서 가를 수 없다.

이 판정에는 **알고 쓰는 실패 모드**가 있다.

| 상황 | 어느 쪽으로 기우나 |
|---|---|
| 직전 태그가 없다(첫 릴리스) | **통과.** 첫 태그에서는 core 도 미게시라 애초에 게시 분기로 가서 이 검사에 닿지 않는다 |
| 직전 태그의 `packages/core/package.json` 을 못 읽는다 | **통과.** `PREV_CORE_VERSION` 이 빈 문자열이 되어 version 비교가 어긋난다 — 못 읽는 것은 「버전을 안 올렸다」의 증거가 전혀 아니라, 거짓 실패로 릴리스를 막는 쪽이 더 나쁘다고 보고 고른 방향이다 |
| `git diff` 자체가 실패한다(객체 없음 등) | **실패.** 다만 version 비교를 먼저 통과해야 하므로 **버전이 그대로일 때만** 그렇다 |

⚠️ **이 기울기를 만드는 `|| true` 는 그대로 두되, git 의 stderr 는 `2>/dev/null` 로 되돌리지 마라.**
삼키면 「찾을 것이 없다」와 「git 이 아예 못 돌았다」가 같은 빈 문자열로 합쳐져, 위 표의 「통과」가
실제로 어느 상황인지 로그에서 가릴 수 없다. 첫 릴리스에서 `git describe` 의
`fatal: No names found …` 가 로그에 남는 것은 정상이다.

---

## 게시 경로와 인증

### `pnpm pack` 으로 팩하고 `npm publish <tarball>` 로 올린다

publish 잡은 두 패키지를 각각 `pnpm -C packages/<이름> pack --pack-destination …` 으로 팩하고,
그 tarball 을 `npm publish <tarball> --access public --provenance --tag <latest|next>` 로 올린다.
**둘을 나눈 이유는 한 도구가 두 절반을 다 하지 못하기 때문이다.**

- **`workspace:^` 를 실제 버전으로 바꾸는 것은 `pnpm pack`/`pnpm publish` 뿐이다.** `npm publish` 를
  디렉터리에 바로 쓰면 `workspace:^` 가 그대로 나가 설치가 깨진다. `pnpm pack` 은 의존성이 설치돼
  있어야 그 치환을 한다(설치 전에는 `ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL`) — 그래서 publish
  잡도 `pnpm install --frozen-lockfile` 을 한다.
- **trusted publishing 의 OIDC 교환은 npm CLI 11.5.1 이상이 한다.** Node 22 에 딸린 npm 은 그보다
  낮아 publish 잡이 `npm install -g 'npm@^11.5.1'` 로 올린다. Node 는 22.14.0 이상이어야 한다
  (`.nvmrc` 의 `22` 가 최신 22.x 로 풀린다).
- ⚠️ **`pnpm --filter <패키지> publish` 로 바꾸지 마라.** `--filter` 는 pnpm 의 재귀 게시 경로를 타는데,
  그 경로는 **이미 있는 버전을 조용히 건너뛰고**(「There are no new packages that should be published」,
  종료 코드 `0`) npm 에 넘기는 인자에서 `--provenance` 를 떨어뜨린다(`--access`·`--otp`·`--dry-run`
  만 넘긴다). 앞의 것은 위 「cli 는 건너뛰지 않는다」를 조용히 무력화한다. pnpm 10.4.1 의
  `@pnpm/plugin-commands-publishing` 의 `recursivePublish` 가 그렇게 짜여 있고, 이미 있는 버전에
  `pnpm --filter @erdd/core publish --dry-run --no-git-checks` 를 돌리면 위 문구와 `0` 이 나온다.

`prepack`(가드 4)은 `pnpm pack` 이 부른다. `npm publish <tarball>` 은 이미 팩된 것을 올리므로
라이프사이클 스크립트를 다시 돌리지 않는다.

⚠️ **publish 잡에서 도는 것은 전부 게시 신원 옆에서 돈다.** `id-token: write` 의 OIDC 요청 토큰은 잡의
모든 단계에 보인다. 지금은 의존성 설치(`pnpm install`)가 의존성의 빌드 스크립트를 돌리지 않는다 —
pnpm 10 은 `onlyBuiltDependencies` 에 적힌 것만 돌리고 이 저장소에는 그 설정이 없다.
**`onlyBuiltDependencies` 에 무언가를 넣으면 그 스크립트가 `id-token: write` 옆에서 돈다** — 넣어야 하면
팩 잡(신원 없음)과 게시 잡(tarball 만 받아 `npm publish`)을 나누는 것을 먼저 검토하라. 같은 이유로 publish
잡의 `setup-node` 에는 `cache: pnpm` 을 두지 않는다(다른 실행이 만든 캐시를 신원 있는 잡에 복원하지 않는다).

### trusted publishing 과 provenance

trusted publishing 은 npmjs.com 의 **패키지별** 설정이다 — 패키지의 Settings → Trusted Publisher 에서
「Set up connection」으로 만든다. 칸과 넣는 값은 이렇다.

| 칸 | 값 |
|---|---|
| Publisher | GitHub Actions |
| Label | 선택 — 비워도 된다 |
| Organization or user | `jang2162` |
| Repository | `erdd` |
| Workflow filename | `release.yml` — 경로 없이 **파일 이름만** |
| Environment name | 비운다(아래 environment 규칙) |
| Allowed actions | **「Allow `npm publish`」를 체크한다** |

publish 잡은 `permissions: id-token: write` 를 갖는다.

- ⚠️ **「Allow `npm publish`」를 체크하지 않으면 `release.yml` 의 게시가 거절된다.** 그 칸에서 기본으로
  열려 있는 것은 「`npm stage publish` is always allowed」 — staged publish 뿐이고, 체크박스를 켜야 그
  연결로 `npm publish` 가 허용된다. publish 잡은 `npm publish` 를 쓴다.
- ⚠️ **칸은 만든 뒤 고칠 수 없다**(화면의 「Cannot be changed later」). 값이 틀렸으면 그 연결을 지우고
  다시 만든다.
- **npm 은 이 설정을 저장할 때 검증하지 않는다** — 값이 틀리면 다음 게시에서야 거절로 드러난다.
- **웹 화면 대신 `npm trust` 명령으로도 건다.** 조건은 npm 11.15.0 이상, 계정 2FA, 그리고 2FA 우회 토큰이
  아닐 것이다. 이 명령도 **레지스트리에 이미 있는 패키지**에만 건다.

**Publishing access 는 「Require two-factor authentication and disallow bypass 2fa tokens (recommended)」로
둔다.** 같은 Settings 화면에 있지만 trusted publisher 와 **따로 저장된다** — 그 선택지를 고른 뒤
「Update Package Settings」를 눌러야 반영되고, 연결만 만들고 나오면 바뀌지 않는다. 이 선택은 trusted
publishing 을 막지 않는다(화면 안내대로 어느 선택지든 OIDC 게시는 계속 된다). 닫히는 것은 2FA 우회
토큰으로 게시하는 경로다 — 새 패키지 첫 게시의 (b) 가 기대는 경로라 그 패키지에는 첫 버전이 올라간 뒤에
건다(설정 화면 자체가 그때 생긴다).

- ⚠️ **publish 잡에 GitHub environment(`environment:`)를 붙이면 trusted publisher 의 environment 칸에
  같은 이름을 넣어야 한다.** 한쪽만 있으면 OIDC 게시가 거절된다. environment 는 필수 리뷰어로 게시를
  사람 승인 뒤로 미는 용도다 — 지금은 두지 않았으므로 쓰기 권한이 있는 사람은 `cli-v*` 태그를 밀어
  게시할 수 있다. 그것을 좁히려면 GitHub 의 태그 ruleset 으로 `cli-v*` 생성을 제한하거나 environment 를 둔다.
  칸은 고칠 수 없으므로 environment 를 붙이면 두 패키지의 연결을 각각 지우고 다시 만든다.
- ⚠️ **워크플로 파일 이름을 바꾸거나 publish 잡을 다른 파일로 옮기면 게시가 거절된다.** npm 은
  OIDC 토큰의 워크플로 이름을 그 설정과 대조한다. `workflow_call` 로 불린 워크플로 안에서 게시하면
  **부른 쪽**의 이름으로 대조되므로, 게시 단계는 `release.yml` 에 직접 둔다(`ci.yml` 은 검증만 한다).
- ⚠️ **두 매니페스트의 `repository.url`(`git+https://github.com/jang2162/erdd.git`)을 바꾸지 마라.**
  provenance 는 매니페스트의 저장소와 실제로 빌드한 저장소를 대조해 어긋나면 게시를 거절한다.
- **GitHub 호스트 러너에서만 된다.** npm 이 셀프 호스트 러너의 OIDC 게시를 받지 않는다.
- **저장소가 공개여야 한다.** npm 의 provenance 는 공개 저장소에서 빌드한 공개 패키지에만 붙는다 —
  비공개 저장소에서 `--provenance` 로 게시하면 거절된다. publish 잡의 태그 fetch 도 자격증명 없이
  돌아 공개 저장소를 전제한다.
- `publishConfig` 에는 `access: "public"` 만 둔다. 스코프 패키지의 게시는 기본이 비공개(`restricted`)라
  유료 플랜이 아니면 그것이 없을 때 거절된다(CLI 의 `--access public` 과 겹치지만 손 게시까지 덮는다).
  **`publishConfig.registry` 는 두지 않는다** — 게시 대상은 기본값인 공개 npm 하나다.

### 첫 게시 — 패키지가 아직 없을 때

**npm 은 레지스트리에 아직 없는 패키지에 trusted publisher 를 걸 수 없다**(`npm trust` 문서의
「Package must exist」 — 웹 화면도 패키지 페이지가 생긴 뒤에야 열린다). 그래서 `@erdd/` 에 새 패키지를
더하면 **그 첫 버전 한 번은 OIDC 로 올릴 수 없다.** 전제로 게시할 계정이 npm 조직 **`erdd`**(`@erdd`
스코프의 소유자)에 쓰기 권한을 가져야 한다. 길은 둘이고 **기본은 (a) 다.**

**(a) 로컬에서 OTP 로 손 게시한다 — 권장.** 아래 「손 게시(CI 밖)」 절차 그대로 한다. 계정 2FA 의 OTP 로
올리므로 **2FA 를 우회하는 토큰을 만들 일이 없다.** 대가는 **그 버전에 provenance 가 없다는 것**이다
(CI 밖에는 서명할 OIDC 신원이 없다). 다음 버전부터는 CI 가 provenance 를 붙여 올린다.

**(b) 2FA 우회 토큰으로 CI 가 올린다 — 폴백.** publish 잡은 저장소 시크릿 `NPM_TOKEN` 이 있을 때만
`~/.npmrc` 에 `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` 을 적는다(값이 아니라 참조다). npm 은 OIDC 를
먼저 시도하고, 그 패키지에 trusted publisher 가 없으면 토큰으로 떨어진다. 토큰은 **Granular Access Token**
— 스코프 `@erdd` 에 Read and write, 만료는 짧게, **「Bypass two-factor authentication」 을 켠다.**

- ⚠️ **npm 은 2FA 우회 토큰의 직접 게시를 제한해 가고 있다**(게시 로그에 찍히는 공지 `npm tokens that
  bypass 2FA are being restricted for account changes and direct publishing` —
  https://gh.io/npm-gat-bypass2fa-deprecation). 이 경로는 언제든 막힐 수 있어 기본으로 두지 않는다.
- 쓴다면 **첫 버전이 올라간 직후 시크릿 `NPM_TOKEN` 을 지우고 npm 에서 토큰을 폐기한다.** 남겨 두면
  장기 토큰이 CI 에 계속 열려 있다.

⚠️ **계정에 쓰기 2FA 가 켜져 있는데 bypass 가 꺼진 토큰으로 CI 가 게시하면 이렇게 죽는다.**

```
npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@erdd%2fcore - Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

CI 에는 OTP 를 넣을 자리가 없어 그 토큰으로는 재시도해도 통과하지 못한다 — (a) 로 간다. 이때
provenance 서명은 sigstore 에 기록되지만 **패키지는 올라가지 않는다.** 투명성 로그에 서명이 남은 것을
게시로 읽지 말고 `npm view @erdd/<이름>@<버전> version` 이 404 인지로 판정한다.

⚠️ **첫 버전을 손으로 올렸으면 그 태그의 release 실행을 다시 돌리지 마라.** 이미 있는 버전을 또 올리려다
죽을 뿐이다(cli 는 건너뛰지 않는다 — 「게시를 막는 가드 넷」). 그 태그는 그대로 두고 다음 버전부터 CI 로
게시한다.

첫 버전이 올라가면 그 패키지에 차례로 건다(→ 「trusted publishing 과 provenance」).

1. trusted publisher 연결 — 표의 값, 「Allow `npm publish`」 체크.
2. Publishing access — 「disallow bypass 2fa tokens」, 「Update Package Settings」.
3. (b) 를 썼다면 시크릿 `NPM_TOKEN` 삭제와 토큰 폐기.

시크릿이 없는 상태에서 trusted publisher 가 없는 패키지를 게시하려 하면 npm 이 인증 오류로 거절한다 —
조용히 잘못되지는 않는다.

---

## 손 게시(CI 밖)

새 패키지의 첫 버전(→ 「첫 게시 — 패키지가 아직 없을 때」)이 이 경로의 몫이다. 그 밖에는 태그 게시를 쓴다.

⚠️ **손 게시는 CI 가드 셋(태그 버전·웹 번들·core 버전)을 거치지 않는다.** 남는 것은 `prepack` 하나다.
provenance 도 붙지 않는다(CI 밖에서는 서명할 OIDC 신원이 없다). 가드 1 이 하던 대조 — 태그의 버전과
`packages/cli/package.json` 의 `version` 이 같은가 — 는 손으로 한다.

**1) 태그 커밋을 깨끗한 detached 워크트리로 꺼낸다.** 작업 중인 체크아웃에서 팩하면 커밋되지 않은
변경이 tarball 에 들어가 게시본이 태그와 달라진다.

```bash
git worktree add --detach <저장소 밖 경로> cli-v<버전>
```

**2) 그 워크트리에서 설치하고 웹 번들을 만든다.** 번들이 없으면 `prepack` 이 종료 코드 `1` 로 막는다.
`pnpm pack` 이 `workspace:^` 를 치환하려면 설치가 먼저다(→ 「`pnpm pack` 으로 팩하고 …」).

```bash
pnpm install --frozen-lockfile
pnpm -C apps/web build && pnpm -C packages/cli run bundle:web
```

**3) 저장소 밖으로 팩한다.** 게시는 CI 와 같은 경로다 — `pnpm pack` 의 tarball 을 `npm publish` 한다.

```bash
pnpm -C packages/core pack --pack-destination <밖의 디렉터리>
pnpm -C packages/cli pack --pack-destination <밖의 디렉터리>
```

**4) 게시 대상을 확인한다.**

```bash
npm config get @erdd:registry                                   # undefined 여야 한다
npm publish <밖의 디렉터리>/erdd-core-<버전>.tgz --access public --dry-run
```

⚠️ **`npm config get @erdd:registry` 가 `undefined` 가 아니면 멈춘다.** 사용자·전역 설정에 `@erdd` 스코프
레지스트리가 있으면 `npm publish`·`npm view` 가 **그 레지스트리로 나간다** — 스코프 설정이 `--registry`
인자보다 이긴다. 조회는 엉뚱한 곳의 결과를 내고 게시는 엉뚱한 곳에 올라간다. dry-run 출력의 게시 대상
주소가 `https://registry.npmjs.org/` 인지도 본다.

**5) 자기 터미널에서 로그인하고 core 먼저, cli 다음으로 올린다.** OTP 를 물으므로 에이전트나 CI 가 아니라
사람이 대화형으로 돌린다.

```bash
npm login
npm publish <밖의 디렉터리>/erdd-core-<버전>.tgz --access public
npm publish <밖의 디렉터리>/erdd-cli-<버전>.tgz --access public
```

core 를 먼저 올린다 — cli 가 core 를 의존한다. 프리릴리스 버전이면 `--tag next` 를 붙인다(npm 11 은
`--tag` 없는 프리릴리스 게시를 거절한다). **토큰을 저장소 안의 `.npmrc` 에 적지 마라**(커밋 대상이다).

**6) 올라간 것이 팩한 것과 같은지 대조한다.** 레지스트리의 `dist.integrity` 와 로컬 tarball 의 sha512 가
같아야 한다.

```bash
npm view @erdd/core@<버전> dist.integrity
echo "sha512-$(openssl dgst -sha512 -binary <밖의 디렉터리>/erdd-core-<버전>.tgz | openssl base64 -A)"
```

## 게시 직후 확인 — 레지스트리 반영은 늦을 수 있다

**게시 로그에 `+ @erdd/<이름>@<버전>` 이 찍혀도 그 버전이 조회·설치에 곧바로 보이지 않을 수 있다.**
그 사이 `npm view @erdd/cli`·`pnpm add @erdd/cli` 는 **옛 `latest` 를 돌려준다** — 오류가 아니라 정상
응답으로. 두 패키지를 잇달아 올려도 반영 시점은 패키지마다 다르다.

- **설치 검증은 버전을 못박아 한다** — `pnpm add -D @erdd/cli@<버전> tsx`. 버전 없이 설치하면 반영 전에는
  옛 버전이 깔리고, 그것을 돌린 결과가 새 버전의 검증으로 읽힌다. 설치한 뒤 `node_modules/@erdd/cli/package.json`
  의 `version` 을 확인하면 이 착각이 닫힌다.
- **버전 없이 확인해야 하면 반영을 먼저 본다** — `npm view @erdd/cli dist-tags.latest` 가 새 버전을 낼 때까지
  기다린 뒤에 한다.
- ⚠️ **「안 보인다」를 게시 실패로 읽고 다시 게시하지 마라.** 게시 성공의 판정은 publish 잡의 종료와 로그의
  `+ …` 줄이다. 같은 버전의 재게시는 npm 이 거절하므로 재실행은 죽을 뿐이고(cli 는 건너뛰지 않는다 —
  「게시를 막는 가드 넷」), 그 빨간 실행이 남아 이미 성공한 게시를 실패로 보이게 한다.

조회 결과가 이상하면 `npm config get @erdd:registry` 도 본다 — `@erdd` 스코프 레지스트리 설정이 남아 있으면
조회와 설치가 공개 npm 이 아닌 그곳으로 간다(→ 「손 게시(CI 밖)」 4단계).

## 소비처 설치

사용자 매뉴얼과 같은 내용이다. 레지스트리 설정 없이 `pnpm add -D @erdd/cli tsx`
(npm 이면 `npm install -D @erdd/cli tsx`).

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

**웹 화면에 뜨는 제품 버전은 웹을 빌드할 때 굳는다.** `apps/web/erdd-version.ts` 의 `erddVersion` 이
`packages/cli/package.json` 의 `version` 을 읽어 `__ERDD_VERSION__` 으로 주입한다. 그래서 **버전을 올린 뒤
웹을 다시 빌드하지 않으면 화면은 옛 버전을 계속 보인다** — 저장소 배치의 `erdd serve` 가 먼저 보는
`apps/web/dist` 도, 서버 배포 이미지도 마찬가지다. 게시본의 번들은 CI 가 태그 커밋에서 빌드하므로 맞다.
파일을 못 읽거나 `version` 이 비면 빌드가 죽는다 — 헤더에 빈 버전이 뜬 채로 배포되지 않게 하려는 것이다.

CI 는 이 번들을 artifact 로 넘길 때 `include-hidden-files: true` 로 **점 파일까지** 싣는다.
upload-artifact 의 기본값은 점 파일을 빼는데, 그러면 `apps/web/public` 에 생긴 `.well-known/` 같은 것이
게시본에서 조용히 빠지고 가드 2(index.html 존재)로는 잡히지 않는다 — 그 옵션을 걷지 마라.

### 라이선스 — `packages/*/LICENSE`

npm 은 `files` 와 무관하게 **패키지 루트의** `LICENSE` 를 tarball 에 넣지만, 패키지 디렉터리 밖의
파일은 팩하지 않는다. 그래서 루트 `LICENSE` 의 **사본을 두 패키지 디렉터리에 커밋해 둔다.**

- **prepack 복사가 아니라 커밋한 사본인 이유:** core 에는 prepack 이 없어 새로 붙여야 하고, 라이선스
  문구는 거의 바뀌지 않으며, 커밋해 두면 GitHub 에서 패키지 디렉터리를 연 사람에게도 보이고
  `--ignore-scripts` 팩에서도 빠지지 않는다.
- ⚠️ **루트 `LICENSE` 를 고치면 두 사본도 함께 고친다.** `ci.yml` 의 「LICENSE 사본이 루트와 같은가」
  단계가 `cmp` 로 어긋남을 잡아 PR 을 떨어뜨린다.

### 매뉴얼 — `packages/cli/docs/`

`packages/cli/README.md` 는 저장소에 커밋돼 있고 npm 이 `files` 와 무관하게 자동 동봉한다
(npmjs.com 의 패키지 페이지도 그것을 렌더한다). 매뉴얼은 다르다 — **npm 은 패키지 디렉터리
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
  CI 든 손으로 `pnpm pack` 하든 항상 최신 매뉴얼이 들어간다. 그래서 워크플로에는 문서 관련
  단계가 없다 — **넣지 마라.** prepack 이 어느 경로에서도 도는 것이 이 설계의 요점이다.
- 동봉 문서를 가리키는 상대 링크(`./docs/local-guide.md`)가 `README.md` 에 있다. **저장소에서는
  그 경로가 비어 있는 것이 정상이다**(팩할 때 생긴다).
- ⚠️ **살아나는 것은 「매뉴얼 넷 사이」의 링크다.** `docs/manual/` **밖**을 가리키는 링크는
  동봉본에서 열리지 않는다 — 팩된 tarball 에서 그런 링크는 깨진다. **알고 그대로 두었다**:
  기여자용·저장소 내부 문서라 패키지를 설치한 사람이 볼 일이 없고, 절대 URL 로 바꾸면 저장소 안에서
  매일 쓰는 클릭 이동을 잃는 데다 저장소 주소나 기본 브랜치가 바뀌면 그때 깨진다.
  **매뉴얼 넷에 manual 밖을 가리키는 링크를 새로 넣으면 같은 방식으로 깨진다** — 넣을 거면 알고 넣어라.

---

## 알려진 한계

- **소비처가 `tsx` 를 직접 설치해야 한다.** `bin` 셰방을 `#!/usr/bin/env node` + 얇은 `.mjs` 런처로
  바꾸고 런타임에서 tsx 를 로드하면 그 선언이 필요 없어진다. **방법은 실증됐다** —
  `createRequire(realpathSync(런처 경로))` 로 pnpm 심볼릭을 실경로로 풀면 `tsx` 가 해석된다.
  ⚠️ **이것이 유일한 근본 해결책이다** — `dependencies` 선언만으로는 **pnpm 에서 오히려 회귀한다**
  (실측해서 되돌렸다). 비용은 진입점 교체와 두 배치(pnpm 격리·npm 평면)·전역 설치·
  `npx @erdd/cli` 재검증, 그리고 `tsx/esm/api` 라는 프로그램적 API 에 묶이는 것이다.
- **core 게시 판정이 npm 오류 출력의 문자열 `E404` 에 기댄다.** `npm view` 는 없는 패키지와 없는
  버전을 둘 다 종료 코드 `1` + `npm error code E404` 로 알리고, 판정은 그 문자열을 찾는다. npm 이
  그 표기를 바꾸면 「없음」도 「판정 불가」로 읽혀 **게시가 시끄럽게 멈춘다** — 조용히 잘못되지는 않는다.
- **게시본에 죽은 항목이 남는다.** tarball 의 `package.json` 에 `scripts.bundle:web`·
  `scripts.bundle:docs` 가 남는데 `scripts/` 는 동봉되지 않는다. `devDependencies` 의
  `@erdd/server` 버전도 npm 에 없다(`private` 패키지다). 둘 다 소비처에 실질 피해는 없다.
- **떠 있는 버전이 셋 있다.** `.nvmrc` 의 `22` 는 실행 시점의 최신 22.x 로, `npm@^11.5.1` 은 최신
  11.x 로, 러너 이미지 `ubuntu-24.04` 는 GitHub 가 갱신하는 대로 풀린다. 재현 가능한 파이프라인을
  원하면 `.nvmrc` 를 `22.x.y` 로, npm 을 정확한 버전으로 고정한다. 액션은 커밋 SHA 로 고정돼 있다.
- **게시 대기열은 하나뿐이다.** `concurrency: release` 는 한 번에 하나를 돌리고 대기는 하나만 둔다 —
  도는 중에 태그 둘을 더 밀면 먼저 대기하던 쪽이 취소된다. 태그는 앞 게시가 끝난 뒤 하나씩 민다.
  취소된 태그는 그 실행을 다시 돌리면 된다.
- **publish 잡을 다시 돌릴 수 있는 창은 7일이다.** verify 가 올린 웹 번들 artifact 의 보존 기간이다.
  지나서 「Re-run failed jobs」를 누르면 download 단계가 죽는다(시끄럽게) — 그때는 실행 전체를 다시 돌린다.
- **태그 필터가 빌드 메타데이터를 잡지 않는다.** `cli-v0.1.0+build.1` 형태는 워크플로를 띄우지
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
  않는다」는 **macOS 에서만 검증력이 있어** `skipIf` 에 플랫폼을 함께 뒀다 — CI(Linux 러너)에서는
  skip 되고, 검증력은 macOS 로컬 실행에만 있다.
- **러너에서 한 번도 돈 적 없는 게시 경로가 셋 있다.** 첫 실행에서 깨질 수 있다는 뜻이다.
  - **core 건너뛰기 분기와 가드 3.** core 의 version 이 이미 npm 에 있을 때만 들어가는 분기라, core 를
    고치지 않고 cli 만 올리는 릴리스(또는 core 게시 뒤 cli 에서 죽은 실행의 재시도)에서만 들어간다. 그 안의
    `git describe --match 'cli-v*'` 로 직전 태그를 찾는 것, 직전 태그의 `packages/core/package.json` 을
    읽는 것, version 비교가 전부 여기 걸려 있다. 로그에서 「이미 있습니다 — 게시를 건너뜁니다」 계열 문구가
    나오고 `git describe` 가 직전 태그를 찾았는지(`fatal: No names found` 가 **없는지**) 본다.
  - **프리릴리스 태그의 `--tag next` 게시.** 프리릴리스 버전을 태그로 민 적이 없다.
  - **`NPM_TOKEN` 폴백으로 성공하는 게시**(「첫 게시」의 (b)). 시크릿이 없을 때 OIDC 만 쓰는 쪽은 아래처럼 돈다.

  러너에서 이미 도는 것은 verify·server 잡, 자격증명 없는 태그 fetch(체크아웃이 `persist-credentials: false`
  다)와 그 목록 로그, 가드 1·2, core 의 `npm view` 404 판정, 시크릿 없이 OIDC 로 두 패키지를 게시하는 것과
  그 provenance(`https://slsa.dev/provenance/v1`), `timeout-minutes`(20분) 안의 완료다.
  OIDC 게시가 거절되면 「trusted publishing 과 provenance」의 표 — 특히 Workflow filename·Environment
  name·「Allow `npm publish`」 — 를 먼저 의심한다. **태그 fetch 는 fetch 직후에 찍히는 `cli-v*` 개수로
  판정한다** — 이번 태그 하나뿐이면 옛 태그가 GitHub 에 없거나 refspec 쪽이고, 여럿이면 들어온 것이다.
