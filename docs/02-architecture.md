# 아키텍처

기술 스택과 데이터 계층 설계를 확정하는 문서. 로드맵의 아키텍처 전제("데이터 계층은 이벤트(작업 로그) 기반")를 구체화한다.

## 설계 전제

| 전제 | 내용 |
|---|---|
| 개발 체제 | 1인 개발 + AI agent 활용. 구조·운영 복잡도를 최소로 유지한다 |
| 언어 | TypeScript 통일(웹/서버/CLI). 도메인 로직을 전 계층에서 공유한다 |
| 규모 목표 | 프로젝트당 테이블 **~500개**에서 에디터·내보내기가 쾌적하게 동작 |
| 배포 | 컨테이너 기반(Docker). 특정 PaaS에 종속되지 않고 WebSocket 제약이 없다 |

## 시스템 구성

### 모노레포

pnpm workspace 기반.

```
erdd/
├─ apps/
│  ├─ web/        # React + Vite + @xyflow/react + Zustand + tRPC 클라이언트
│  └─ server/     # Fastify + tRPC + Drizzle ORM + PostgreSQL
└─ packages/
   ├─ core/       # 순수 TS 도메인 로직 — IO 없음
   └─ cli/        # Phase 4 (core 재사용) + 로컬 모드 서버(src/local/)
```

### packages/core — 도메인 로직의 단일 저장소

IO 없는 순수 TypeScript 패키지에 도메인 로직을 모두 모은다.

- 모델 타입과 zod 스키마 (Table/Column/… — [01-concepts](01-concepts.md)의 엔티티)
- op 정의, 적용기(apply), 역변환(invert)
- 검증 규칙(물리명 중복, 관계 타입 불일치, 명명 경고 등)
- 명명 엔진: 단어 분해, 물리명 생성 (→ [13-naming](13-naming.md))
- 논리 타입 시스템과 방언별 DDL 생성기 (→ [14-domain](14-domain.md), [17-import-export](17-import-export.md))
- diff 엔진 (모델 ↔ 모델 비교)
- CLI 파일 포맷(YAML) 파서/시리얼라이저 (→ [16-cli](16-cli.md))

이 배치로 얻는 것:

- **서버**는 core를 감싸 인증·영속화·트랜잭션만 담당한다.
- **웹**은 같은 core로 물리명 자동생성 미리보기, 클라이언트측 검증을 서버 왕복 없이 수행한다.
- **CLI**의 `validate`가 서버 호출 없이 동작해야 한다는 [16-cli](16-cli.md) 요구가 자동 충족된다.

### 기술 선택

| 영역 | 선택 | 근거 |
|---|---|---|
| 프론트 | React + Vite + Zustand + TanStack Query | 표준적 조합. AI agent 친화적 |
| 캔버스 | @xyflow/react (React Flow) | 줌/팬/미니맵/노드 내장, 뷰포트 밖 렌더링 생략으로 ~500 테이블 대응. 까마귀발 표기는 커스텀 엣지로 구현 |
| API | tRPC (Fastify 위) | 서버 함수 타입이 웹/CLI 클라이언트까지 그대로 흘러 별도 API 스키마 관리가 없음 |
| DB | PostgreSQL + Drizzle ORM | op 로그·스냅샷에 jsonb 활용. Drizzle은 TS-first에 경량 |
| 검증 | zod (core에 정의) | op·입력 스키마를 tRPC와 공유 |
| Excel | exceljs | Phase 2 산출물 생성/업로드 파싱 |
| 이미지 내보내기 | html-to-image (React Flow DOM 기반) | PNG/SVG 모두 대응 |
| 실시간 (Phase 3) | Fastify + ws, op 브로드캐스트 | 스케일아웃 필요 시점에 Redis pub/sub 추가 |

### 배포 구성

단일 Docker 이미지(server가 web 정적 파일 서빙 + API + Phase 3의 WebSocket) + 관리형 PostgreSQL. 1인 운영 최소형으로 시작하고, 트래픽이 늘면 web 분리·다중 인스턴스(Redis pub/sub)로 확장한다. 운영 배포는 HTTPS를 전제로 한다(세션 쿠키가 production에서 secure 플래그를 사용하므로 TLS 종료가 없는 환경에서는 로그인이 동작하지 않는다 — 리버스 프록시에서 TLS를 종료할 것).

### 실행 형태 둘 — 서버 배포와 로컬 모드

같은 웹 에디터가 백엔드 둘 위에서 돈다. ②는 `erdd serve`가 띄우는 로컬 서버다(→ [16-cli](16-cli.md)).

| | ① 서버 배포 | ② 로컬 모드(`erdd serve`) |
|---|---|---|
| 백엔드 | `apps/server` — Fastify + tRPC + Drizzle | `packages/cli/src/local` — Fastify + 축소 tRPC 라우터 |
| 진실 원천 | PostgreSQL | 저장소 안의 `erdd/*.yaml` 파일 |
| 계정·조직·권한 | 있다 | 없다 — 고정 사용자, 127.0.0.1 바인딩 |
| 변경 이력 | `revisions` 테이블(이력 화면·undo 재제출) | git이 파일을 버전 관리한다(Revision 이력 없음) |
| 스냅샷 | `snapshots` 테이블 | `.erdd/snapshots.json` 단일 파일 |
| 외부 변경 전파 | WebSocket op 브로드캐스트 + presence | SSE 한 줄(파일 감시 → 재로드) |
| 범위 | 조직·프로젝트 여러 개 | 디렉터리 하나 = 프로젝트 하나 |

- **웹과 core는 한 벌이다.** 모드 분기는 `auth.me`가 돌려주는 `mode: 'server' | 'local'` 한 값이고, 웹은 그 값으로 로컬에 없는 화면(공용 리소스·참여자·사용자 메뉴·버전 이력)을 렌더에서 뺀다. 운영 서버는 언제나 `'server'`를 돌려준다.
- ⚠️ **웹 클라이언트는 서버 라우터의 `AppRouter` 타입으로 만들어진다.** 로컬 라우터가 그 계약에서 어긋나면 컴파일이 아니라 런타임에 깨지므로, 입출력 타입 일치와 프로시저 이름 집합을 테스트로 잠근다(→ [HANDOFF 3.18](superpowers/HANDOFF.md)).
- **둘은 배타가 아니다.** 연결 설정(`serverUrl`+`projectId`)이 있는 프로젝트에서도 `erdd serve`가 뜨고, 로컬 서버는 어느 경우든 **파일만** 본다. 서버와의 왕래는 `pull`/`push`가 맡는다.

## 데이터 계층

### Identity — 모든 객체에 불변 ID

테이블·컬럼·관계·인덱스·메모·그룹·단어·용어·도메인·커스텀 항목은 서버 발급 **UUIDv7**(시간순 정렬로 인덱스 효율적)을 identity로 갖는다.

- 물리명·논리명은 순수 속성이다. rename은 update이지 삭제+추가가 아니다.
- Revision, diff, CLI 3-way의 동일 객체 판정이 모두 이 ID 기준이다.
- CLI 파일에도 `id` 필드를 포함한다. 로컬에서 새로 만든 객체는 id 없이 작성하고 push 시 서버가 발급한다(→ [16-cli](16-cli.md)).

### op — 모든 변경의 공용 어휘

```ts
type Op =
  | { action: 'create'; entity: EntityKind; entityId: string; data: {...} }
  | { action: 'update'; entity: EntityKind; entityId: string;
      changes: { [prop]: { from; to } } }   // 속성 단위
  | { action: 'delete'; entity: EntityKind; entityId: string; before: {...} }
```

하나의 op 어휘가 전 영역에서 재사용된다:

| 용도 | 방식 |
|---|---|
| Revision 이력 | op 배치를 그대로 기록 |
| undo/redo | 역(inverse) op |
| 실시간 전파 (Phase 3) | 적용 성공한 op 배치를 브로드캐스트 |
| CLI push (Phase 4) | 로컬 변경을 op 배치로 제출 |
| 스냅샷 복원 | 스냅샷↔현재 diff를 op 배치로 변환해 적용 |

### mutation 파이프라인 — 단일 변경 경로

```
편집 주체 (웹 에디터 / CLI push / Excel 업로드 / DDL 역설계 / 스냅샷 복원)
   │  op 배치
   ▼
서버 mutation 파이프라인
   ├─ 권한 확인
   ├─ core 검증
   ├─ 상태 테이블 갱신   ┐ 하나의
   └─ revisions INSERT   ┘ 트랜잭션
```

정규화된 상태 테이블이 진실 원천이고, revisions는 append-only 로그다. 상태↔로그 정합성은 **"이 파이프라인 밖에서는 상태를 절대 변경하지 않는다"**는 규율로 지킨다.

**로컬 모드에는 이 파이프라인이 없다.** op 배치는 core의 `applyOps`로 메모리 모델에 적용되고 디바운스 뒤 파일로 쓰인다 — 권한 확인·트랜잭션·revisions 기록이 전부 빠진다. 다만 **op 검증(`parseOps`·배치당 상한)은 core의 같은 함수를 그대로 쓴다**(규칙이 두 벌이 되지 않게 한다).

### Revision

`revisions(project_id, seq, actor, source, ops jsonb, summary, created_at)`

- `seq`는 프로젝트별 단조 증가 번호. 트랜잭션 안에서 발급한다.
- `source`: `web` | `cli` | `system`(복원 등).
- 이력 화면([11-collaboration](11-collaboration.md))은 이 테이블 조회로 구현된다.
- 연속 좌표 이동 같은 저정보 변경은 클라이언트에서 디바운스로 한 배치에 합쳐 기록한다.

### undo/redo — 역op 재제출

클라이언트가 로컬 스택에 역op를 보관하고, undo 실행 = 역op를 일반 mutation으로 다시 제출한다(새 Revision으로 기록됨). 서버에 별도 undo 개념이 없어 단순하고, Phase 3 동시편집에서도 "내 변경만 undo"가 자연스럽게 성립한다.

### 스냅샷 — 전체 모델 직렬화 (리플레이 없음)

`snapshots(project_id, name, description, revision_seq, model jsonb)`

- `model`은 스키마 + 사전 + 커스텀 항목 정의 + 그룹 + **배치 좌표**를 포함한 프로젝트 모델 전체의 직렬화다. ~500 테이블이어도 수 MB 수준이라 통째로 저장한다. 이벤트 리플레이·체크포인트가 필요 없다.
- **복원** = diff 엔진으로 "스냅샷 모델 ↔ 현재 상태"의 차이를 op 배치로 만들어 일반 파이프라인에 제출. 복원도 자동으로 Revision 1건이 되어 다시 되돌릴 수 있다([11-collaboration](11-collaboration.md)의 요구가 별도 장치 없이 충족).

### diff 엔진

core의 `diff(모델A, 모델B)` → id 기준 추가/삭제/변경 목록. 이 하나로 세 가지를 해결한다:

1. 스냅샷 ↔ 스냅샷/현재 diff와 변경분 정의서 (Phase 3)
2. 스냅샷 복원의 op 배치 생성
3. CLI push 시 로컬 변경 계산 (Phase 4)

## Phase 3/4 대비 (설계만, 구현은 해당 Phase에)

### 실시간 협업 (Phase 3)

- 서버가 적용 성공한 op 배치를 프로젝트 채널(WebSocket)로 브로드캐스트하고, 클라이언트는 수신 op를 로컬 상태에 적용한다.
- [11-collaboration](11-collaboration.md)의 "속성 단위 LWW"는 op의 `changes`가 이미 속성 단위이므로 서버 도착 순서가 곧 승자다.
- 재접속 재수화 = 마지막 수신 `seq` 이후의 revisions 재전송(간극이 크면 전체 리로드).
- presence(아바타, 선택 하이라이트)는 영속화 없는 별도 ephemeral 채널.

### CLI 동기화 (Phase 4)

- 충돌 판정에 과거 상태 재구성이 필요 없다. `revisions` 로그에서 "마지막 pull `seq` 이후 서버에서 변경된 (entityId, 속성) 집합"을 추출해 클라이언트 op 배치와 교집합을 검사하고, 교집합이 있으면 충돌 목록을 반환한다.
- 로컬 변경 계산(diff의 base)은 pull 시점 상태의 로컬 사본을 기준으로 한다. 상세는 [16-cli](16-cli.md) 구체화 시점에 확정.

## 다른 문서와의 연계

- 엔티티 정의는 [01-concepts](01-concepts.md)를 따르고, 상태 테이블은 그 엔티티 카탈로그의 구현이다.
- Revision·스냅샷의 기능 요구는 [11-collaboration](11-collaboration.md), 이 문서는 그 구현 방식을 정의한다.
- 논리 타입 시스템·명명 엔진·파일 포맷의 상세 스펙은 각 기능 문서에서 구체화하되, 코드는 모두 `packages/core`에 위치한다.
