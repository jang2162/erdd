# CLI 트랙 A — 액세스 토큰 · 파일 포맷 · 읽기 명령 설계

**날짜:** 2026-08-03
**범위:** Phase 4 CLI의 전반부. 개인 액세스 토큰, 모델↔파일 직렬화, `init`·`pull`·`status`·`validate`.
**후속(트랙 B, 별도 사이클):** `push`, 3-way 병합, `diff`, 에이전트 스킬(`SKILL.md`)과 `skill install`.

관련 문서: 16-cli, 91-checklist, 02-architecture

---

## 1. 왜 둘로 나누는가

`docs/16-cli.md`가 기술하는 것은 최소 네 덩어리다 — 토큰 인증 / 파일 포맷·직렬화 / 명령 7개와 3-way 병합 / 에이전트 스킬. 통짜로 가면 태스크가 20개를 넘고 최종 리뷰 diff가 직전 DDL 사이클(+2208줄)을 크게 웃돈다. 그 사이클에서 Important 4건이 **태스크 경계에서만 보이는 결함**이었던 것을 감안하면 위험이 크다.

트랙 A만으로도 독립적인 가치가 성립한다: 개발자가 `erdd pull`로 스키마를 받아 커밋하면 PR 리뷰에서 스키마 변경이 코드와 함께 보이고, AI agent가 `erdd/` 디렉터리를 읽어 DB 구조를 파악할 수 있다. 쓰기(push)는 없어도 이 두 시나리오는 완결된다.

## 2. 인증 — 개인 액세스 토큰

### 2.1 왜 프로젝트 토큰이 아닌가

`16-cli.md`의 원안은 "프로젝트 API 토큰(read/write 권한)"이다. 이는 조직(Owner/Admin/Member) × 프로젝트(Admin/Editor/Viewer)와 **별개의 새 권한 축**이다. 직전 사이클에서 권한 세분화를 검토한 결과 "필요가 실증되지 않은 새 축은 도입하지 않는다"고 결론 내렸다(→ [viewer-readonly-ui 설계](2026-08-01-viewer-readonly-ui-design.md), 91-checklist Phase 3). 그 결론을 CLI에서 뒤집을 근거가 없다.

**사용자 단위 토큰**으로 하면 권한은 그 사용자의 기존 역할에서 그대로 파생된다. 서버는 `requireProjectAccess`를 변경 없이 재사용하고, 새 축이 생기지 않는다. Viewer가 발급한 토큰은 Viewer 권한이고, 그 사용자가 프로젝트에서 빠지면 토큰도 자동으로 그 프로젝트에 접근하지 못한다 — 별도의 회수 절차가 필요 없다.

### 2.2 저장 형태

새 테이블 `access_tokens` (마이그레이션 0010):

| 컬럼 | 타입 | 비고 |
|---|---|---|
| `id` | uuid PK | UUIDv7 |
| `user_id` | uuid | `users.id` 참조, `ON DELETE CASCADE` |
| `name` | text | 사용자가 붙이는 라벨 (예: `노트북`, `CI`) |
| `token_hash` | text | SHA-256 16진 문자열 |
| `created_at` | timestamptz | |
| `last_used_at` | timestamptz \| null | 인증 성공 시 갱신 |
| `revoked_at` | timestamptz \| null | null이 아니면 인증 거부 |

평문 토큰은 `erdd_pat_` + `randomBytes(32).toString('base64url')`이며 **발급 응답에서 한 번만** 나온다. 이후 조회할 방법은 없다.

**해시 알고리즘이 비밀번호와 다른 이유:** 비밀번호는 scrypt(`apps/server/src/auth/password.ts`)를 쓴다. scrypt의 목적은 저엔트로피 비밀번호에 대한 무차별 대입을 늦추는 것이다. 256비트 랜덤 토큰에는 그 공격 표면이 존재하지 않으므로 늘릴 비용이 없고, 대신 **모든 API 요청마다 scrypt를 도는 비용**을 피해야 한다. 그래서 SHA-256 단순 해시를 쓴다. 비교는 `timingSafeEqual`로 한다.

만료는 두지 않는다. 갱신 UX(만료 임박 알림, 재발급 유도)가 딸려 오는데 필요가 실증되지 않았다. 폐기(revoke)만 제공하고, 필요해지면 `expires_at`을 추가한다.

### 2.3 인증 경로 — `ctx.user` 해석기에 갈래 하나

현재 `apps/server/src/context.ts`는 `erdd_session` 쿠키에서만 `ctx.user`를 만든다. 여기에 `Authorization: Bearer <token>` 갈래를 더한다. 쿠키가 있으면 쿠키를 우선하고, 없을 때만 헤더를 본다.

`ctx`에 `authKind: 'session' | 'token' | null`을 함께 싣는다.

### 2.4 노출 표면 분리 — fail-closed allowlist

토큰이 쿠키 세션과 완전히 같은 표면을 갖는 것은 곤란하다. 비밀번호 변경(`auth.changePassword`), 계정 생성(`admin.users.create`), 토큰 자체의 발급·폐기까지 토큰으로 호출 가능해지면, 유출된 토큰 하나가 계정을 완전히 장악한다.

그래서 **기본을 거부로 둔다**:

- 기존 `authedProcedure`는 `authKind === 'session'`만 통과시킨다. 토큰이면 `UNAUTHORIZED`.
- 새 `apiProcedure`(= `dbProcedure` + 로그인 확인, 인증 수단 무관)를 만들고, **CLI가 실제로 쓰는 프로시저만** 명시적으로 이것으로 바꾼다.

트랙 A의 allowlist는 다음 5개다:

| 프로시저 | 용도 |
|---|---|
| `auth.me` | 토큰 유효성 확인, 사용자 표시 |
| `org.list` | `init`의 조직 선택 |
| `project.list` | `init`의 프로젝트 선택 |
| `project.get` | 방언·명명 규칙 조회 |
| `model.get` | 모델 조회 |

트랙 B에서 `model.mutate`와 `revision.list`가 추가된다.

`apiProcedure`는 세션도 통과시키므로 웹은 아무 영향이 없다. 새 프로시저를 추가해도 토큰에는 저절로 열리지 않는다.

**이것은 새 권한 축이 아니다.** 무엇을 할 수 있는지는 여전히 조직·프로젝트 역할에서만 나온다. 달라지는 것은 인증 수단별 노출 표면이며, 두 축이 곱해지지 않는다(토큰으로 열린 프로시저 안에서는 역할 판정이 세션과 완전히 동일하다).

### 2.5 발급 화면

`apps/web/src/pages/settings.tsx`("내 계정")에 `액세스 토큰` 카드를 추가한다. 비밀번호 변경 카드 아래에 둔다 — 둘 다 사용자 본인의 자격 증명이다.

- 이름 입력 → `발급` → 평문 토큰을 복사 버튼과 함께 1회 표시하고 "이 값은 다시 볼 수 없습니다" 안내
- 목록: 이름 · 생성일 · 마지막 사용(없으면 `사용 안 함`) · `폐기` 버튼
- 폐기는 확인 후 즉시 반영

새 프로시저 `auth.tokens.create` / `auth.tokens.list` / `auth.tokens.revoke`는 전부 **`authedProcedure`(세션 전용)** 이다. 토큰으로 토큰을 만들 수 없다.

## 3. 파일 포맷

### 3.1 경계 — core는 plain object까지

`packages/core`는 IO·런타임 의존성이 없다(→ [HANDOFF 3.5](../HANDOFF.md)). YAML 파서는 의존성이므로 core에 넣을 수 없다.

`packages/core/src/file-format.ts`에 순수 함수 두 개를 둔다. **YAML 문자열이 아니라 plain object를 다룬다.**

```ts
export type FileTree = Record<string, unknown>   // 상대 경로 → 파일 내용(plain object)

export function modelToFiles(model: ProjectModel): FileTree
export function filesToModel(tree: FileTree): FilesToModelResult

export type FilesToModelResult =
  | { ok: true; model: ProjectModel; warnings: FileIssue[] }
  | { ok: false; issues: FileIssue[] }

export type FileIssue = { path: string; message: string }
```

YAML 인코딩/디코딩은 CLI가 `yaml` 패키지로 한다. 이는 Excel에서 이미 검증된 패턴이다 — `excel-sheets.ts`는 순수하고 `exceljs`는 `apps/web`에만 있다.

### 3.2 무엇을 담는가

모델의 10개 컬렉션 중 **9개**를 담는다: `tables` · `columns` · `relationships` · `indexes` · `tableGroups` · `domains` · `words` · `terms` · `customFields`.

담지 않는 것:

- **`notes`** — 캔버스 스티커(`{content, position, color}`)로 위치·색이 본질이고 스키마의 의미 정보가 아니다.
- **`position`** (테이블·그룹의 배치 좌표) — 옮기기만 해도 전 파일이 변경으로 잡히면 diff가 무의미해진다.
- **`origin`** (공용 리소스 fork 출처) — 손으로 고쳐 push하면 재동기화 상태가 깨질 수 있는 내부 상태다.

이 결정은 트랙 B에서 **"파일에 없는 것은 push가 서버에서 건드리지 않는다"** 는 계약이 된다. base가 파일과 정확히 같은 범위를 담으므로(§3.4), 3-way diff가 제외된 필드를 삭제로 오인하지 않는다.

### 3.3 디렉터리 구조

```
erdd.config.yaml            # 커밋 대상
erdd/                       # 커밋 대상
├─ tables/
│  ├─ MBR.yaml
│  └─ ORD.yaml
├─ groups.yaml
├─ words.yaml
├─ terms.yaml
├─ domains.yaml
└─ custom-fields.yaml
.erdd/                      # git-ignore (init이 .gitignore에 추가)
├─ base.json
├─ sync.json
└─ credentials.json         # {"token": "erdd_pat_…"} — ERDD_TOKEN이 있으면 그쪽이 우선
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

방언과 명명 규칙은 모델이 아니라 `projects` 행에 있다. `computeWarnings(model, rules?, dialects?)`가 이 둘을 받으므로, 파일 트리에 없으면 `validate`가 오프라인에서 명명 경고를 낼 수 없다. 그래서 `pull`이 이 둘을 config에 함께 기록한다. **커밋 대상**인 이유는 팀 전체가 같은 규칙으로 검사해야 하기 때문이다.

> 알려진 한계: 서버에서 명명 규칙을 바꾸면 다음 `pull` 전까지 로컬 `validate` 결과가 서버와 다를 수 있다. 이 사이클에서는 그대로 두고, 어긋남이 실제 문제가 되면 `status`가 서버 설정과 비교해 알리도록 한다.

테이블 파일(`erdd/tables/MBR.yaml`):

```yaml
id: 018f6b0e-…
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
    columns: [MBR_NM]
    unique: true
relations:
  - id: 018f6b0e-…
    to: MBR_GRD
    columns: { MBR_GRD_CD: GRD_CD }
    identifying: false
```

규칙:

- **참조는 이름으로 쓰고 `id`를 함께 둔다.** `group`·`domain`·`to`는 사람이 읽을 이름이고, identity는 `id`다. 이름이 바뀌어도 `id`로 추적되므로 삭제+추가로 오인되지 않는다(→ 02-architecture).
- 컬럼은 `type`(논리 타입 문자열)을 항상 쓰고, 도메인이 지정된 컬럼은 `domain`(도메인 이름)을 함께 쓴다. **둘 다 쓰는 이유는 모델이 실제로 둘 다 들고 있기 때문이다** — `setColumnDomain`(`apps/web/src/editor/column-edits.ts:36`)은 도메인을 지정할 때 기존 `type` 문자열을 지우지 않는다. `type`만 쓰면 도메인이 소실되고, `domain`만 쓰면 그 `type` 문자열이 소실된다. 읽을 때 실효 타입은 도메인이 우선하며(`resolveColumn`), 파일의 `type`은 도메인이 있을 때 참고값이다.
- 관계는 **자식 테이블 파일**에 적는다(`to`가 부모). 한 관계가 두 파일에 나타나지 않는다.
- 기본값이 있는 필드는 값이 기본값이면 파일에서 생략한다(`nullable: true`, `pk: false`, `unique: false`). diff를 조용하게 유지한다.
- 로컬에서 새로 만든 객체는 `id` 없이 쓴다. 트랙 A에서는 `pull`이 항상 `id`를 채우므로 이 형태는 `validate`만 받아들이고, 실제 발급은 트랙 B의 `push`가 한다.

### 3.4 파일명

파일명은 테이블 물리명이다. 물리명이 바뀌면 `pull`이 파일명을 갱신한다(identity는 `id`).

**대소문자만 다른 두 테이블**(`mbr`과 `MBR`)은 macOS·Windows의 대소문자 무시 파일시스템에서 충돌한다. 이때만 두 파일 모두 `<물리명>.<id 앞 8자>.yaml`로 떨어뜨리고 경고를 낸다. 물리명은 사실상 `[A-Za-z_][A-Za-z0-9_]*` 범위라 그 외 금지문자 문제는 없다.

### 3.5 base와 sync

`.erdd/base.json` — `pull` 시점의 모델을 **파일에 담는 범위 그대로** 담은 단일 JSON. 사람이 열어볼 대상이 아니므로 분할하지 않는다. 트랙 B의 3-way 병합이 이것을 base로 쓴다.

`.erdd/sync.json` — `{ "revisionSeq": 42, "pulledAt": "2026-08-03T07:00:00.000Z" }`.

둘 다 git-ignore한다. base를 커밋하면 병합 충돌이 base 자체에서 나고, 서버에서 재구성하는 방식은 `model.at(revision)`이라는 서버 API 신설(op 로그 재생)을 요구하며 오프라인 `diff`를 불가능하게 한다.

## 4. 명령

패키지는 `packages/cli`, 이름 `@erdd/cli`, 바이너리 `erdd`. 기존 `@erdd/core`·`@erdd/server`·`@erdd/web`과 일관되고 제품명과 같다. npm 공개 배포는 이 사이클의 범위가 아니다.

인증은 환경 변수 `ERDD_TOKEN` 또는 `.erdd/credentials.json`(git-ignore, `init`이 저장). 환경 변수가 우선한다.

### `erdd init`

대화형으로 서버 URL → 토큰 → 조직 → 프로젝트를 받아 `erdd.config.yaml`을 만들고, `.gitignore`에 `.erdd/`를 추가한다(이미 있으면 그대로 둔다). `--server`·`--token`·`--project`로 비대화형 실행이 가능하다. 이미 config가 있으면 덮어쓰기 전에 확인한다.

### `erdd pull`

`project.get`과 `model.get`을 호출해 파일 트리를 만들고, `base.json`·`sync.json`을 기록한다.

로컬 변경(파일 트리 ≠ `base.json`)이 있으면 **변경된 파일 목록을 보여주고 확인을 받는다.** `--yes`로 건너뛴다. base가 없으면(최초 `pull`) 확인 없이 진행한다.

`pull`은 **자기가 소유한 경로에서만** 이번에 만들지 않은 파일을 지운다 — `erdd/tables/*.yaml`과 §3.3에 열거한 5개 최상위 파일이다. 서버에서 삭제된 테이블의 파일이 남으면 안 되기 때문이다. `erdd/` 아래에 사용자가 따로 둔 다른 파일·디렉터리는 건드리지 않는다.

### `erdd status`

서버 URL · 프로젝트 이름 · 마지막 pull 리비전과 시각 · 로컬 변경 파일 목록(추가/수정/삭제)을 출력한다. 서버를 호출하지 않는다 — 로컬 상태만 본다. (서버와의 격차 비교는 트랙 B의 `diff`가 한다.)

### `erdd validate`

서버를 호출하지 않는다. 파일 트리를 읽어 `filesToModel`로 모델을 만들고 `validateModelIntegrity`와 `computeWarnings(model, namingRules, dialects)`를 돌린다. 출력은 세 단계다:

1. **파싱 오류**(`filesToModel`이 `ok: false`) — 어느 파일의 무엇이 문제인지. 종료 코드 1.
2. **정합성 오류**(`validateModelIntegrity`) — 존재하지 않는 컬럼을 가리키는 인덱스 등. 종료 코드 1.
3. **명명 경고**(`computeWarnings`) — 종료 코드 0. `--strict`를 주면 1.

### 공통 규약

- `--json`을 주면 사람용 출력 대신 JSON 한 덩어리를 stdout에 낸다.
- 종료 코드: `0` 성공 · `1` 실패(검증 실패, 서버 오류, 사용자 취소) · `2` 사용법 오류(알 수 없는 명령·필수 인자 누락).
- 진행 메시지·프롬프트는 stderr로 보낸다. `--json`일 때 stdout이 항상 파싱 가능한 JSON이어야 하기 때문이다.

### `--json` 스키마

명령별 평면 객체다. 공통 봉투를 두지 않는다 — agent가 `jq`로 바로 필드를 꺼낼 수 있어야 한다.

```jsonc
// erdd init --json
{ "configPath": "erdd.config.yaml", "projectId": "018f…", "projectName": "커머스" }

// erdd pull --json
{ "revisionSeq": 42, "written": 12, "deleted": 1, "tables": 8,
  "warnings": [{ "path": "erdd/tables/MBR.yaml", "message": "…" }] }

// erdd status --json
{ "serverUrl": "https://…", "projectId": "018f…", "projectName": "커머스",
  "revisionSeq": 42, "pulledAt": "2026-08-03T07:00:00.000Z",
  "changes": { "added": ["erdd/tables/NEW.yaml"], "modified": [], "deleted": [] } }

// erdd validate --json
{ "ok": false,
  "parseErrors": [{ "path": "…", "message": "…" }],
  "integrityIssues": [{ "kind": "…", "message": "…" }],
  "warnings": [{ "kind": "…", "scope": "…", "message": "…" }] }
```

오류로 끝날 때는 어느 명령이든 다음 하나만 낸다:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "토큰이 유효하지 않습니다" } }
```

`code`는 `UNAUTHORIZED` · `FORBIDDEN` · `NOT_FOUND` · `NO_CONFIG` · `NETWORK` · `VALIDATION` · `USAGE` · `CANCELLED` 중 하나다.

## 5. 테스트

핵심 계약은 **왕복 항등**이다: `filesToModel(modelToFiles(m)).model` 이 `m`과 같다(파일에 담기로 한 9개 컬렉션 범위 안에서).

직전 DDL 사이클에서 왕복 픽스처가 테이블 1개·컬럼 2개뿐이라 관계·인덱스 경로가 왕복에서 한 번도 실행되지 않았고, Important 4건 중 3건이 그 빈틈에 숨어 있었다. 이번에는 **처음부터** 9개 컬렉션을 전부 채운 픽스처로 시작한다: 테이블 2개(부모·자식) · 그룹 소속 · 도메인 지정 컬럼과 타입 직접 지정 컬럼 · PK 복합 · 유니크/일반 인덱스 · 식별/비식별 관계 · 단어 · 용어 · 커스텀 항목 정의와 값 · 물리명이 대소문자만 다른 테이블 쌍.

| 층 | 테스트 |
|---|---|
| `packages/core` | 왕복 항등 · 기본값 생략과 복원 · 이름 참조 해석(그룹·도메인·부모) · 참조 대상이 없을 때 `FileIssue` · 대소문자 충돌 파일명 |
| `apps/server` | 토큰 인증 3경우(유효 · 폐기됨 · 없는 토큰) · 토큰으로 `authedProcedure` 호출 시 `UNAUTHORIZED` · 토큰으로 `apiProcedure` 호출 성공 · 기존 쿠키 경로 회귀 · `auth.tokens.*` 3종 |
| `apps/web` | 토큰 카드 발급·1회 표시·목록·폐기 |
| `packages/cli` | 임시 디렉터리 + `fetch` 스텁으로 4개 명령 · `--json` 출력 형태 · 종료 코드 · `pull`의 삭제 동작과 확인 프롬프트 |

## 6. 이 사이클에서 하지 않는 것

- `push` · 3-way 병합 · `diff` · `skill install` · `SKILL.md` (트랙 B)
- 토큰 만료와 갱신
- npm 공개 배포 파이프라인
- `notes` · 배치 좌표 · `origin`의 파일 표현
- 서버 설정과 로컬 config의 어긋남 감지
