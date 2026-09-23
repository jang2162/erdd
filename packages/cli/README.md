# @erdd/cli

ERDD 는 **ER 모델을 저장소 안의 YAML 파일로 두고 브라우저 GUI 로 편집하는** 도구다. 테이블 하나가
파일 하나라 스키마 변경이 PR diff 에서 그대로 읽히고, AI 에이전트도 마이그레이션이나 ORM 코드를
뒤질 것 없이 그 파일을 읽는다. 이 패키지는 그 명령줄 도구 `erdd` 이며, **서버 없이 혼자 쓰는 로컬
모드**와 **여러 사람이 ERDD 서버를 두고 함께 쓰는 서버 모드**를 모두 담는다. 브라우저 에디터
화면도 패키지 안에 동봉돼 있어 따로 빌드하지 않아도 `erdd serve` 가 그대로 뜬다.

## 설치

`@erdd/cli` 와 `@erdd/core` 는 **공개 npm**(registry.npmjs.org)에 있다. 따로 할 레지스트리 설정은 없다.
**Node.js 22 이상**이 필요하다(두 패키지 모두 `engines.node: ">=22"` 라, 맞지 않는 Node 면 패키지
관리자가 경고하거나 막는다).

```bash
# tsx 를 함께 적는다(아래 ⚠️)
pnpm add -D @erdd/cli tsx
# npm 이면
npm install -D @erdd/cli tsx
```

설치하면 `node_modules/.bin/erdd` 가 생겨 `pnpm exec erdd …`(npm 이면 `npx erdd …`)로 부른다.
`@erdd/core` 는 의존성으로 따라 들어온다.

> ⚠️ **소비처 tsconfig 의 `target` 은 `ES2022` 이상이어야 한다.** `@erdd/core` 도 원본 TypeScript 를
> 그대로 배포하므로, 그 패키지를 `import` 하면 소비처가 그 `.ts` 소스를 자기 tsconfig 로
> 타입체크한다. `target` 이 낮으면 **소비처 코드가 아니라 `node_modules/@erdd/core/src/**` 에서**
> 오류가 난다(`ES2020` 에서 25건 실측). `skipLibCheck` 도 `exclude` 도 회피가 안 된다 — 근거와
> 실측 표는 [`@erdd/core` README](../core/README.md) 에 있다. CLI 만 쓰고 `@erdd/core` 를
> `import` 하지 않는다면 해당 없다.

> ⚠️ **`tsx` 를 빼면 안 된다.** 이 패키지에는 빌드 산출물이 아니라 **원본 TypeScript 가 그대로**
> 들어 있고 바이너리의 셰방이 `#!/usr/bin/env -S npx tsx` 다. **`@erdd/cli` 가 `tsx` 를 대신
> 끌어오지 않으므로** 소비처가 자기 프로젝트에 직접 선언해야 한다.
>
> 빠뜨렸을 때의 **증상은 패키지 관리자마다 다르다.** 셰방이 `npx` 를 거치므로 **`npx` 가 그때그때
> `tsx` 를 받아 와 대개는 그냥 돈다** — 대신 첫 실행이 느려지고 레지스트리 접근에 기댄다. 네트워크가
> 없으면 죽고, npm 평면 배치는 캐시가 없으면 `ENOTCACHED` 로 죽는다. **명시 선언이 어느 패키지
> 관리자에서나 보증되는 유일한 경로다.**

## 두 갈래로 쓴다

|  | **로컬 모드** | **서버 모드** |
|---|---|---|
| 언제 | 혼자 설계한다. 붙을 서버가 없거나 세우고 싶지 않다 | 여러 사람이 같은 프로젝트를 동시에 편집한다 |
| 진실 원천 | `erdd/` 파일 | 서버 DB (로컬 파일은 작업 사본) |
| 필요한 것 | 이 패키지뿐 — 계정도 DB 도 없다 | 그 위에 ERDD 서버와 액세스 토큰 |
| 편집 이력 | **git 커밋** | 서버 Revision (+ git) |
| 배치 좌표·메모 | `erdd/layout.yaml` (커밋한다) | 서버 DB. 단, `erdd serve` 로 옮기면 그 좌표·메모는 `erdd/layout.yaml` 에 쌓인다 (아래 ⚠️) |

**둘은 배타가 아니다.** 서버에 연결된 프로젝트도 `erdd serve` 로 열어 그림으로 다듬을 수 있다.

> ⚠️ **`erdd/layout.yaml` 이 생기는 기준은 모드가 아니라 `erdd serve` 를 쓰느냐다.** 서버에 연결된
> 프로젝트도 `serve` 화면에서 테이블을 옮기거나 메모를 쓰면 그 파일이 생기고 갱신된다. 안에 배치
> 좌표뿐 아니라 **메모 본문**이 들어 있으니 잔재로 보고 지우지 말고 **커밋한다.** 다만 **서버와
> 오가지는 않는다** — `push` 가 보내지도 `pull` 이 덮어쓰지도 않는다. 서버 DB 쪽 배치는 웹 에디터에서
> 따로 다룬다.

### 로컬 모드 — 서버·계정·DB 없이

```bash
erdd init --local          # erdd.config.yaml 을 만든다 (serverUrl·projectId 는 null)
erdd serve                 # http://127.0.0.1:4300 에 에디터가 뜬다 — 로그인 화면은 없다
                           # 화면의 편집은 「저장」(Cmd+S)을 눌러야 erdd/ 파일이 된다
# ... 브라우저에서 편집하고 Cmd+S 로 저장한다 ...
erdd validate              # 참조 무결성·명명 규칙 검사
git add erdd erdd.config.yaml && git commit -m "스키마: 회원 등급 컬럼 추가"
```

이 커밋이 로컬 모드의 **이력 전부**다. 되돌리기는 `git revert`, 비교는 `git diff` 다.

### 서버 모드 — 팀이 함께

```bash
erdd init                  # 서버 URL·토큰·프로젝트를 묻는다
erdd pull                  # 서버 스키마를 파일로 받는다 (로컬 변경을 덮어쓴다)
# ... erdd/ 아래 파일을 편집 ...
erdd validate              # 서버를 부르지 않는 사전 검사
erdd diff                  # 올릴 변경 · 내려올 변경 · 충돌을 미리 본다
erdd push -m "회원 등급 컬럼 추가"
```

## 명령

| 명령 | | 모드 |
|---|---|---|
| `erdd init` | 서버에 연결한다 (URL·토큰·프로젝트). 비대화형이면 `--server` · `--token` · `--project`, 기존 config 덮어쓰기는 `--yes` | 서버 |
| `erdd init --create` | 서버에 프로젝트를 만들어 연결한다 (`--org` · `--name`). 로컬 전용 프로젝트면 `erdd/` 를 그대로 두고 이관한다 — 이어서 `diff` → `push` | 서버 |
| `erdd init --local` | 서버 없는 로컬 전용 프로젝트를 만든다 (`--dialect` · `--case`) | 로컬 |
| `erdd serve` | 로컬 서버를 띄워 브라우저에서 편집한다 (`--port` · `--no-open`) | 둘 다 |
| `erdd validate` | 서버 없이 참조 무결성·명명 규칙을 검사한다 (`--strict`) | 둘 다 |
| `erdd export` | 로컬 파일을 DDL·DBML 로 내보낸다 (`--format` · `--dialect` · `-o`). 본문만 stdout, 경고는 stderr | 둘 다 |
| `erdd import <파일>` | DDL·DBML 파일을 로컬 파일에 **머지**한다 (`--format` · `--dialect` · `--dry-run`). 서버 반영은 `push` | 둘 다 |
| `erdd status` | 서버를 부르지 않고 연결 정보와 로컬 변경만 본다 | 둘 다 |
| `erdd pull` | 서버 스키마를 파일로 받는다 | **서버 전용** |
| `erdd diff` | 올릴 변경·내려올 변경·충돌을 미리 본다 (`--strict`) | **서버 전용** |
| `erdd push` | 서버에 반영한다 (3-way 병합, 충돌이면 중단) | **서버 전용** |
| `erdd dict list·pull·push·requests` | 조직·전역 공용 사전을 받고(`pull` → `erdd/origins.yaml` 에 출처) 올린다(`push` — 권한이 없으면 승격 요청) | **서버 전용** |
| `erdd skill install` | 에이전트 스킬 문서를 프로젝트에 깐다 (`--dir` · `--force`) | 둘 다 |

⚠️ **로컬 전용 프로젝트에서 `pull`·`push`·`diff` 는 종료 코드 `1` 로 멈춘다** — 부를 서버가 없기
때문이다(`erdd.config.yaml에 연결 설정이 없습니다 …`). 로컬 모드에서 그 셋의 자리를 맡는 것은 git 이다.
`status` 는 로컬 모드에서도 돌지만 비교 기준선(마지막 pull 시점)이 없어 언제나 「로컬 변경 없음」이다.

전체 사용법과 플래그 목록은 `erdd --help`(`-h`) 로 본다.

## AI 에이전트와 함께 쓰기

```bash
erdd skill install                 # → .claude/skills/erdd/SKILL.md
```

동봉된 스킬 문서가 깔린다. **그 문서는 두 모드를 모두 다룬다** — 에이전트가 맨 먼저
`erdd.config.yaml` 의 `serverUrl` 로 모드를 판별하고, 그에 맞는 워크플로(서버 모드는 `pull`→`push`,
로컬 모드는 파일 편집 + git 커밋)와 금지 사항을 따르게 돼 있다. 설치 위치는 `--dir` 로 바꾼다.

**MCP 서버는 제공하지 않는다.** 에이전트 연동은 이 CLI + 스킬 문서 조합이다.

## 더 읽을 것

이 패키지에 매뉴얼 네 편이 함께 들어 있다. 아래 링크는 **설치본의 파일 트리
(`node_modules/@erdd/cli/docs/`)에서만** 열린다 — npmjs.com 의 패키지 페이지나 GitHub 저장소에서는
그 경로가 비어 있는 것이 정상이다(문서는 팩할 때 저장소의 `docs/manual/` 에서 복사해 넣는다).

- [로컬 모드 매뉴얼](./docs/local-guide.md) — 서버 없이 쓰는 길을 처음부터 끝까지. **로컬 모드로만
  쓸 생각이면 이 문서 하나로 끝난다**
- [CLI 매뉴얼](./docs/cli-guide.md) — 명령 하나하나의 레퍼런스, 파일 포맷, 충돌 처리, CI
- [사용 매뉴얼](./docs/user-guide.md) — 브라우저 에디터 조작법 (두 모드가 같은 화면이다)
- [설치·운영 매뉴얼](./docs/install.md) — ERDD **서버**를 세우고 운영하는 쪽. 로컬 모드에는 필요 없다

## 자동화

모든 명령이 `--json` 을 지원한다 — stdout 은 항상 파싱 가능한 JSON 이고 진행 메시지는 stderr 로
나간다. 확인 프롬프트는 `--yes` 로 건너뛴다. 종료 코드는 `0` 성공 · `1` 실패(검증 실패·충돌·서버
오류·취소) · `2` 사용법 오류다.
