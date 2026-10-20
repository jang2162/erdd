<!-- source: packages/cli/README.md @ v0.6.0 -->
<p><a href="README.md">English</a> | <b>한국어</b></p>

# @erdd/cli

ERDD 는 **ER 모델을 저장소 안의 YAML 파일로 두고 브라우저 GUI 로 편집하는** 도구입니다. 테이블 하나가
파일 하나라서 스키마 변경이 PR diff 에서 그대로 읽힙니다. AI 에이전트도 마이그레이션이나 ORM 코드를
뒤지지 않고 그 파일을 읽습니다. 이 패키지는 그 명령줄 도구 `erdd` 입니다. **서버 없이 혼자 쓰는 로컬
모드**와 **여러 사람이 ERDD 서버를 두고 함께 쓰는 서버 모드**를 모두 담고 있습니다. 브라우저 에디터
화면도 패키지 안에 동봉되어 있어 따로 빌드하지 않아도 `erdd serve` 가 그대로 뜹니다.

## 설치

`@erdd/cli` 와 `@erdd/core` 는 **공개 npm**(registry.npmjs.org)에 있습니다. 따로 할 레지스트리 설정은
없습니다. **Node.js 22 이상**이 필요합니다. 두 패키지 모두 `engines.node: ">=22"` 를 선언하므로, 맞지 않는
Node 에서는 패키지 관리자가 경고하거나 설치를 막습니다.

```bash
# Declare tsx alongside (see the warning below)
pnpm add -D @erdd/cli tsx
# with npm
npm install -D @erdd/cli tsx
```

설치하면 `node_modules/.bin/erdd` 가 생깁니다. `pnpm exec erdd …`(npm 이면 `npx erdd …`)로 실행하세요.
`@erdd/core` 는 의존성으로 함께 설치됩니다.

> [!WARNING]
> **`@erdd/core` 를 `import` 한다면 tsconfig 의 `target` 은 `ES2022` 이상이어야 합니다.** `@erdd/core` 도
> 원본 TypeScript 를 그대로 배포합니다. 그 패키지를 `import` 하면 여러분의 프로젝트가 그 `.ts` 소스를 자기
> tsconfig 로 타입체크합니다. `target` 이 낮으면 **여러분의 코드가 아니라 `node_modules/@erdd/core/src/**`
> 에서** 오류가 납니다(`ES2020` 에서 25건 실측). `skipLibCheck` 로도 `exclude` 로도 피할 수 없습니다. 근거와
> 실측 표는 [`@erdd/core` README](../core/README.ko.md) 에 있습니다. CLI 만 쓰고 `@erdd/core` 를 `import`
> 하지 않는다면 해당하지 않습니다.

> [!WARNING]
> **`tsx` 를 빼면 안 됩니다.** 이 패키지에는 **빌드 산출물이 아니라 원본 TypeScript 가 그대로** 들어 있고,
> 바이너리의 셰뱅이 `#!/usr/bin/env -S npx tsx` 입니다. **`@erdd/cli` 는 `tsx` 를 대신 설치하지 않으므로**
> 여러분의 프로젝트에 직접 선언해야 합니다.
>
> **빠뜨렸을 때의 증상은 패키지 관리자마다 다릅니다.** 셰뱅이 `npx` 를 거치므로 **대개는 `npx` 가 그때그때
> `tsx` 를 받아 와서 그냥 실행됩니다.** 대신 첫 실행이 느려지고 레지스트리 접근에 기대게 됩니다. 네트워크가
> 없으면 실패하고, npm 평면 배치에서 캐시가 없으면 `ENOTCACHED` 로 실패합니다. **어느 패키지 관리자에서나
> 보장되는 방법은 명시 선언뿐입니다.**

## 두 갈래로 씁니다

|                | **로컬 모드**                                            | **서버 모드**                                                                                      |
| -------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 언제           | 혼자 설계합니다. 붙을 서버가 없거나 세우고 싶지 않습니다 | 여러 사람이 같은 프로젝트를 동시에 편집합니다                                                      |
| 진실 원천      | `erdd/` 파일                                             | 서버 DB (로컬 파일은 작업 사본)                                                                    |
| 필요한 것      | 이 패키지뿐입니다. 계정도 DB 도 없습니다                 | 그 위에 ERDD 서버와 액세스 토큰                                                                    |
| 편집 이력      | **git 커밋**                                             | 서버 Revision (+ git)                                                                              |
| 배치 좌표·메모 | `erdd/layout.yaml` (커밋합니다)                          | 서버 DB. 단, `erdd serve` 로 옮기면 그 좌표·메모는 `erdd/layout.yaml` 에 쌓입니다 (아래 경고 참고) |

**둘은 배타적이지 않습니다.** 서버에 연결된 프로젝트도 `erdd serve` 로 열어 다이어그램을 다듬을 수 있습니다.

> [!WARNING]
> **`erdd/layout.yaml` 이 생기는 기준은 모드가 아니라 `erdd serve` 를 쓰느냐입니다.** 서버에 연결된
> 프로젝트도 `serve` 화면에서 테이블을 옮기거나 메모를 쓰면 그 파일이 생기고 갱신됩니다. 안에 배치 좌표뿐
> 아니라 **메모 본문**이 들어 있으니 잔재로 보고 지우지 말고 **커밋하세요.** 다만 **서버와 오가지는
> 않습니다.** `push` 가 보내지도 않고 `pull` 이 덮어쓰지도 않습니다. 서버 DB 쪽 배치는 웹 에디터에서 따로
> 다룹니다.

### 로컬 모드: 서버·계정·DB 없이

```bash
erdd init --local          # creates erdd.config.yaml (serverUrl and projectId are null)
erdd serve                 # opens the editor at http://127.0.0.1:4300 with no login screen
                           # edits become erdd/ files only when you press Save (Cmd+S)
# ... edit in the browser and save with Cmd+S ...
erdd validate              # checks referential integrity and naming rules
git add erdd erdd.config.yaml && git commit -m "스키마: 회원 등급 컬럼 추가"
```

이 커밋이 로컬 모드의 **이력 전부**입니다. 되돌리기는 `git revert`, 비교는 `git diff` 로 합니다.

### 서버 모드: 팀이 함께

```bash
erdd init                  # asks for the server URL, token, and project
erdd pull                  # writes the server schema to files (overwrites local changes)
# ... edit files under erdd/ ...
erdd validate              # pre-check without calling the server
erdd diff                  # previews outgoing changes, incoming changes, and conflicts
erdd push -m "회원 등급 컬럼 추가"
```

## 명령

| 명령                                | 하는 일                                                                                                                                  | 모드          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `erdd init`                         | 서버에 연결합니다 (URL·토큰·프로젝트). 비대화형이면 `--server` · `--token` · `--project`, 기존 config 덮어쓰기는 `--yes`                 | 서버          |
| `erdd init --create`                | 서버에 프로젝트를 만들어 연결합니다 (`--org` · `--name`). 로컬 전용 프로젝트면 `erdd/` 를 그대로 두고 이관합니다. 이어서 `diff` → `push` | 서버          |
| `erdd init --local`                 | 서버 없는 로컬 전용 프로젝트를 만듭니다 (`--dialect` · `--case`)                                                                         | 로컬          |
| `erdd serve`                        | 로컬 서버를 띄워 브라우저에서 편집합니다 (`--port` · `--no-open`)                                                                        | 둘 다         |
| `erdd validate`                     | 서버 없이 참조 무결성·명명 규칙을 검사합니다 (`--strict`)                                                                                | 둘 다         |
| `erdd export`                       | 로컬 파일을 DDL·DBML 로 내보냅니다 (`--format` · `--dialect` · `-o`). 본문만 stdout, 경고는 stderr 로 나갑니다                           | 둘 다         |
| `erdd import <파일>`                | DDL·DBML 파일을 로컬 파일에 **머지**합니다 (`--format` · `--dialect` · `--dry-run`). 서버 반영은 `push` 로 합니다                        | 둘 다         |
| `erdd status`                       | 서버를 부르지 않고 연결 정보와 로컬 변경만 봅니다                                                                                        | 둘 다         |
| `erdd pull`                         | 서버 스키마를 파일로 받습니다                                                                                                            | **서버 전용** |
| `erdd diff`                         | 올릴 변경·내려올 변경·충돌을 미리 봅니다 (`--strict`)                                                                                    | **서버 전용** |
| `erdd push`                         | 서버에 반영합니다 (3-way 병합, 충돌이면 중단)                                                                                            | **서버 전용** |
| `erdd dict list·pull·push·requests` | 조직·전역 공용 사전을 받고(`pull` 은 `erdd/origins.yaml` 에 출처를 남깁니다) 올립니다(`push` 는 권한이 없으면 승격 요청을 보냅니다)      | **서버 전용** |
| `erdd skill install`                | 에이전트 스킬 문서를 프로젝트에 설치합니다 (`--dir` · `--force`)                                                                         | 둘 다         |

> [!WARNING]
> **로컬 전용 프로젝트에서 `pull`·`push`·`diff` 는 종료 코드 `1` 로 멈춥니다.** 부를 서버가 없기
> 때문입니다(`erdd.config.yaml에 연결 설정이 없습니다 …`). 로컬 모드에서 그 셋의 자리를 맡는 것은 git
> 입니다. `status` 는 로컬 모드에서도 실행되지만 비교 기준선(마지막 pull 시점)이 없어 언제나 「로컬 변경
> 없음」을 보고합니다.

전체 사용법과 플래그 목록은 `erdd --help`(`-h`) 로 확인하세요.

## AI 에이전트와 함께 쓰기

```bash
erdd skill install                 # → .claude/skills/erdd/SKILL.md
```

동봉된 스킬 문서가 설치됩니다. **그 문서는 두 모드를 모두 다룹니다.** 에이전트는 맨 먼저
`erdd.config.yaml` 의 `serverUrl` 로 모드를 판별합니다. 그다음 그에 맞는 워크플로(서버 모드는
`pull` → `push`, 로컬 모드는 파일 편집 + git 커밋)와 금지 사항을 따릅니다. 설치 위치는 `--dir` 로
바꿉니다.

**MCP 서버는 제공하지 않습니다.** 에이전트 연동은 이 CLI 와 스킬 문서의 조합입니다.

## 문서

이 패키지에 매뉴얼 네 편이 영어 원본과 한국어 번역본으로 함께 들어 있습니다. 아래 링크는 **설치본의
파일 트리(`node_modules/@erdd/cli/docs/`)에서만** 열립니다. npmjs.com 의 패키지 페이지나 GitHub
저장소에서는 그 경로가 비어 있는 것이 정상입니다. 매뉴얼은 패키지를 팩할 때 저장소의
`docs/manual/en/`·`docs/manual/ko/` 에서 복사해 넣습니다.

- [로컬 모드 매뉴얼](./docs/ko/local-guide.md): 서버 없이 쓰는 길을 처음부터 끝까지 다룹니다. **로컬
  모드로만 쓸 생각이면 이 문서 하나로 충분합니다**
- [CLI 매뉴얼](./docs/ko/cli-guide.md): 명령 하나하나의 레퍼런스, 파일 포맷, 충돌 처리, CI
- [사용 매뉴얼](./docs/ko/user-guide.md): 브라우저 에디터 조작법 (두 모드가 같은 화면입니다)
- [설치·운영 매뉴얼](./docs/ko/install.md): ERDD **서버**를 세우고 운영하는 방법입니다. 로컬 모드에는
  필요하지 않습니다

## 자동화

모든 명령이 `--json` 을 지원합니다. stdout 은 항상 파싱 가능한 JSON 이고 진행 메시지는 stderr 로
나갑니다. 확인 프롬프트는 `--yes` 로 건너뜁니다. 종료 코드는 `0` 성공 · `1` 실패(검증 실패·충돌·서버
오류·취소) · `2` 사용법 오류입니다.

## 라이선스

MIT License. 자세한 내용은 [LICENSE](LICENSE) 를 확인하세요.
