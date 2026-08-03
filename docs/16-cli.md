# CLI와 코드베이스 동기화, 에이전트 스킬

## 목적

서버(진실 원천)의 스키마를 코드베이스에 파일로 내려받아 버전 관리하고, 로컬 수정을 서버로 되밀며, AI agent가 이 CLI로 스키마를 파악·수정하는 워크플로를 제공한다. MCP 서버는 제공하지 않고 **CLI + 에이전트 스킬** 조합으로 간다.

작업은 트랙 둘로 나뉜다.

- **트랙 A(완료)**: 개인 액세스 토큰 인증, 파일 포맷, 읽기 명령(`init`/`pull`/`status`/`validate`) → [설계](superpowers/specs/2026-08-03-cli-pull-design.md)
- **트랙 B(예정)**: `push`, 3-way 병합, `diff`, 에이전트 스킬

## 사용자 시나리오

- 개발자가 `erdd pull`로 최신 스키마를 받아 커밋한다. PR 리뷰에서 스키마 변경이 코드와 함께 보인다.
- AI agent가 기능 구현 전에 `erdd/` 디렉터리의 테이블 파일을 읽어 DB 구조를 파악한다.
- (트랙 B) agent가 새 테이블 파일을 작성하고 `erdd diff`로 확인한 뒤 `erdd push`로 서버에 반영한다. 설계자가 웹에서 이어서 다듬는다.

## 기능 상세

### 패키지와 명령

npm 패키지 `@erdd/cli`, 바이너리 `erdd`. Node 실행 환경에서 실행한다(현재는 워크스페이스 안에서 실행하는 형태이고, npm 공개 배포 파이프라인은 아직 없다 — 6절 이월 참조).

| 명령 | 동작 | 상태 |
|---|---|---|
| `init` | 서버·토큰·프로젝트를 연결하고 `erdd.config.yaml`을 만든다 | 구현됨 |
| `pull` | 서버 스키마를 로컬 파일로 내려받기(로컬 변경 덮어씀 — 확인 프롬프트, `--yes`로 건너뜀) | 구현됨 |
| `status` | 연결 정보, 마지막 pull 리비전, 로컬 변경 유무(서버 호출 없음) | 구현됨 |
| `validate` | 로컬 파일의 스키마 정합성·명명 경고 검사(서버 호출 없이) | 구현됨 |
| `push` | 로컬 파일의 변경을 서버에 반영 | 트랙 B |
| `diff` | 로컬 파일 ↔ 서버 차이 출력(`--base`로 마지막 pull 시점 기준 3-way 요약) | 트랙 B |
| `skill install` | 에이전트 스킬 파일을 프로젝트에 설치 | 트랙 B |

- **인증: 개인 액세스 토큰(PAT).** "내 계정" 설정 화면(`AccessTokensCard`, `apps/web/src/pages/settings-tokens.tsx`)에서 발급하고, 평문은 발급 응답에서 **한 번만** 표시된다. 이는 조직·프로젝트 역할과 별개인 새 권한 축이 아니다 — 권한은 토큰을 발급한 사용자의 기존 조직·프로젝트 역할에서 그대로 파생된다. Viewer가 만든 토큰은 Viewer 권한만 갖고, 그 사용자가 프로젝트 멤버에서 빠지면 토큰도 자동으로 그 프로젝트에 접근하지 못한다(별도 회수 절차가 필요 없다). 토큰에 만료는 없고 폐기만 가능하다.
- **토큰이 호출할 수 있는 프로시저는 서버가 명시적으로 허용한(allowlist) 것뿐이다.** 새 tRPC 프로시저의 기본은 세션 전용이라(→ [HANDOFF 3절](superpowers/HANDOFF.md)), 프로시저를 추가해도 토큰에 저절로 열리지 않는다. 트랙 A가 여는 것은 `auth.me`·`org.list`·`project.list`·`project.get`·`model.get` 5개뿐이며, 트랙 B에서 `model.mutate`·`revision.list`가 추가될 예정이다.
- 환경 변수 `ERDD_TOKEN`이 있으면 그것을 쓰고, 없으면 `init`이 저장한 `.erdd/credentials.json`을 쓴다(환경 변수가 우선).
- 출력은 사람용 텍스트와 `--json`(agent·스크립트용)을 모두 지원한다. 진행 메시지·프롬프트는 stderr로 나가 `--json`일 때 stdout이 항상 파싱 가능한 JSON이 되도록 한다. 종료 코드는 `0` 성공 · `1` 실패(검증 실패·서버 오류·사용자 취소) · `2` 사용법 오류.

### 파일 포맷

git diff 친화성과 agent의 부분 편집 편의를 위해 **분할 YAML**을 쓴다. `packages/core`는 IO 의존성이 없으므로(→ [HANDOFF 3.5절](superpowers/HANDOFF.md)) YAML 인코딩/디코딩은 CLI가 `yaml` 패키지로 하고, core는 plain object만 다루는 `modelToFiles`/`filesToModel`(`packages/core/src/file-format.ts`)을 제공한다.

```
erdd.config.yaml            # 프로젝트 ID·서버 URL·방언·명명 규칙 (커밋 대상)
erdd/                       # 커밋 대상
├─ tables/
│  ├─ MBR.yaml              # 테이블당 1파일, 파일명 = 물리명
│  └─ ORD.yaml
├─ groups.yaml
├─ words.yaml
├─ terms.yaml
├─ domains.yaml
└─ custom-fields.yaml
.erdd/                      # git-ignore (init이 .gitignore에 `.erdd/` 추가)
├─ base.json                # 마지막 pull 시점 모델(파일에 담은 범위 그대로) — 트랙 B 3-way 병합의 기준선
├─ sync.json                # { "revisionSeq": 42, "pulledAt": "…" }
└─ credentials.json         # { "token": "erdd_pat_…" } — ERDD_TOKEN이 있으면 그쪽이 우선
```

`erdd.config.yaml`:

```yaml
serverUrl: https://erdd.example.com
projectId: 018f6b0e-…
dialects: [postgresql, oracle]
namingRules:
  case: UPPER_SNAKE
  separator: _
  maxLengthBytes: 30
```

방언과 명명 규칙은 모델이 아니라 프로젝트 설정에 있으므로 `pull`이 매번 이 값을 config에 함께 써 갱신한다 — 그래야 `validate`가 서버 호출 없이 명명 경고를 낼 수 있다. 서버에서 이 설정을 바꾸면 다음 `pull` 전까지 로컬 `validate` 결과가 서버와 달라질 수 있다(→ 6절 이월).

테이블 파일 예(`erdd/tables/MBR.yaml`):

```yaml
id: 018f6b0e-…            # 서버 발급 UUIDv7 — 수정하지 않는다
name: MBR
logicalName: 회원
group: 회원관리
comment: 서비스 가입 회원
custom:
  개인정보여부: 'true'
columns:
  - id: 018f6b0e-…
    name: MBR_NO
    logicalName: 회원번호
    type: BIGINT
    pk: true
    nullable: false
  - id: 018f6b0e-…
    name: MBR_NM
    logicalName: 회원명
    domain: 명
    type: VARCHAR(100)
    nullable: false
indexes:
  - id: 018f6b0e-…
    name: UX_MBR_01
    columns: [MBR_NM]                     # 오름차순은 방향 생략, 내림차순은 "MBR_NM DESC"처럼 한 문자열로 적는다
    unique: true
relations:
  - id: 018f6b0e-…
    to: MBR_GRD                            # 부모 테이블. 관계는 자식 테이블 파일에만 적는다
    columns: { MBR_GRD_CD: GRD_CD }        # {자식 컬럼: 부모 컬럼}
    identifying: false
```

- 모든 객체는 서버 발급 `id`(UUIDv7)를 가진다. `group`·`domain`·`to` 같은 참조는 사람이 읽을 이름으로 쓰되 `id`도 함께 두어, 이름이 바뀌어도 삭제+추가로 오인되지 않는다(→ [02-architecture](02-architecture.md)).
- 컬럼은 `type`(논리 타입 문자열)을 항상 쓰고, 도메인이 지정돼 있으면 `domain`(도메인 이름)도 함께 쓴다. 모델이 실제로 둘 다 들고 있기 때문이다 — 도메인 지정이 기존 `type` 문자열을 지우지 않는다(`setColumnDomain`). 읽을 때 실효 타입은 도메인이 우선하고, 파일의 `type`은 도메인이 있을 때 참고값이다.
- `pk`/`autoIncrement`/`nullable`/`unique`/`identifying` 등은 값이 기본값이면 파일에서 생략해 diff를 조용하게 유지한다.
- 로컬에서 새로 만든 객체는 `id` 없이 작성한다. 트랙 A에서는 `pull`이 항상 `id`를 채우므로 이 형태는 `validate`만 받아들이고, 실제 발급(서버 반영)은 트랙 B의 `push`가 한다.
- 파일명(=테이블 물리명)은 조회 편의일 뿐 identity가 아니다. 물리명이 바뀌면 `pull`이 파일명을 갱신한다. 대소문자만 다른 두 물리명은 대소문자 무시 파일시스템(macOS·Windows)에서 충돌하므로, 그때만 `<물리명>.<id 뒤 8자>.yaml`로 갈라진다.
- 배치 좌표·`notes`·공용 리소스 `origin`은 파일에 담지 않는다(→ 6절 이월). 파일은 스키마의 의미 정보만 담아 diff를 깨끗하게 유지한다.

### 동기화 모델(트랙 B — 아직 구현되지 않음)

- pull 시 서버의 현재 Revision 번호(`revisionSeq`)를 `.erdd/sync.json`에 기록한다. 트랙 A는 이 값과 `.erdd/base.json`을 `status`/`pull`의 로컬 변경 감지에만 쓴다.
- push 시 서버 Revision이 그대로면 즉시 반영. 서버가 앞서 있으면:
  - 마지막 pull 시점(`base.json`)을 기준으로 **3-way 비교**해 서로 다른 객체를 건드렸으면 자동 병합 후 반영.
  - 같은 객체(같은 테이블의 같은 속성)를 양쪽에서 수정했으면 push를 거부하고 충돌 목록을 출력 — pull로 서버 변경을 받아 정리 후 재시도.
- push는 서버에서 일반 편집과 동일하게 Revision으로 기록된다(작업자 = 토큰 소유자). 반드시 `mutateAndPublish`를 거쳐야 실시간 채널에도 전파된다(→ [HANDOFF "다음 작업"](superpowers/HANDOFF.md)).

### 에이전트 스킬(트랙 B — 아직 구현되지 않음)

- 패키지에 스킬 문서(`SKILL.md`)를 동봉하고, `erdd skill install`이 프로젝트의 스킬 디렉터리(예: `.claude/skills/erdd/`)에 설치한다.
- 스킬 내용:
  - 스키마 파악: `erdd/` 파일 구조 읽는 법, `status`/`diff` 활용.
  - 수정 워크플로: pull 최신화 → 파일 수정 → `validate` → `diff` 확인 → push.
  - 명명 규칙 준수: 새 컬럼 추가 시 `words.yaml`/`terms.yaml`을 조회해 물리명을 짓고, 없는 단어는 함께 등록하도록 지침.
  - 커스텀 항목·도메인 사용 지침.

## 다른 영역과의 연계

- 충돌 판정은 Revision 모델 기반(→ [11-collaboration](11-collaboration.md)).
- 파일 포맷의 사전·도메인·커스텀 항목 구조(→ [13-naming](13-naming.md), [14-domain](14-domain.md), [15-custom-fields](15-custom-fields.md)).
- 새 tRPC 프로시저를 토큰에 열 때의 규칙(→ [HANDOFF 3절](superpowers/HANDOFF.md)).

## 단계별 범위

- **Phase 4 트랙 A(완료)**: 개인 액세스 토큰, 파일 포맷, `init`/`pull`/`status`/`validate` → [설계](superpowers/specs/2026-08-03-cli-pull-design.md)
- **Phase 4 트랙 B(예정)**: `push`, 3-way 병합, `diff`, 에이전트 스킬
