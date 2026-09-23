# CLI 공용 사전 동기화 — 로컬 편집 + 서버 보관함 + `erdd dict`

## 배경과 목표

**사용 형태:** 프로젝트마다 편집은 로컬(`erdd serve` + git)에서 하고, 서버는 **최종 보관·열람용**으로
push 해 둔다. 조직 공용의 단어·용어·도메인(·커스텀 항목)은 서버 라이브러리에서 받아 쓴다.

**지금 막히는 곳**

- 공용 리소스(라이브러리 가져오기·승격)는 **서버 웹 화면에만** 있다. 로컬 모드에는 없고 CLI 명령도 없다.
- 라이브러리 프로시저가 전부 `authedProcedure`(세션 전용)라 토큰으로 부를 수 없다.
- 파일에 `origin` 이 없어서, 로컬 사본이 어느 라이브러리 항목에서 왔는지 모른다 — 재동기화 판정이 불가하다.
- 로컬 전용 프로젝트를 서버로 옮기는 전용 명령이 없다(`pull` 로 덮은 뒤 `git checkout` 으로 되얹는 수동 절차).

**사용자 결정**

| 질문 | 결정 |
|---|---|
| 서버 사본의 역할 | **최종 보관·열람.** 서버에서 편집하는 일은 드물다 |
| 받아 온 사전의 추종 | **기본은 복사.** 다만 출처 id·버전을 관리해 이후 pull(재동기화)·push(승격)가 가능해야 한다 |
| 로컬에서 사전 push 시 권한 | **웹과 동일** — 쓰기 권한이 있으면 직접 승격, 없으면 승격 요청(조직 관리자 승인) |
| 구조 | **A안** — 서버 프로젝트를 처음부터 두고(보관함), 편집은 로컬에서 한다 |

**A안을 고른 이유.** 승격 요청 행은 payload 없이 `entityIds` 포인터만 담고, 승인 시점에 서버가 **그
프로젝트 모델**에서 계획을 재계산한다(`runPromoteInTx` 가 유일한 엔진). 서버 프로젝트가 없는 순수
로컬 상태에서는 요청을 걸 대상이 없다. payload 를 받는 두 번째 승격 경로(B안)는 가이드가 배제한 설계
(요청 행이 별도의 진실 원본이 됨, `origin.base` 재유도)를 뒤집어야 한다.

**수용한 비용.** 「로컬 전용 모드」가 사실상 「연결형 + 로컬 편집」이 된다. `dict push` 전에 `erdd push`
를 요구하므로 보관함이 중간 상태를 거친다.

## 범위

**포함**

1. `erdd/origins.yaml` — `origin` 을 커밋되는 파일에 싣고, push/pull 계약을 「`origin` 도 파일이 진실」로 바꾼다.
2. `erdd dict pull` · `erdd dict list` — 라이브러리 → 로컬 파일 (core `planResync`/`applyResyncPlan` 로컬 실행).
3. `erdd dict push` · `erdd dict requests` — 로컬 → 라이브러리 (서버의 기존 승격 엔진).
4. `erdd init --create` — 서버 프로젝트 생성 + 연결. 로컬 전용 프로젝트 이관을 겸한다.
5. 위가 쓰는 서버 프로시저를 `apiProcedure` 로 연다.

**제외**

- 로컬 웹 에디터(`erdd serve`)의 「공용 리소스」 패널 — 지금처럼 렌더하지 않는다. 사전은 CLI 로만 주고받는다.
- 승격 요청의 승인·취소 — 웹에서 한다.
- op 5,000 상한을 넘는 push 의 청크 분할 — 기존 한계 그대로다.

---

## 1. 전체 흐름

```bash
# ① 시작 — CLI 가 서버에 빈 프로젝트를 만들고 연결한다
erdd init --server https://erdd.example.com --token "$ERDD_TOKEN" --create --org 플랫폼팀 --name 주문시스템

# ② 공용 사전 받기 — 처음이면 전부 복사, 이후는 재동기화(3-way)
erdd dict pull --library "플랫폼팀 표준 사전"   # 구독이 config 에 남는다
erdd dict pull                                  # 이후로는 구독 전부

# ③ 평소 작업 — 지금과 같다
erdd serve   # → 저장 → git commit

# ④ 새 단어를 공용으로 올리기
erdd push -m "…"                                # 보관함을 먼저 최신으로
erdd dict push --library "플랫폼팀 표준 사전"   # 쓰기 권한 → 승격 / 없으면 → 승격 요청

# ⑤ 아카이빙
erdd push -m "1차 오픈 스키마"
```

---

## 2. `origin` 을 파일에 싣는다

### 2.1 `erdd/origins.yaml`

```yaml
# 공용 사전에서 온 항목의 출처. erdd dict pull / push 가 쓴다 — 손으로 고치지 않는다.
origins:
  - id: 0192f3a1-…         # 프로젝트 엔티티 id (words/terms/domains/custom-fields 의 id)
    kind: word             # domain | word | term | customField
    library: 0191c0de-…    # origin.libraryId
    item: 0191c0ff-…       # origin.sourceId
    version: 3             # origin.sourceVersion
    base:                  # origin.base — 가져온 시점의 프로젝트 공간 payload
      name: 고객
      abbreviation: CUST
      englishName: Customer
      description: ''
```

- **인라인이 아니라 별도 파일이다.** `base` 는 payload 사본이라 사전 파일에 인라인하면 항목 길이가
  두 배가 되고 사람이 고치는 파일과 기계가 관리하는 파일이 섞인다. 사전 파일 diff 는 내용 변경만,
  출처 변경은 `origins.yaml` diff 로 따로 보인다.
- `base` 는 프로젝트 공간 값 그대로다 — 용어의 `domainId` 는 **프로젝트 도메인 id** 다(사전 파일은
  이름으로 참조하지만 이 파일은 기계용이라 id 를 쓴다).
- 출처가 0건이면 파일을 쓰지 않는다. 파일이 없으면 출처 0건이다.
- `TOP_LEVEL_FILES` 에 등록한다.

### 2.2 판독 규칙 (`filesToModel`)

| 상황 | 처리 |
|---|---|
| 스키마 불일치 · 같은 `id` 중복 · `kind` 와 실제 엔티티 종류 불일치 | **파일 오류** — `serve` 편집 잠금, `push`·`dict` 거절, `validate` 가 가리킨다 |
| 가리키는 엔티티가 없음 | **조용히 무시**, 다음 쓰기(`modelToFiles`)에서 정리된다. 출처는 부속 정보라 편집을 잠그면 과잉이다 |
| 파일 없음 | 출처 0건 |

`serve` 에서 이름을 고치면 `origin` 은 남고 payload ≠ `base` 가 되어 「프로젝트가 고침」으로 판정된다
— 3-way 가 의도한 동작이다. 항목을 지우면 `origins.yaml` 의 그 줄도 다음 저장에서 사라진다.

### 2.3 push/pull 계약 변경

| | 지금 | 바뀐 뒤 |
|---|---|---|
| `FILE_INVISIBLE_FIELDS` | 사전 4종의 `origin` 이 파일 비가시 필드 | **목록에서 뺀다.** 일반 병합 필드(객체 전체를 한 값으로 `deepEqual` 비교) |
| 서버 모델 정규화 | `clearOrigin` 으로 지움 | 지우지 않는다 |
| `pull` | `origin` 을 버림 | `origins.yaml` 로 쓴다 |
| `push` | 서버 `origin` 을 그대로 통과 | 파일의 `origin` 이 op 로 올라간다 |

**하위호환.** 웹에서 가져오기를 한 기존 서버 프로젝트는 옛 `.erdd/base.json` 과 로컬 파일에
`origin` 이 없고 서버에만 있다. 3-way 는 「서버만 바뀜 → 서버 채택」이라 **충돌 없이** 첫 `pull` 에서
`origins.yaml` 이 생긴다. 첫 `pull` 전의 `push` 도 같은 판정이라 서버 `origin` 을 지우지 않는다 —
이 두 사례를 테스트로 고정한다.

**충돌.** 서버 쪽 `origin` 은 웹 재동기화·승격으로만 바뀐다(보관함이라 드물다). 양쪽이 같은 항목의
출처를 바꾸면 기존 충돌 보고로 멈추고 `pull` 후 정리한다.

---

## 3. `erdd dict pull` · `erdd dict list`

라이브러리 항목을 토큰으로 받아 **로컬 파일 모델**에 core `planResync` → `applyResyncPlan` 을 돌리고
파일(사전 파일 + `origins.yaml`)에 쓴다. **서버 프로젝트 모델은 건드리지 않는다** — 보관함은 다음
`erdd push` 때 따라온다.

### 3.1 구독

```yaml
# erdd.config.yaml
dictionaries:
  - id: 0191c0de-…
    name: 플랫폼팀 표준 사전   # 표시용. 서버에서 이름이 바뀌면 다음 pull 이 고쳐 쓴다
```

- `erdd dict pull --library <이름|id>` — 구독에 없으면 추가하고 받는다. 이름은
  `resource.library.listForProject` 결과(이 프로젝트에서 보이는 전역 + 조직 라이브러리) 안에서 찾는다.
  모호하면 후보 목록을 보이고 멈춘다(USAGE).
- `erdd dict pull` — 구독 전부를 **config 순서대로** 처리한다. 라이브러리마다 계획을 따로 세운다.
- `erdd dict list` — 보이는 라이브러리(범위·항목 수·구독 여부·쓰기 가능 여부).
- 옛 config 에는 `dictionaries` 가 없다 — 누락은 빈 목록으로 읽는다. 잘못 적은 값은 VALIDATION 오류다.

### 3.2 결정 기본값 — 웹 「가져오기」의 기본 선택과 같다

| 상태 | 기본 | 옵션 |
|---|---|---|
| 신규 추가 | 적용 | — |
| 신규 + 이름 중복(`nameClash`) | **건너뜀** | `--adopt` — 같은 이름의 프로젝트 항목에 출처를 연결 |
| 자동 갱신 | 적용 | — |
| 충돌 | **보류**(`defer`) | `--conflicts theirs`(= `apply`) · `--conflicts ours`(= `keep`) |

### 3.3 `--adopt` — 이름으로 연결

로컬로 시작해 이미 자기 단어가 있는 프로젝트가 사전에 합류하는 경로다.

- core `ResyncDecision` 에 `'adopt'` 를 더한다. `added` + `nameClash` 항목에만 유효하다.
- **내용은 그대로 두고 `origin` 만 붙인다.** `base` 는 라이브러리 payload 를 **투영한 값**(`origin.base`
  규칙과 같다). 내용이 같으면 곧바로 동기 상태, 다르면 「프로젝트가 고친 항목」이 되어 원본이 바뀔 때
  충돌로 알린다(자동 갱신이 조용히 덮지 않는다).
- 대상 선정은 같은 종류·표시 이름 완전일치(`nameClash` 와 같은 기준). 후보가 둘 이상이면 id 오름차순
  첫 항목이다(결정성). 이미 다른 출처가 붙은 항목은 대상에서 뺀다.

### 3.4 출력

```
$ erdd dict pull
플랫폼팀 표준 사전 (조직)
  추가 12 · 자동 갱신 3 · 유지 1,180
  충돌 2 — 보류:
    단어 고객   약어  CUST → CSTMR
    용어 고객번호  도메인  NO → ID
  이름 중복 4 — 건너뜀 (--adopt 로 연결)
반영했습니다 — erdd/words.yaml, erdd/terms.yaml, erdd/origins.yaml
```

- `--dry-run` — 계획만 보이고 파일을 쓰지 않는다(`erdd diff` 와 같은 미리보기 계약).
- `--json` — 기존 규약. 보류된 충돌이 있어도 종료 코드 0(충돌은 계획 결과다).

### 3.5 전제와 한계

- 로컬 파일이 깨져 있으면 거절(`erdd validate` 를 가리킨다).
- `erdd serve` 가 떠 있어도 된다 — 파일 감시가 받고, 미저장 편집이 있으면 기존 「파일이 밖에서
  바뀌었습니다」 배너가 뜬다.
- 로컬 적용에는 op 상한이 없다. 대형 사전의 첫 수신은 다음 `erdd push` 에서 5,000 상한에 걸릴 수 있다
  — 알려진 한계로 적는다.
- `planResync` 의 무정렬 순회(가이드의 알려진 한계)는 CLI 결정성을 위해 **라이브러리 항목을 id 순으로
  정렬해 넘겨** 피한다.

---

## 4. `erdd dict push` · `erdd dict requests`

판정과 쓰기는 **서버의 기존 엔진**(`runPromoteInTx`, `promotion.create`)이 **서버 프로젝트 모델** 기준으로
한다. CLI 는 계획을 보이고 보낼 항목을 고른다.

### 4.1 전제 — push 하지 않은 로컬 변경이 없다

```
push 하지 않은 로컬 변경이 있습니다. erdd push 로 보관함을 먼저 갱신하세요   (종료 코드 1)
```

승격 대상은 서버 프로젝트의 엔티티다. 로컬에서 고친 값이 서버에 없는 채로 승격하면 **보던 값이 아니라
보관함의 옛 값이** 라이브러리에 올라간다. 자동 push 는 삭제 확인·충돌 중단을 끌고 와 두 명령의 실패
모드가 섞이므로 순서를 명시적으로 요구한다. 판정은 `erdd status` 의 로컬 변경 판정과 같은 것을 쓴다.

### 4.2 흐름

1. `model.get` 과 `resource.items.list` 로 core `planPromote` 를 돌린다(웹 승격 탭과 같은 계산).
2. 기본 선택:

   | 구역 | 기본 | 옵션 |
   |---|---|---|
   | 신규 추가(`new`) | 보냄 | `--kind <종류,…>` · `--name <이름>`(반복) 필터 |
   | 원본 갱신(`update`) | 보냄 | 같음 |
   | 동명 발견(`name-match`) | **안 보냄** | `--include-name-match` |

3. 목록을 보이고 `계속할까요? [y/N]`. `--json` 에서는 `--yes` 필수(기존 규약).
4. `listForProject` 의 `canWrite` 로 갈린다.
   - **쓰기 가능** → `resource.promote`(`expected*` 는 1의 계획에서 채운다). 서버가 락 안에서 재계산해
     어긋난 항목만 건너뛴다. 성공하면 **암묵적 pull** 로 `origins.yaml` 을 받는다 — 전제상 로컬 변경이
     없어 덮을 것이 없다.
   - **쓰기 불가 + 조직 라이브러리** → `promotion.create`(`-m <메모>`). 로컬 파일은 바뀌지 않는다.
   - **쓰기 불가 + 전역 라이브러리** → 서버 오류(`전역 라이브러리로는 승격을 요청할 수 없습니다`)를 그대로 보인다.

```
$ erdd dict push --library "플랫폼팀 표준 사전" -m "주문 도메인 단어"
신규 추가 3 · 원본 갱신 1 · 동명 발견 2(제외 — --include-name-match)
  + 단어 주문상태
  + 단어 배송지
  + 용어 주문상태코드
  ~ 단어 고객   약어 CUST → CSTMR
계속할까요? [y/N] y
승격 요청을 만들었습니다 (4건). 조직 관리자가 웹에서 승인하면 반영됩니다
```

### 4.3 결과

- 건너뛴 항목(`missing`·`plan-changed`)은 사유와 함께 나열하고 종료 코드 0(부분 성공).
- **전부 건너뛰면 종료 코드 1.** 웹의 「선택이 전부 no-op 이면 무반응」을 되풀이하지 않는다.
- 승인된 뒤에는 서버 엔티티에 `origin` 이 붙는다. 로컬은 다음 `erdd push` 의 암묵적 pull 이나
  `erdd pull` 로 받는다 — 2.3 의 계약상 「서버만 바뀜」이라 충돌하지 않는다.

### 4.4 `erdd dict requests`

`promotion.listForProject` 로 이 프로젝트의 요청을 상태·건수·요청 메모·**처리 메모**와 함께 보인다.
`--status pending|resolved|rejected|cancelled` 필터. 취소는 범위 밖(웹 승격 탭).

### 4.5 서버 변경

- `resource.promote` 가 Revision `source` 를 `'web'` 으로 고정한 것을 **토큰 경로면 `'cli'`** 로
  기록한다(`model.push` 가 이미 `'cli'` 를 쓴다).

---

## 5. `erdd init --create`

```bash
erdd init --server <url> --token <t> --create --org <조직 이름|id> --name <프로젝트 이름>
```

| 시작 상태 | 동작 |
|---|---|
| config 없음 | `project.create` → config 작성 → `.erdd/base.json` 을 **빈 모델·seq 0** 으로 기록 → `.gitignore` 정리 |
| **로컬 전용 config** (이관) | `이 로컬 프로젝트를 서버 프로젝트 "<이름>"로 연결합니다. 계속할까요?` 확인. 로컬의 방언·명명 규칙·테이블 옵션을 생성값으로 보내고 config 에는 `serverUrl`·`projectId` 만 채운다. **`erdd/` 는 건드리지 않고** base 는 빈 모델이다 → `erdd diff` 가 전부 「추가」, `erdd push` 로 올린다 |
| 이미 연결된 config | 거절 — 기존 서버 프로젝트를 고아로 만들지 않는다. 다른 프로젝트로 바꾸는 것은 기존 `--project` + `--yes` |

- local-guide 「로컬로 시작한 프로젝트를 서버로 옮기기」의 수동 5단계를 이 명령이 대체한다.
- `project.create` 입력에 선택 필드 `namingRules`·`tableOptions` 를 더한다. 생성 후 `project.update`
  를 따로 부르면 반쯤 만들어진 프로젝트가 남을 수 있어 한 호출로 끝낸다.
- `--create` 는 `--project` 와 배타다(함께 주면 USAGE). `--dialect`·`--case` 는 config 가 없을 때만
  받는다(생성값). 이관이면 config 의 값이 쓰이므로 함께 주면 USAGE.
- **권한** — 프로젝트 생성은 지금처럼 조직 owner/admin 만. 그 밖은
  `프로젝트 생성 권한이 없습니다 — 조직 관리자에게 프로젝트를 만들어 달라고 한 뒤 --project <id> 로 연결하세요`.

---

## 6. 서버 — 토큰에 여는 프로시저

`apiProcedure` 는 명시적 opt-in 이고 CLI 가 실제로 쓰는 것으로 한정한다.

| 프로시저 | 쓰는 명령 |
|---|---|
| `resource.library.listForProject` | `dict list` · `dict pull` · `dict push` |
| `resource.items.list` | `dict pull` · `dict push` |
| `resource.promote` | `dict push` |
| `promotion.create` | `dict push` |
| `promotion.listForProject` | `dict requests` |
| `project.create` | `init --create` |

권한 판정은 그대로다. `org.list` 는 이미 열려 있어 `--org <이름>` 해석에 쓴다.

---

## 7. 오류 처리

| 상황 | 결과 |
|---|---|
| 로컬 전용 config 에서 `dict` 명령 | `서버에 연결되지 않은 프로젝트입니다. erdd init --server … --create 로 연결하세요` (1) |
| 서버가 옛 버전이라 새 프로시저가 토큰에 닫혀 있음 | UNAUTHORIZED·NOT_FOUND 를 `서버가 이 기능을 지원하지 않습니다 — 서버를 업그레이드하세요` 로 번역 (1). 배포 순서는 **서버 먼저** |
| 구독 라이브러리가 사라짐(삭제·권한 상실) | 그 라이브러리만 건너뛰고 경고, 나머지 진행. 구독은 지우지 않는다 |
| `origins.yaml` 파일 오류 | 기존 파일 오류와 같은 경로 |
| `dict push` 전부 건너뜀 | 사유 나열 후 1 |

---

## 8. 테스트

- **core**
  - `origins.yaml` 왕복(`modelToFiles` ↔ `filesToModel`), 댕글링 무시, `id` 중복·`kind` 불일치 오류.
  - `FILE_INVISIBLE_FIELDS` 게이트 테스트 갱신.
  - 3-way 에서 `origin` 병합 + **하위호환 두 사례**(base·local `null`, server X → X 채택, 충돌 없음 /
    첫 pull 전 push 가 서버 `origin` 을 지우지 않음).
  - `adopt`: `base` 가 투영값, 용어의 도메인 참조 매핑, 내용이 같으면 곧바로 동기 상태, 이미 출처가 붙은
    항목 제외, 후보 둘 이상이면 id 오름차순.
- **cli**(가짜 클라이언트)
  - `dict pull`: 기본 결정, `--conflicts`, `--adopt`, **`--dry-run` 이 파일을 쓰지 않음**, 라이브러리
    처리 순서·항목 정렬의 결정성, 사라진 구독 건너뛰기, 옛 config(`dictionaries` 없음) 읽기.
  - `dict push`: 로컬 변경이 있으면 거절, `canWrite` 갈림, 직접 승격 후 암묵적 pull, 전부 건너뜀이면 1.
  - `init --create`: 신규, 이관(`erdd/` 불변 + base 가 빈 모델), 연결된 config 거절, 옵션 배타.
- **server**
  - 새로 연 6개가 토큰으로 호출되고, **목록 밖 프로시저는 여전히 토큰을 거절**.
  - `resource.promote` 의 source 가 토큰 경로면 `'cli'`.
  - `project.create` 의 새 선택 필드.
- **스모크**(실서버): `init --create` → `dict pull` → `serve` 편집 → `push` → `dict push`(요청) → 웹 승인
  → `pull` 로 `origins.yaml` 반영 확인. 이관 경로(`init --local` → 편집 → `init --create` → `push`)도 한 번.

---

## 9. 문서 영향

| 문서 | 바뀌는 것 |
|---|---|
| `guides/cli.md` | 토큰에 연 프로시저, 「파일에 `origin` 을 담지 않는다」 한계 삭제, `dict push` 의 전제와 이유 |
| `guides/shared-resources.md` | CLI 경로도 같은 엔진을 탄다는 규칙, `adopt` 의 `origin.base` 규칙, 「요청자는 반려 사유를 볼 수 없다」를 웹 UI 한정으로 축소 |
| `guides/data-layer.md` | `TOP_LEVEL_FILES` 등록처에 `origins.yaml` |
| `guides/release.md` | 서버 먼저 배포 |
| `manual/cli-guide.md` | `dict` 명령 4종, `init --create`, 파일 구조에 `origins.yaml`, 「파일에 담기지 않는 것」 표 수정 |
| `manual/local-guide.md` | 1절 대조표의 공용 리소스, 「로컬로 시작한 프로젝트를 서버로 옮기기」를 `init --create` 로 교체 |
| `manual/user-guide.md` 13장 | CLI 로도 가져오기·승격할 수 있다는 한 줄 |
