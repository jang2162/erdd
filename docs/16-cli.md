# CLI와 코드베이스 동기화, 에이전트 스킬

## 목적

서버(진실 원천)의 스키마를 코드베이스에 파일로 내려받아 버전 관리하고, 로컬 수정을 서버로 되밀며, AI agent가 이 CLI로 스키마를 파악·수정하는 워크플로를 제공한다. MCP 서버는 제공하지 않고 **CLI + 에이전트 스킬** 조합으로 간다.

## 사용자 시나리오

- 개발자가 `schemantic pull`로 최신 스키마를 받아 커밋한다. PR 리뷰에서 스키마 변경이 코드와 함께 보인다.
- AI agent가 기능 구현 전에 `schemantic/` 디렉터리의 테이블 파일을 읽어 DB 구조를 파악한다.
- agent가 새 테이블 파일을 작성하고 `schemantic diff`로 확인한 뒤 `schemantic push`로 서버에 반영한다. 설계자가 웹에서 이어서 다듬는다.

## 기능 상세

### 패키지와 명령

npm 패키지 `schemantic`(가칭). Node 실행 환경에서 `npx schemantic <command>`.

| 명령 | 동작 |
|---|---|
| `init` | 설정 파일 생성, 프로젝트 연결 |
| `pull` | 서버 스키마를 로컬 파일로 내려받기(로컬 변경 덮어씀 — 확인 프롬프트) |
| `push` | 로컬 파일의 변경을 서버에 반영 |
| `diff` | 로컬 파일 ↔ 서버 차이 출력 (`--base`로 마지막 pull 시점 기준 3-way 요약) |
| `status` | 연결 정보, 마지막 pull 리비전, 로컬 변경 유무 |
| `validate` | 로컬 파일의 스키마 유효성·명명 경고 검사(서버 호출 없이) |
| `skill install` | 에이전트 스킬 파일을 프로젝트에 설치 |

- 인증: 프로젝트 API 토큰(웹에서 발급, read/write 권한). 환경 변수 `SCHEMANTIC_TOKEN` 또는 로컬 설정(커밋 제외) 사용.
- 출력은 사람용 텍스트와 `--json`(agent·스크립트용)을 모두 지원한다.

### 파일 포맷

git diff 친화성과 agent의 부분 편집 편의를 위해 **분할 YAML**을 쓴다.

```
schemantic.config.yaml      # 프로젝트 ID, 서버 URL (커밋 대상)
schemantic/
├─ .sync.yaml               # 마지막 pull 리비전 등 동기화 메타 (커밋 대상)
├─ tables/
│  ├─ MBR.yaml              # 테이블당 1파일, 파일명 = 물리명
│  └─ ORD.yaml
├─ groups.yaml
├─ words.yaml
├─ terms.yaml
├─ domains.yaml
└─ custom-fields.yaml
```

테이블 파일 예:

```yaml
name: MBR
logicalName: 회원
group: 회원관리
comment: 서비스 가입 회원
columns:
  - name: MBR_NO
    logicalName: 회원번호
    domain: 번호
    pk: true
    nullable: false
  - name: MBR_NM
    logicalName: 회원명
    domain: 명
    nullable: false
    custom:
      개인정보여부: true
indexes:
  - name: UX_MBR_01
    columns: [MBR_NM]
    unique: true
relations:
  - to: MBR_GRD          # 부모 테이블
    columns: {MBR_GRD_CD: GRD_CD}
    type: "N:1"
    identifying: false
```

- 배치 좌표 등 표현 정보는 파일에 포함하지 않는다(서버만 관리). 파일은 스키마의 의미 정보만 담아 diff를 깨끗하게 유지한다.
- 포맷 상세 스키마(JSON Schema)는 구현 시점에 확정한다.

### 동기화 모델

- pull 시 서버의 현재 Revision 번호를 `.sync.yaml`에 기록한다.
- push 시 서버 Revision이 그대로면 즉시 반영. 서버가 앞서 있으면:
  - 마지막 pull 시점을 base로 **3-way 비교**해 서로 다른 객체를 건드렸으면 자동 병합 후 반영.
  - 같은 객체(같은 테이블의 같은 속성)를 양쪽에서 수정했으면 push를 거부하고 충돌 목록을 출력 — pull로 서버 변경을 받아 정리 후 재시도.
- push는 서버에서 일반 편집과 동일하게 Revision으로 기록된다(작업자 = 토큰 소유자).

### 에이전트 스킬

- 패키지에 스킬 문서(`SKILL.md`)를 동봉하고, `schemantic skill install`이 프로젝트의 스킬 디렉터리(예: `.claude/skills/schemantic/`)에 설치한다.
- 스킬 내용:
  - 스키마 파악: `schemantic/` 파일 구조 읽는 법, `status`/`diff` 활용.
  - 수정 워크플로: pull 최신화 → 파일 수정 → `validate` → `diff` 확인 → push.
  - 명명 규칙 준수: 새 컬럼 추가 시 `words.yaml`/`terms.yaml`을 조회해 물리명을 짓고, 없는 단어는 함께 등록하도록 지침.
  - 커스텀 항목·도메인 사용 지침.

## 다른 영역과의 연계

- 충돌 판정은 Revision 모델 기반(→ [11-collaboration](11-collaboration.md)).
- 파일 포맷의 사전·도메인·커스텀 항목 구조(→ [13-naming](13-naming.md), [14-domain](14-domain.md), [15-custom-fields](15-custom-fields.md)).

## 단계별 범위

- **Phase 4**: 위 기능 전체. 단, 파일 포맷 명세는 서버 API와 함께 Phase 1부터 내부적으로 정의해 두고 공개만 Phase 4에 한다.
