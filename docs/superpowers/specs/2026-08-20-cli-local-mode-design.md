# CLI 로컬 모드 — 백엔드 없이 파일 기반 단일 프로젝트로 실행 설계

**작성:** 2026-08-20 / **상태:** 사용자 확정 / **마이그레이션:** 없음 / **서버 변경:** `auth.me` 한 곳(`mode` 필드)

---

## 1. 목적과 범위

지금 ERDD 를 쓰려면 **PostgreSQL + 계정 + 조직/프로젝트**가 선다. 그런데 CLI 워크플로의 실제 모습은
"에이전트가 `erdd/` 의 YAML 을 읽고 고치고, 사람이 그것을 그림으로 확인한다"이고, 여기에 계정·조직·
권한은 아무 역할도 하지 않는다. 코드베이스 하나에 스키마 하나가 붙어 있을 뿐이다.

이 사이클은 **`erdd serve` 하나로 로컬 서버가 떠서, `erdd/` 파일을 진실 원천으로 삼아 기존 웹 에디터를
브라우저에 띄우는 모드**를 만든다. DB 도, 계정도, 백엔드 서버도 필요 없다.

```
$ erdd serve
  http://127.0.0.1:4300 에서 실행 중 (프로젝트: ./erdd)
```

**서버와의 왕래는 로컬 서버가 전혀 관여하지 않는다.** `erdd.config.yaml` 에 `serverUrl` + `projectId`
가 있으면 지금의 `pull`/`push`/`diff` 가 그대로 동작하고, 로컬 서버는 언제나 파일만 본다. 두 경로가
만나는 지점은 **파일 하나**뿐이다.

### 무엇이 살고 무엇이 사라지는가

| 살아 있는 것 | 사라지는 것 |
|---|---|
| 에디터 전부(테이블·컬럼·관계·인덱스·메모·그룹·그룹 뷰·자동 정렬·단축키·클립보드) | 로그인·계정 설정·액세스 토큰 화면 |
| 실행 취소/다시 실행 | 홈·조직·프로젝트 목록·관리자·초대 |
| 모델 검사(경고 전부 — core 순수 함수라 그대로 동작) | 참여자(presence)·실시간 커서 |
| DDL·DBML 가져오기/내보내기, 이미지·Excel 내보내기, 사전 Excel 업로드 | 버전 이력(Revision) 목록 |
| 도메인·단어·용어·커스텀 항목 관리 | 공용 리소스 라이브러리·승격 요청 큐 |
| 스냅샷 생성·복원(단일 파일) | 프로젝트 멤버·권한 |

---

## 2. 확정된 결정 (사용자 확정)

### D1. 로컬 서버는 축소 tRPC 라우터 + 파일 저장소다

기존 `apps/server` 를 재사용하지 않는다. 저장소 추상화를 넣는 안(B)과 PGlite 로 서버를 통째로 띄우는
안(C)을 함께 놓고 A 를 골랐다.

- 로컬 모드에는 계정·조직·권한·op 로그가 **아예 없어서**, 재사용하려는 서버 계층의 대부분이 무의미하다.
  `runMutation` 의 `FOR UPDATE` 락, `persistOps` 의 FK 순서 제약, 권한 게이트는 전부 Postgres 전제다.
  축소 라우터가 추상화보다 작다.
- B 는 운영 서버 경로에 회귀 위험을 직접 얹는다.
- C 는 **진실 원천이 DB 가 되고 파일이 export 로 밀려난다** — "로컬 파일 기반 + 즉시 쓰기 + 파일 감시"와
  정면으로 어긋나고, 마이그레이션 실행이 CLI 부팅에 붙는다.

### D2. `serverUrl`·`projectId` 는 선택 값이다

`readConfig`(`packages/cli/src/config.ts`)가 지금은 둘을 **필수**로 검증한다. 이것을 optional 로
완화하고, **서버가 필요한 명령(`pull`/`push`/`diff`)이 그때 실패**한다.

별도 `mode:` 필드를 두지 않는다 — 설정이 두 군데서 갈리면 "`mode: local` 인데 `serverUrl` 이 있다"
같은 모순 상태가 생긴다. 판정 근거는 `serverUrl` + `projectId` 의 존재 하나다.

### D3. 버전 이력은 없다. 스냅샷은 `.erdd/` 의 단일 파일이다

Revision 이력(자동 op 로그)은 로컬 모드에서 **제거**한다 — `erdd/` 를 git 이 이미 버전 관리하므로
중복이다. 스냅샷은 "작업 중 임시 복원점"으로서 값이 남으므로 **단일 파일**(`.erdd/snapshots.json`)에
보관하고 **git-ignore** 한다. 스냅샷은 모델 전체 사본이라 N 개가 쌓이면 저장소가 빠르게 부푼다.

### D4. 배치 좌표·메모는 `erdd/layout.yaml` 에 담고 커밋한다

현재 파일 포맷이 담지 않는 모델 정보는 정확히 넷이다.

| 빠진 것 | 로컬 모드의 처리 |
|---|---|
| `Table.position` | `layout.yaml` |
| `Table.groupPosition` | `layout.yaml` |
| `notes` 컬렉션 | `layout.yaml` |
| `origin`(공용 리소스 출처) | 로컬 모드에는 공용 리소스가 없으므로 항상 비어 있다 |

좌표를 `erdd/tables/*.yaml` 에 넣지 않는다 — 테이블을 **옮기기만 해도** 스키마 파일이 diff 에 뜬다.
그 소음을 피하려고 좌표를 뺀 것이 원래 결정이므로(`docs/16-cli.md`) 별도 파일로 갈라 둘 다 지킨다.
git-ignore 하지 않고 커밋 대상으로 두는 이유는, 배치가 **팀이 공유하는 그림의 일부**이기 때문이다.

`origin` 은 서버 미러 시나리오에서도 안전하다 — 파일에 없으므로 3-way 병합 대상이 아니고 서버 값이
그대로 보존된다(기존 규칙).

### D5. 즉시 쓰기 + 파일 감시

편집은 곧바로 파일에 반영되고(디바운스), `erdd/` 를 감시해 밖에서 바뀌면(에이전트 수정 · `git pull` ·
`erdd pull`) 에디터가 자동으로 다시 읽는다. 이 도구의 주 시나리오가 "에이전트와 사람이 같은 파일을
번갈아 만진다"이므로 감시는 부가 기능이 아니라 **기본 동작**이다.

### D6. 프로젝트 설정은 GUI 에서 고치고 `erdd.config.yaml` 에 되쓴다

방언·명명 규칙은 모델이 아니라 프로젝트 설정이다(HANDOFF 3.4). 로컬 모드에서는 그 값이
`erdd.config.yaml` 에 있으므로, 기존 프로젝트 설정 화면에서 **프로젝트 멤버 섹션을 빼고** 명명 규칙
편집만 남기며, 저장 시 `project.update` 가 config 파일에 쓴다.

⚠️ **방언 편집 UI 는 만들지 않는다** — 웹에 원래 없다(설정 화면은 방언을 배지로 **보여 주기만** 하고
값은 프로젝트 생성 때 정해진다). 로컬 모드에는 프로젝트 생성 화면이 없으므로 방언은
`erdd.config.yaml` 을 직접 고쳐 정하고, 파일 감시가 그것을 반영한다.

### D7. 모드 감지는 `auth.me` 의 `mode` 필드 하나로 한다

`auth.me` 의 반환에 `mode: 'server' | 'local'` 을 더한다. 운영 서버는 항상 `'server'` 를 돌려준다 —
**`apps/server` 변경은 `auth.me` 한 곳이 전부다.**

> ⚠️ **구현에서 한 줄로는 끝나지 않았다.** 반환 타입을 core 의 `RunMode` 로 **명시**해야 한다 —
> 명시하지 않으면 tRPC 의 출력 타입 추론이 리터럴 `'server'` 로 좁혀, 로컬 라우터의 `'local'` 과
> 서로를 만족하지 못해 계약 잠금(§4)이 깨진다. 고친 자리는 여전히 `auth.me` **한 곳**이다.

`RequireAuth` 가 이미 부르는 쿼리라 왕복이 늘지 않고, `useMe()` 가 컨텍스트로 내려 주므로 분기가
자연스럽다. 로컬 서버는 고정 사용자를 돌려주므로 로그인 화면이 뜨지 않는다.

### D8. 127.0.0.1 에만 바인딩한다

인증이 없는 서버다. LAN 노출은 **옵션으로도 열지 않는다.**

---

## 3. 파일 레이아웃과 포맷

```
erdd.config.yaml          # serverUrl·projectId 는 optional 이 된다 — init --local 이 만드는 것은 이것뿐이다
erdd/                     # 커밋 대상
├─ tables/*.yaml          #   변경 없음 — 스키마만 담아 diff 를 조용하게 유지
├─ groups.yaml · words.yaml · terms.yaml · domains.yaml · custom-fields.yaml
└─ layout.yaml            # ★ 신규
.erdd/                    # git-ignore
├─ snapshots.json         # ★ 신규
└─ base.json · sync.json · credentials.json   # 서버에 연결된 경우에만
```

### `erdd/layout.yaml`

```yaml
# 캔버스 배치. 로컬 모드에서만 읽고 쓴다.
tables:
  - id: 018f6b0e-…          # identity. name 은 사람이 읽기 위한 값이다
    name: MBR
    position: { x: 120, y: 80 }
    groupPosition: { x: 40, y: 60 }   # 없으면 생략
notes:
  - id: 018f6b0e-…
    content: 정산 배치는 매일 02:00
    position: { x: 400, y: 200 }
    color: '#fde68a'
```

- 모델 필드와 **1:1 로 대응**시킨다(`position`·`groupPosition`). 변환 코드가 얇을수록 어긋날 자리가 없다.
- 테이블 식별은 `id` 다. `name` 은 사람이 읽기 위한 값이고, 물리명이 바뀌어도 매칭에 쓰이지 않는다 —
  기존 파일 포맷의 "이름으로 읽고 id 로 식별" 관례와 같다.
- **항목이 없거나 파일 자체가 없으면 결정적 격자 배치로 떨어진다.** `filesToModel` 은 모든 테이블에
  `position: {x:0, y:0}` 을 주므로(`file-format.ts:435`) 그대로 두면 전부 한 점에 겹친다. 물리명
  오름차순으로 격자에 놓아 `erdd pull` 로 받아 온 프로젝트가 좌표 파일 없이도 읽을 수 있게 연다.
  더 나은 배치는 에디터의 「자동 정렬」(dagre)이 하고, **dagre 를 core 에 들이지 않는다**(HANDOFF 3.5).
- 모델에 없는 id 가 layout 에 남아 있으면 조용히 버린다(테이블이 지워진 뒤의 잔재).

### `.erdd/snapshots.json`

```json
{ "snapshots": [ { "id": "…", "name": "…", "createdAt": "…", "model": { … } } ] }
```

모델 전체 사본이므로 좌표·메모도 함께 들어간다 — 복원하면 배치까지 돌아온다.

### core 의 분업

좌표·메모의 직렬화 규칙은 **core 의 순수 함수**로 둔다(`packages/core/src/layout.ts`).

```ts
export function layoutFromModel(model: ProjectModel): LayoutData
export function applyLayout(model: ProjectModel, layout: LayoutData): ProjectModel
```

YAML 인코딩/디코딩은 로컬 서버가 한다 — core 는 IO free 라는 규칙(HANDOFF 3.5)과 기존
`file-format.ts` 의 분업을 그대로 따른다.

---

## 4. 로컬 서버 구조

### 위치

**`packages/cli/src/local/`**. `erdd serve` 가 이것을 **동적 `import()`** 한다 — 그래야 `pull`·
`validate` 같은 기존 명령의 부팅에 Fastify 가 얹히지 않는다(core 가 `exceljs` 를 다루는 방식과 같은
정신).

> ⚠️ **별도 패키지(`packages/local-server`)로 가르지 않는다 — 순환 의존이 된다.** 로컬 서버는
> `readTree`/`writeTree`(대소문자 무시 파일시스템의 삭제 순서 같은 급소가 들어 있다)를 써야 하는데
> 그것은 `packages/cli/src/tree.ts` 에 있고, CLI 는 `serve` 에서 로컬 서버를 부른다. 패키지를 가르면
> 둘이 서로를 의존한다. 패키지 경계의 목적(다른 명령의 부팅 비용)은 동적 `import()` 가 이미
> 달성하므로 가를 이유가 없다.

`fastify`·`@trpc/server` 는 `@erdd/cli` 의 런타임 의존성으로, `@erdd/server` 는 **타입 전용
devDependency** 로 붙는다(계약 잠금에 `AppRouter` 타입이 필요하다 — `apps/web` 이 이미 같은 형태로
의존한다).

### FileStore — 로컬 서버의 유일한 상태

| 동작 | 내용 |
|---|---|
| `load()` | `readTree(cwd)` → `filesToModel` → `layout.yaml` 병합 → `ProjectModel`. 메모리에 모델과 `seq` 를 든다 |
| `save(model)` | `modelToFiles` + 좌표·메모 분리 → **변경된 파일만** 쓰기(`diffTrees` 재사용) |
| 직렬화 | 모든 mutate 를 단일 promise 체인으로 직렬화 — 서버의 프로젝트 행 `FOR UPDATE` 락에 대응하는 자리다 |
| 디바운스 | 디스크 쓰기는 **300ms 디바운스**. 종료 시 flush |

- **`seq` 를 유지한다.** 웹의 낙관적 갱신과 resync 경로가 `seq` 로 "내 mutation 사이에 남의 변경이
  끼어들었는가"를 판정한다(`use-model.ts`). 로컬에 남이 없어도 **파일 감시로 인한 재로드**가 정확히 그
  상황이므로, seq 는 로컬에서도 의미가 있다.
- **로드 시 `new:` id 를 실제 UUIDv7 로 확정해 파일에 되쓴다.** 에이전트가 `id` 없이 쓴 테이블을 GUI 가
  임시 id 로 편집하면 다음 로드에서 다른 객체가 된다. CLI push 의 `reserve-ids`(HANDOFF 3.9)와 같은
  문제라 같은 방식으로 닫는다.
- **op 검증은 core 를 그대로 쓴다** — `parseOps` 와 `MAX_OPS_PER_MUTATION`(5000)은 서버가 아니라
  `packages/core/src/op-guard.ts` 의 것이라(`@erdd/core` 에서 export 된다) 로컬 서버가 같은 함수·같은
  상한을 그대로 가져다 쓴다. 웹이 이 상수로 미리 막는 가드를 갖고 있어(`bulk-panel.tsx`), 로컬만
  상한을 없애면 규칙이 두 벌이 된다.

### 라우터

| 프로시저 | 로컬 구현 |
|---|---|
| `auth.me` | 고정 사용자 + `mode: 'local'` |
| `project.get` | config 의 방언·명명 규칙 + 편집·관리 권한 항상 참 |
| `project.update` | `erdd.config.yaml` 에 되쓰기 |
| `model.get` | 메모리 모델 + seq |
| `model.mutate` | `applyOps` → 메모리 갱신 → 디바운스 쓰기 |
| `snapshot.{list,get,create,restore,delete}` | `.erdd/snapshots.json` |

이게 전부다. `revision.*` · `resource.*` · `promotion.*` · `org.*` · `admin.*` · `invitation.*` 는
구현하지 않는다(해당 UI 가 로컬 모드에서 숨겨진다).

> ⚠️ **이 안의 유일한 실질 리스크는 계약 표류다.** 웹은 `AppRouter` **타입**으로 클라이언트를 만들므로,
> 로컬 라우터의 입출력이 어긋나도 **컴파일에 안 잡히고 런타임에 깨진다.** 그래서
> `inferRouterInputs/Outputs<AppRouter>` 에서 뽑은 타입을 로컬 구현이 만족하도록 **컴파일 타임에
> 강제**하고, 프로시저 이름 집합을 대조하는 테스트를 함께 둔다. 이 잠금은 선택이 아니다.

### 정적 서빙과 라우팅

- `web/dist` 를 정적 서빙한다(지금 `apps/server/src/server.ts` 가 하는 것과 같은 형태).
- 웹 라우트가 `/p/:projectId` 이고 입력이 `z.string().uuid()` 이므로, 로컬 서버는 config 의
  `projectId` 가 있으면 그것을, 없으면 **고정 UUID 상수**를 쓴다. 이 값은 실행마다 새로 만들지 않는다 —
  바뀌면 사용자가 북마크한 주소와 브라우저에 남은 상태가 매번 무효가 된다. `/` 로 들어오면 그 경로로
  리다이렉트한다.

### 외부 변경 감지

`fs.watch` 로 `erdd/` 와 `erdd.config.yaml` 을 본다(디바운스). **자기가 쓴 변경은 내용 해시로
걸러낸다** — 걸러내지 않으면 쓰기 → 감시 → 재로드 → 쓰기의 루프가 돈다.

감지되면 재로드한 뒤 **SSE(`GET /local/events`)로 `reload` 한 줄**을 보낸다. WebSocket 이 아닌 이유는
로컬 모드에 presence 가 없어 단방향이면 충분하기 때문이다 — 기존 realtime 프로토콜은 op 브로드캐스트와
presence 를 나르는데 둘 다 로컬에 없다.

---

## 5. 웹 클라이언트의 로컬 모드

- `Me` 타입에 `mode` 를 더하고, `useMe()` 로 내려온 값으로 분기한다.
- **다이얼로그 트리거는 `header-tools.tsx` 한 곳만 렌더한다**는 기존 불변식(HANDOFF 3.4) 덕에,
  「공용 리소스」를 빼는 것이 **그 파일 한 곳**에서 끝난다.
- **「버전」 버튼은 남는다.** 그 다이얼로그는 탭 셋(스냅샷·이력·비교)이고, 제거 대상은 `revision.list`
  를 부르는 **「이력」 탭 하나**다. 스냅샷과 비교는 `snapshot.*` 만 쓰므로 그대로 동작한다.
- ⚠️ **닫힌 다이얼로그로는 부족하다 — 렌더 자체를 막아야 한다.** `ResourcePanel` 은 `enabled` 가드
  없이 `resource.library.listForProject` 를 마운트 즉시 부르고, `PendingPromotionsBadge`(`AppShell`)
  는 `promotion.pendingCount` 를 60초마다 폴링한다. 로컬 라우터에 없는 프로시저라 조건부 렌더가
  아니면 화면에 오류가 뜬다.
- `project.tsx` 에서 `PresenceBar`·`UserMenu` 를 빼고, `useRealtime` 대신 `useLocalWatch`(SSE)를 쓴다.
- `/` 는 에디터로 리다이렉트한다. 프로젝트 설정 화면은 방언·명명 규칙만 남긴다.
- 파일이 깨져 읽기 전용으로 전환된 동안에는 배너를 띄우고 편집 진입점을 막는다(§6).

---

## 6. 오류 처리와 엣지케이스

### 파일이 깨졌을 때 (가장 중요한 갈림)

에이전트나 사람이 `erdd/` 안의 YAML 을 잘못 쓰는 일은 이 워크플로에서 **정상적으로 일어난다.**

감시가 잡은 재로드에서 **YAML 파싱 실패 · 스키마 위반 · 무결성 위반(`validateModelIntegrity`)** 이 나면:

1. 마지막 정상 모델을 유지한다(재로드하지 않는다).
2. **에디터를 읽기 전용으로 전환**하고 배너로 파일 경로와 사유를 보여 준다.
3. 파일이 고쳐지면 자동으로 편집 가능 상태로 복귀한다.

편집을 계속 허용하면 **잘못된 파일을 성한 메모리 모델로 덮어써 사용자의 수정이 조용히 사라진다.**

`validate` 가 내는 경고(명명 · 필수 커스텀 항목 등)는 **오류가 아니다** — 지금처럼 모델 검사 화면에
뜨고 편집을 막지 않는다.

### 그 밖

| 상황 | 처리 |
|---|---|
| 포트 사용 중 | 자동 증가시키지 않고 명확히 실패 + `--port` 안내(에이전트가 엉뚱한 포트에 붙는 것을 막는다) |
| 브라우저 탭 여러 개 | 같은 서버를 보므로 SSE `reload` 로 함께 갱신된다 |
| GUI 가 떠 있는 채로 `erdd pull` | pull 이 파일을 덮어쓰고 감시가 그것을 잡아 에디터가 resync 한다. 기존 pull 의 "로컬 변경 덮어씀 — 확인 프롬프트" 동작 그대로 |
| `erdd/` 가 아예 없음 | 빈 모델로 시작하고 첫 편집에서 파일을 만든다. **`erdd init --local` 은 `erdd.config.yaml` 과 `.gitignore` 한 줄만 쓰고 `erdd/` 를 만들지 않으므로, 새 로컬 프로젝트는 언제나 이 경로로 시작한다** |
| 서버 종료(Ctrl+C) | 디바운스 대기 중인 쓰기를 flush 한 뒤 종료 |

---

## 7. 테스트 전략

| 대상 | 잠글 것 |
|---|---|
| **core** | `layoutFromModel`/`applyLayout` 왕복(좌표·메모 무손실), 항목이 빠진 layout 에서 자동 배치로 떨어지는 것, 모델에 없는 id 를 버리는 것 |
| **local-server** | FileStore 왕복, mutate 직렬화, 디바운스 flush, 외부 변경 재로드, 자기 쓰기 무시(루프 방지), 깨진 파일 → 읽기 전용 전환과 복귀, `new:` id 확정 |
| **계약** | 로컬 라우터가 `AppRouter` 부분집합과 타입 일치(컴파일 시점) + 프로시저 이름 집합 대조 |
| **web** | 로컬 모드에서 숨겨야 할 UI 전수(버전 · 공용 리소스 · 참여자 · 사용자 메뉴), `/` 리다이렉트, 읽기 전용 배너 |
| **CLI** | `readConfig` 완화 뒤 `pull`/`push`/`diff` 가 연결 설정 없이 **명확히 실패**하는 것 |

**계약 잠금은 빠지면 안 된다** — §4 의 리스크를 닫는 유일한 자리다.

---

## 8. 범위 밖 (의도적)

- **npm 공개 배포 파이프라인** — 지금도 없다(`docs/16-cli.md` 6절 이월). `serve` 는 워크스페이스의
  `web/dist` 를 참조한다.
- **로컬 모드의 다중 프로젝트** — 디렉터리 하나 = 프로젝트 하나.
- **로컬 협업** — 여러 사람이 한 로컬 서버에 붙는 것. presence·op 브로드캐스트를 되살리는 일이다.
- **로컬 인증** — 127.0.0.1 바인딩으로 대신한다.
- **공용 리소스의 로컬 라이브러리** — 라이브러리는 서버 테이블이다.
- **Revision 이력** — D3.
- **로컬 → 서버 프로젝트 승격** — 별도 명령을 만들지 않는다. ⚠️ **다만 `erdd.config.yaml` 에
  `serverUrl` + `projectId` 를 적는 것만으로는 `push` 가 되지 않는다**(2026-08-20 실측):
  `buildPlan` 이 기준선 `.erdd/base.json` 을 요구해 `기준 시점이 없습니다. 먼저 erdd pull을
  실행하세요` 로 멈춘다. 실제 경로는 「서버에 프로젝트를 만들고 `pull` 로 기준선을 받은 뒤(그 pull 이
  로컬 파일을 서버 상태로 덮어쓰므로 커밋해 둔 `erdd/` 를 git 에서 되살려 얹는다) `push`」다.
  `docs/manual/cli-guide.md` 3.4 에 그렇게 적었다.

---

## 9. 영향받는 파일

**신규**

- `packages/cli/src/local/**` — Fastify + 축소 tRPC 라우터 + FileStore + 감시 + SSE
- `packages/core/src/layout.ts` (+ 테스트)
- `apps/web/src/editor/use-local-watch.ts`

**변경**

- `packages/cli/src/config.ts` — `serverUrl`·`projectId` optional
- `packages/cli/src/main.ts` — `serve` 명령, `init --local`, USAGE
- `packages/cli/src/commands/init.ts` — 로컬 초기화 경로
- `packages/cli/src/commands/{pull,push,diff,status}.ts` — 연결 설정 없을 때의 실패 메시지
- `apps/server/src/routers/auth.ts` — `mode: 'server'` (**`auth.me` 한 곳**, 반환 타입을 `RunMode` 로 명시)
- `apps/web/src/components/require-auth.tsx` — `Me` 에 `mode`
- `apps/web/src/editor/header-tools.tsx` — 로컬 모드에서 「공용 리소스」 제외(§5 대로 **「버전」은
  남는다** — 그 안의 「이력」 탭만 `apps/web/src/editor/version-dialog.tsx` 에서 빠진다)
- `apps/web/src/pages/project.tsx` — presence·사용자 메뉴 제외, 감시 훅 교체
- `apps/web/src/routes.tsx` — 로컬 모드의 `/` 리다이렉트
- `apps/web/src/pages/project-settings.tsx` — 로컬 모드에서 방언·명명 규칙만

**문서**

- `docs/16-cli.md` — 로컬 모드 절, 파일 포맷에 `layout.yaml`
- `docs/manual/cli-guide.md` — `serve`·`init --local` 명령 레퍼런스(실물 출력 인용)
- `docs/02-architecture.md` — 실행 형태 둘(서버 / 로컬)
- `docs/superpowers/HANDOFF.md` — 완료 표·불변식(계약 잠금)
