# 첫 공개 게시 체크리스트 — 저장소 공개와 npm 첫 게시

**⚠️ 이 문서는 `ops/` 다 — 일회성이다.** 첫 공개 게시가 끝나고 그다음 릴리스가 토큰 없이(trusted publishing
만으로) 게시되는 것까지 확인되면 **이 파일을 지우고 `CLAUDE.md` 의 이 문서를 가리키는 목차 줄도 함께 지운다.**

게시 절차·가드·게시 경로의 **지속 규칙은 [../guides/release.md](../guides/release.md) 가 정본이다**
(「첫 게시 — 패키지가 아직 없을 때」「trusted publishing 과 provenance」「손 게시(CI 밖)」). 여기 적는 것은
이 저장소가 공개로 넘어가는 **한 번**에만 필요한 순서와 조건이다. 위에서부터 차례로 한다.

---

## 0. 전제 — 이미 되어 있는 것

- [ ] **첫 공개 게시 버전은 `@erdd/core` 0.3.0 · `@erdd/cli` 0.4.0 이다**(두 `package.json` 에 반영돼 있다).
  - cli 를 올린 이유: `cli-v0.1.0` … `cli-v0.3.3` 태그가 이미 있어 그 버전으로는 태그를 새로 달 수 없다.
  - core 를 올린 이유: `packages/core` 가 직전 태그 `cli-v0.3.3` 이후 바뀌었다. version 이 그대로(0.2.0)이면
    첫 실행이 core 게시까지 성공하고 cli 에서 죽은 뒤 **재시도하는 순간 core 버전 누락 가드(가드 3)가
    발동해 그 태그로는 다시 성공할 수 없다.** 0.3.0 이면 직전 태그의 0.2.0 과 달라 가드가 통과한다.
  - 옛 레지스트리에 있던 `@erdd/core@0.2.0` 과 지금의 0.2.0 은 내용이 다르다 — 같은 번호를 공개 npm 에
    다른 내용으로 올리지 않는 것도 이 선택의 이유다.
  - 병합 전에 `packages/core` 를 더 고쳐도 다시 올릴 필요는 없다(0.3.0 은 아직 어디에도 게시되지 않았다).

## 1. 이 머신과 옛 사용자 쪽 정리

- [ ] **이 머신의 사용자 npm 설정에서 `@erdd` 스코프 레지스트리를 지운다.**
  `npm config get @erdd:registry` 가 옛 레지스트리 주소를 낸다. 남아 있으면 `npm view`·`npm install`·
  `npm publish` 가 전부 그쪽으로 간다(스코프 설정이 `--registry` 를 이긴다 — 실측).
  `npm config delete @erdd:registry` 로 지우고, 같은 파일(`npm config get userconfig`)에 남은 옛 레지스트리
  인증 토큰 줄도 지운다. 확인: `npm config get @erdd:registry` → `undefined`.
- [ ] **옛 레지스트리에서 설치하던 소비처 프로젝트에 알린다.** 그 프로젝트에 커밋된 `.npmrc` 의
  `@erdd:registry=…` 줄이 계속 옛 레지스트리를 가리킨다 — 그 줄을 지워야 공개 npm 에서 받는다.
  지우고 나면 `pnpm add -D @erdd/cli@^0.4.0 tsx` 로 올린다(0.4.0 부터가 공개 npm 판이다).

## 2. npm 쪽 준비

- [ ] **npm 조직 `erdd` 를 확인하거나 만든다**(`@erdd` 스코프의 소유자다). 이미 남이 쓰고 있으면 여기서
  멈춘다 — 스코프를 바꾸는 것은 패키지 이름·문서 전체가 걸린 별도 결정이다.
- [ ] **Granular Access Token 을 만든다** — 스코프 `@erdd` 에 Read and write, 만료는 짧게. 계정의 쓰기
  2FA 가 켜져 있으면 「Bypass two-factor authentication」을 켜야 CI 가 쓸 수 있다.

## 3. GitHub 저장소

- [ ] **`jang2162/erdd` 를 공개(public)로 만든다.** 비공개면 두 가지가 깨진다 — provenance 게시가 거절되고,
  publish 잡의 태그 fetch 가 자격증명 없이 돌아 실패한다(`persist-credentials: false`).
- [ ] 원격을 더한다: `git remote add github https://github.com/jang2162/erdd.git`
  (지금 `origin` 은 옛 저장소다. 이름은 자유지만 아래 명령은 `github` 로 적는다.)
- [ ] Actions 시크릿 `NPM_TOKEN` 에 2단계의 토큰을 넣는다.
- [ ] **(선택) 게시 권한을 좁힌다.** 지금은 쓰기 권한이 있는 누구나 `cli-v*` 태그를 밀어 게시할 수 있다.
  - 태그 ruleset 으로 `cli-v*` 생성을 관리자에게만 허용한다. 워크플로 변경이 없다.
  - 또는 publish 잡에 `environment: <이름>`(필수 리뷰어)을 붙인다. **이때는 6단계의 trusted publisher
    environment 칸에 같은 이름을 넣어야 한다** — 한쪽만 있으면 OIDC 게시가 거절된다
    (release.md 「trusted publishing 과 provenance」). environment 를 쓸 거면 **첫 태그 전에** 워크플로에 넣는다.

## 4. 병합과 push — 병합 직후 바로 첫 게시까지 간다

매뉴얼과 README 가 「공개 npm 에 있다」를 전제하고 루트 README 가 npmjs.com 패키지 페이지를 링크한다.
**병합부터 첫 게시까지가 그 문장이 거짓인 창이다** — 병합한 날 5단계까지 끝낸다.

- [ ] `chore/public-release` 를 main 에 병합한다.
- [ ] `git push github main` — `ci.yml` 이 main push 로 돈다. **초록인지 확인한다**(verify·server 두 잡).
- [ ] **옛 태그를 새 태그와 따로, 먼저 한 번에 push 한다.**
  ```bash
  git push github cli-v0.1.0 cli-v0.2.0 cli-v0.3.0 cli-v0.3.1 cli-v0.3.2 cli-v0.3.3
  git ls-remote --tags github 'cli-v*'      # 여섯이 보여야 한다
  ```
  - **왜 올리나(권장):** 릴리스 이력을 GitHub 에도 남기고, 5단계 로그의 태그 목록으로 「publish 잡의 태그
    fetch 가 실제로 됐는가」를 판정할 수 있게 한다(일곱이 보이면 됐다). 올리지 않아도 이번 게시는 깨지지
    않는다 — 가드 3 이 `cli-v0.4.0` 에서 「직전 태그 없음(첫 태그)」으로 검사를 건너뛰는데, core 0.3.0 은
    어디에도 없던 새 버전이라 건너뛰어도 무해하다. 다음 릴리스부터는 `cli-v0.4.0` 이 기준이 된다.
  - **왜 따로인가:** GitHub 은 **한 번의 push 에 태그가 셋을 넘으면 태그 이벤트를 만들지 않는다**
    (GitHub Docs 「Events that trigger workflows」 의 `push` 절). 여섯을 한 번에 올리면 이벤트가 없어 아무것도
    돌지 않는다 — 옛 태그 커밋에는 `release.yml` 도 없다. 반대로 **새 태그를 이 묶음에 섞으면 새 태그의 게시도
    시작되지 않는다.** `git push --tags`·`--follow-tags` 로 새 태그까지 한꺼번에 보내지 마라.

## 5. 첫 게시

- [ ] 새 태그를 **혼자** push 한다.
  ```bash
  git tag cli-v0.4.0 <main 의 병합 커밋> && git push github cli-v0.4.0
  ```
- [ ] 실행 로그를 확인한다.
  - 「받은 cli-v* 태그 목록」에 **일곱**(옛 여섯 + `cli-v0.4.0`)이 찍힌다. 하나뿐이면 4단계의 옛 태그가
    GitHub 에 없거나 fetch 가 태그를 못 받은 것이다(`git ls-remote` 로 먼저 가른다).
  - 「토큰 폴백 설정」이 「NPM_TOKEN 시크릿이 있습니다」를 찍는다.
  - core 단계가 `@erdd/core@0.3.0 를 게시합니다.` 를 찍고 게시한다. cli 단계가 `@erdd/cli@0.4.0` 을 게시한다.
- [ ] core 는 올라갔는데 cli 에서 죽었다면 **7일 안에** 「Re-run failed jobs」로 다시 돌린다. 가드 3 은
  `0.2.0 ≠ 0.3.0` 이라 통과하고 core 는 「이미 있다 — 건너뜁니다」로 넘어간다.

## 6. trusted publishing 으로 넘긴다

- [ ] npmjs.com 에서 `@erdd/core`·`@erdd/cli` **각각** Settings → Trusted Publisher → GitHub Actions:
  소유자 `jang2162`, 저장소 `erdd`, 워크플로 `release.yml`, environment 는 비움(3단계에서 environment 를 붙였다면
  **같은 이름**). npm 은 저장할 때 검증하지 않는다 — 오타는 다음 게시에서야 드러난다.
- [ ] **GitHub 시크릿 `NPM_TOKEN` 을 지우고 npm 에서 그 토큰을 폐기한다.**
- [ ] 두 패키지의 Publishing access 를 「Require two-factor authentication and disallow tokens」로 올린다.

## 7. 확인하고 이 문서를 지운다

- [ ] **공개 npm 설치를 확인한다.** 빈 디렉터리에서 `pnpm add -D @erdd/cli tsx` → `pnpm exec erdd --help`·
  `erdd init --local`·`erdd validate` 의 종료 코드 `0`, `erdd serve --no-open` 의 `/p/<id>` 가 200 + HTML.
  결과를 `docs/manual/cli-guide.md`·`local-guide.md` 의 검증 부록(「공개 npm 에서 설치해 확인하지는 않았다」
  문단)에 반영한다.
- [ ] 다음 릴리스(예: `cli-v0.4.1`)가 **토큰 없이** 게시되는지 본다 — 이것이 trusted publishing 의 첫 실측이다.
  실패하면 6단계의 값(특히 워크플로 파일 이름·environment)을 먼저 의심한다.
- [ ] 위가 끝나면 **이 파일과 `CLAUDE.md` 의 목차 줄을 지운다.** 그때까지 알게 된 것 중 지속 규칙이 있으면
  release.md 로 올린다.
