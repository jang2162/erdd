# 첫 공개 게시 체크리스트 — 저장소 공개와 npm 첫 게시

**⚠️ 이 문서는 `ops/` 다 — 일회성이다.** 첫 공개 게시가 끝나고 그다음 릴리스가 토큰 없이(trusted publishing
만으로) 게시되는 것까지 확인되면 **이 파일을 지우고 `CLAUDE.md` 의 이 문서를 가리키는 목차 줄도 함께 지운다.**

게시 절차·가드·게시 경로의 **지속 규칙은 [../guides/release.md](../guides/release.md) 가 정본이다**
(「첫 게시 — 패키지가 아직 없을 때」「trusted publishing 과 provenance」「손 게시(CI 밖)」). 여기 적는 것은
이 저장소가 공개로 넘어가는 **한 번**에만 필요한 순서와 조건, 그리고 그 진행 상태다.

## 남은 일 — 이 둘뿐이다

- [ ] **다음 릴리스(예: `cli-v0.4.1`)가 토큰 없이 OIDC 로 게시되는지 실측한다** → 7단계.
- [ ] **그 뒤 이 파일과 `CLAUDE.md` 의 목차 줄을 지운다** → 7단계.

(1단계의 「옛 소비처에 알리기」는 이 저장소 밖의 일이라 위 둘과 따로 남아 있다.)

---

## 0. 전제 — 이미 되어 있는 것

- [x] **첫 공개 게시 버전은 `@erdd/core` 0.3.0 · `@erdd/cli` 0.4.0 이다**(두 `package.json` 에 반영돼 있다).
  - cli 를 올린 이유: `cli-v0.1.0` … `cli-v0.3.3` 태그가 이미 있어 그 버전으로는 태그를 새로 달 수 없다.
  - core 를 올린 이유: `packages/core` 가 직전 태그 `cli-v0.3.3` 이후 바뀌었다. version 이 그대로(0.2.0)이면
    첫 실행이 core 게시까지 성공하고 cli 에서 죽은 뒤 **재시도하는 순간 core 버전 누락 가드(가드 3)가
    발동해 그 태그로는 다시 성공할 수 없다.** 0.3.0 이면 직전 태그의 0.2.0 과 달라 가드가 통과한다.
  - 옛 레지스트리에 있던 `@erdd/core@0.2.0` 과 지금의 0.2.0 은 내용이 다르다 — 같은 번호를 공개 npm 에
    다른 내용으로 올리지 않는 것도 이 선택의 이유다.

## 1. 이 머신과 옛 사용자 쪽 정리

- [x] **이 머신의 사용자 npm 설정에서 `@erdd` 스코프 레지스트리를 지웠다.** 확인: `npm config get @erdd:registry`
  → `undefined`. 남아 있으면 `npm view`·`npm install`·`npm publish` 가 전부 옛 레지스트리로 간다(스코프
  설정이 `--registry` 를 이긴다).
  - 사용자 `~/.npmrc` 의 `@pkg`·`@app` 스코프 레지스트리 줄과 그 레지스트리의 인증 토큰 줄은 **남겼다** —
    `@erdd` 전용이 아니라 다른 스코프가 쓴다. 지운 것은 `@erdd:registry` 한 줄이다.
- [ ] **옛 레지스트리에서 설치하던 소비처 프로젝트에 알린다.** 그 프로젝트에 커밋된 `.npmrc` 의
  `@erdd:registry=…` 줄이 계속 옛 레지스트리를 가리킨다 — 그 줄을 지워야 공개 npm 에서 받는다.
  지우고 나면 `pnpm add -D @erdd/cli@^0.4.0 tsx` 로 올린다(0.4.0 부터가 공개 npm 판이다).

## 2. npm 쪽 준비

- [x] **npm 조직 `erdd` 를 확인하거나 만든다**(`@erdd` 스코프의 소유자다).
- [x] **Granular Access Token 을 만든다.** 이 토큰은 「Bypass two-factor authentication」이 꺼진 채였고
  계정에는 쓰기 2FA 가 켜져 있어 5단계의 CI 게시가 403 으로 죽었다. 토큰은 6단계에서 삭제했다.

## 3. GitHub 저장소

- [x] **`jang2162/erdd` 를 공개(public)로 만든다.**
- [x] 원격을 더한다: `git remote add github https://github.com/jang2162/erdd.git`
  (`origin` 은 옛 저장소다. 아래 명령은 `github` 로 적는다.)
- [x] Actions 시크릿 `NPM_TOKEN` 에 2단계의 토큰을 넣었다(6단계에서 삭제했다).
- [ ] **(선택) 게시 권한을 좁힌다.** 지금은 쓰기 권한이 있는 누구나 `cli-v*` 태그를 밀어 게시할 수 있다.
  - 태그 ruleset 으로 `cli-v*` 생성을 관리자에게만 허용한다. 워크플로 변경이 없다.
  - 또는 publish 잡에 `environment: <이름>`(필수 리뷰어)을 붙인다. **이때는 trusted publisher 의
    Environment name 칸에 같은 이름이 있어야 하는데, 그 칸은 고칠 수 없다** — 두 패키지의 연결을 각각
    지우고 다시 만든다(release.md 「trusted publishing 과 provenance」). 한쪽만 있으면 OIDC 게시가 거절된다.

## 4. 병합과 push

- [x] `chore/public-release` 를 main 에 병합했다.
- [x] `git push github main` — `ci.yml` 이 main push 로 돌아 초록(verify·server 두 잡).
- [x] **옛 태그 여섯을 새 태그와 따로, 먼저 한 번에 push 했다** — 태그 이벤트가 생기지 않은 것(아무
  워크플로도 돌지 않은 것)을 확인했다.
  ```bash
  git push github cli-v0.1.0 cli-v0.2.0 cli-v0.3.0 cli-v0.3.1 cli-v0.3.2 cli-v0.3.3
  git ls-remote --tags github 'cli-v*'
  ```
  GitHub 은 한 번의 push 에 태그가 셋을 넘으면 태그 이벤트를 만들지 않는다(GitHub Docs 「Events that
  trigger workflows」 의 `push` 절). 그래서 **새 태그는 이 묶음에 섞지 않는다** — 섞으면 새 태그의 게시도
  시작되지 않는다.

## 5. 첫 게시 — CI 는 403 으로 죽었고 로컬 OTP 손 게시로 대신했다

- [x] 새 태그 `cli-v0.4.0` 을 **혼자** push 했다. `release.yml` 이 돌아 verify·server 는 통과했고, publish 잡은
  core 게시에서 이렇게 죽었다.
  ```
  npm error 403 403 Forbidden - PUT https://registry.npmjs.org/@erdd%2fcore - Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
  ```
  - 원인: 계정의 쓰기 2FA 가 켜져 있는데 2단계의 토큰은 bypass 2FA 가 꺼져 있었다. 같은 로그에 npm 공지
    `npm tokens that bypass 2FA are being restricted for account changes and direct publishing` 가 찍혔다
    (https://gh.io/npm-gat-bypass2fa-deprecation) — bypass 토큰을 새로 만들어 CI 로 재시도하는 대신
    손 게시로 갔다.
  - provenance 서명은 sigstore 에 기록됐지만 패키지는 올라가지 않았다(두 패키지 모두 `npm view` 404).
- [x] **로컬에서 OTP 로 손 게시했다** — release.md 「손 게시(CI 밖)」 절차 그대로.
  - `cli-v0.4.0` 태그 커밋을 깨끗한 detached 워크트리로 꺼내 `pnpm install --frozen-lockfile` →
    `pnpm -C apps/web build` → `pnpm -C packages/cli run bundle:web` → 두 패키지 `pnpm pack`(저장소 밖) →
    `npm config get @erdd:registry` 가 `undefined` 인 것과 `npm publish <tgz> --access public --dry-run` 의
    대상 레지스트리 확인 → 사용자가 자기 터미널에서 `npm login` 후 core, cli 순서로
    `npm publish <tgz> --access public`(OTP).
  - 결과: `@erdd/core@0.3.0`, `@erdd/cli@0.4.0` 이 공개 npm `latest`. 레지스트리의 `dist.integrity` 가 로컬
    tarball 의 sha512 와 일치한다. **이 두 버전에는 provenance 가 없다**(OIDC 가 아니다).
- [x] **실패한 `cli-v0.4.0` release 실행은 다시 돌리지 않는다.** 이미 손으로 올린 버전을 또 올리려다 죽을
  뿐이다. 다음 릴리스부터 CI 가 게시한다.

## 6. trusted publishing 으로 넘긴다

- [x] npmjs.com 에서 `@erdd/core`·`@erdd/cli` **각각** Settings → Trusted Publisher → 「Set up connection」:
  Publisher GitHub Actions, Organization or user `jang2162`, Repository `erdd`, Workflow filename
  `release.yml`, Environment name 비움, **「Allow `npm publish`」 체크**(안 하면 staged publish 만 허용돼
  `release.yml` 의 `npm publish` 가 거절된다). 칸과 이유는 release.md 「trusted publishing 과 provenance」.
- [x] 두 패키지의 Publishing access 를 「Require two-factor authentication and disallow bypass 2fa tokens
  (recommended)」로 두고 「Update Package Settings」로 저장했다(연결과 별도 버튼이다).
- [x] **GitHub 시크릿 `NPM_TOKEN` 을 지웠고**(`gh secret list` 0건) **npm 쪽 토큰도 삭제했다.**

## 7. 확인하고 이 문서를 지운다

- [x] **공개 npm 설치를 확인했다.** 빈 디렉터리에서 `pnpm add -D @erdd/cli tsx`(pnpm 10.33.0) →
  `pnpm exec erdd --help`·`erdd init --local`·`erdd validate` 정상(종료 코드 `0`), `erdd serve --no-open` 의
  `/` 가 302 → `/p/<id>` 200 + HTML(동봉 웹 번들). npm(비-pnpm)·전역 설치·`npx @erdd/cli`·Windows 는 하지 않았다.
- [x] 그 결과를 `docs/manual/cli-guide.md`·`local-guide.md` 의 검증 부록에 반영했다.
- [ ] **다음 릴리스(예: `cli-v0.4.1`)가 토큰 없이 게시되는지 본다** — 이것이 OIDC 게시의 첫 실측이다.
  - 로그의 「토큰 폴백 설정」이 「NPM_TOKEN 시크릿이 없습니다 — trusted publishing(OIDC)만 씁니다.」를 찍는다.
  - 「받은 cli-v* 태그 목록」에 옛 여섯 + `cli-v0.4.0` + 새 태그가 찍힌다.
  - core 를 고치지 않았으면 core 단계가 「이미 있다 — 건너뜁니다」 계열로 넘어가고(가드 3 의 첫 실측),
    고쳤으면 core 의 version 을 올렸어야 한다. cli 가 provenance 와 함께 올라간다.
  - 거절되면 6단계의 값(Workflow filename·Environment name·「Allow `npm publish`」)을 먼저 의심한다.
- [ ] 위가 끝나면 **이 파일과 `CLAUDE.md` 의 목차 줄을 지운다.** 그때까지 알게 된 것 중 지속 규칙이 있으면
  release.md 로 올린다(릴리스 정본의 「알려진 한계」에서 「OIDC 게시가 아직 실측되지 않았다」도 걷는다).
