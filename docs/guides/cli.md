# CLI — 토큰 인증·push 동시성·멱등성·로컬 모드

`packages/cli`(`@erdd/cli`, 바이너리 `erdd`)와 그것이 기대는 서버 계약이다.
사용자용 레퍼런스는 [../manual/cli-guide.md](../manual/cli-guide.md)·
[../manual/local-guide.md](../manual/local-guide.md), 게시는 [release.md](release.md).

---

## 액세스 토큰 인증

> **새 tRPC 프로시저의 기본은 `authedProcedure`(세션 전용)다.** 액세스 토큰으로 호출 가능하게 하려면
> **`apiProcedure` 로 명시적으로 열어야 하고**, 그 목록은 CLI 가 실제로 쓰는 것으로 한정한다.
> 기본이 거부이므로 프로시저를 추가해도 토큰에 저절로 열리지 않는다.

토큰은 `erdd_pat_` 접두의 평문을 사용자에게 한 번 보여 주고 **SHA-256 해시만 저장**한다.
권한은 조직·프로젝트 역할에서 그대로 파생된다(새 축이 아니다). **만료가 없고 폐기만 가능하다.**

**지금 토큰에 열린 프로시저는 `apiProcedure` 를 grep 하면 나온다** —
`grep -rn "apiProcedure" apps/server/src/routers | grep -v "test\|import"`. 각각을 부르는 CLI 명령은 이렇다.

| 프로시저 | 쓰는 명령 |
|---|---|
| `auth.me` · `org.list` · `project.list` · `project.get` | `init`(연결 확인·선택), `pull` |
| `model.get` · `model.push` | `pull`·`push`·`diff`, `dict push`(계획) |
| `project.create` | `init --create` |
| `resource.library.listForProject` · `resource.items.list` | `dict list`·`dict pull`·`dict push` |
| `resource.promote` · `promotion.create` | `dict push`(쓰기 권한이면 앞, 아니면 뒤) |
| `promotion.listForProject` | `dict requests` |

- **토큰의 폭발 반경은 발급자의 역할과 같다.** 조직 Owner/Admin 의 토큰은 **프로젝트를 만들고
  조직 라이브러리에 직접 쓴다**(`project.create`·`resource.promote`), 서비스 관리자의 토큰은 **전역
  라이브러리에도 쓴다.** 에이전트·CI 에 줄 토큰은 편집자 계정으로 발급하라고 매뉴얼이 안내한다
  (`cli-guide.md` 「개인 액세스 토큰 발급」). 역할 밖의 쓰기는 서버가 그대로 거절한다 — 토큰 경로라고
  권한 판정을 따로 두지 않는다.
- **`resource.promote` 는 토큰 경로면 Revision `source` 를 `'cli'` 로 남긴다**(`model.push` 와 같다).
- **새 서버 기능을 CLI 에서 부를 때는 `dict-shared.ts` 의 `guardFeature` 로 감싼다.** 옛 서버는 그
  프로시저를 세션 전용 거절(401 「액세스 토큰으로 할 수 없습니다」)이나 프로시저 부재(404)로 막는데,
  사용자가 고칠 수 있는 것은 서버 업그레이드뿐이라 둘을 「서버가 이 기능을 지원하지 않습니다 — 서버를
  업그레이드하세요」로 번역한다. 감싸지 않으면 사용자는 토큰이 틀린 줄 알고 재발급한다. 토큰 자체가
  틀린 401 은 문구가 달라 이 번역에 걸리지 않는다.

## push 의 낙관적 동시성

- **`runMutation` 의 `deriveOps` 가 `(model, seq)` 를 받는다.** `currentSeq` 조회를 `deriveOps` 호출
  **위로** 끌어올려, `model.push` 의 `expectedSeq` 비교가 프로젝트 행 `FOR UPDATE` 락 안에서 이뤄지는
  유일한 지점이 됐다 — **이 지점이 CLI push 의 유일한 경합 방어선이다.** 락 밖에서 seq 를 읽으면
  읽기와 커밋 사이에 남이 끼어들 여지가 생긴다.
- 기존 호출자 `model.mutate`·`snapshot.restore` 는 두 번째 인자를 무시해 무영향이고
  `mutateAndPublish` 도 시그니처를 그대로 통과시킨다.

## push 의 신규 id 고정 (멱등성)

커밋 후 응답이 유실돼도 다음 push 가 사본을 만들지 않게 하는 층이다.

- **`filesToModel` 은 `newId` 를 받으면 입력 트리의 `structuredClone` 위에서 파싱하고, 발급한 id 를
  그 복사본에 되써 `assignedTree` 로 낸다.** `newId` 가 없으면 복사도 `assignedTree` 도 없다 —
  `pull`·`validate` 는 큰 트리를 다루므로 복사 비용을 지면 안 된다.
- **되쓰는 자리는 발급 자리(`idOf`) 하나뿐이다.** 별도 `assignMissingIds` 순회를 두면 컬렉션 아홉 중
  한쪽만 고쳐질 때 조용히 빈 자리가 생기고, **그 자리가 정확히 「매번 새 id 를 받는」 자리라 원래
  버그가 부분적으로 되살아난다.** 새 파일 종류가 붙어도 `idOf` 를 지나기만 하면 저절로 따라온다.
- **완전성은 두 단언으로 잠겨 있다** — 「채운 트리를 다시 파싱하면 임시 id 가 0건」과
  **「두 모델의 id 집합이 같다」**. ⚠️ **후자가 없으면 파일에 쓰는 id 와 op 가 서버로 나르는 id 가
  갈려도 아무 테스트가 안 잡는다** — 실제로 그 상태였고, 되쓰기를 완전히 다른 id 로 바꿔도 core
  스위트가 전부 통과했다. 그런 구현이면 다음 push 가 파일의 id 를 서버에서 못 찾아 원래 버그 그대로
  사본을 만든다.
- **사전 파일에 id 를 고정하는 경로가 하나 더 있다 — `dict pull`.** `dict-shared.ts` 의
  `readLocalModel` 이 `filesToModel(tree, { newId: uuidv7 })` 로 **실제 uuid** 를 발급하고 그 모델을
  `modelToFiles` 로 다시 쓰므로, 사람이 id 없이 적은 단어가 이 명령을 지나면 id 를 갖는다. ⚠️ **`newId`
  없이 조립하면 임시 id(`new:…`)가 사전 파일에 그대로 새어 나간다** — 다음 `push` 는 그 문자열을 서버
  id 로 보낸다. `dict-pull.test.ts` 「id 없는 로컬 단어가 있어도 파일에 new: 임시 id 를 쓰지 않는다」가
  잠근다.
- **`push` 는 `confirmDeletes` 뒤·`model.push` 앞에서만 `reserveIds` 를 부른다.** 앞에 두면 삭제
  확인에서 **취소한 사용자의 파일이 바뀌고**, 뒤에 두면 응답 유실 시 id 가 안 남아 사이클 전체가
  무의미해진다. 그리고 **`reserveIds` 의 호출처가 하나인 것이 `erdd diff` 가 파일을 건드리지 않는다는
  보장**이다(계획 미리보기가 파일을 쓰지 않는 것은 계약이다) — 두 번째 호출처를 만들 때 이 보장이
  먼저 깨진다.
- **`reserveIds` 는 `writeTree` 를 쓰지 않는다.** 그 함수의 삭제·개명 패스가 돌면 `tableFileName` 이
  파일명을 물리명으로 정규화해 **사용자가 만든 파일과 갈리고**, 같은 테이블이 두 파일에 남아 다음
  push 가 `idOf` 의 id 중복 검사에 걸려 아예 막힌다. 기록은 **사용자가 만든 원래 경로에** 한다 —
  push 가 성공하면 `syncDown` 이 어차피 정규 파일명으로 재작성하고 옛 파일을 지운다.
- **`filesToModel` 은 공유 객체 참조(YAML anchor/alias)를 `WeakSet` 으로 감지해 `ok:false` 로 세운다.**
  alias 는 배열의 두 원소를 **같은 객체 하나**로 파싱하고 `structuredClone` 이 그 공유를 보존하므로,
  감지가 없으면 두 엔티티가 한 id 를 받아 **조용히 하나로 합쳐진 채 `ok:true` 가 나간다.**
  ⚠️ **이 검사는 `newId` 유무와 무관해야 한다** — 발급 id 로 판별하는 방식은 되쓰기가 있는 push
  갈래에서만 성립해서, 같은 파일을 `push` 는 거절하고 `validate` 는 통과시켰다. **push 의 파일 오류
  문구가 「`erdd validate` 로 확인하세요」라고 바로 그 명령을 가리키므로, 지시를 따른 사용자·
  에이전트가 「문제 없음」을 받고 막히는** 형태였다. 참조 동일성은 id 와 무관하게 직접 보이므로 두
  갈래가 같은 판정을 낸다.
  - **공유 참조를 끊는 재귀 복사는 채택하지 않았다** — `yaml.stringify` 가 공유를 다시 anchor/alias 로
    내보내므로, 참조를 끊으면 `reserveIds` 가 사용자의 alias 파일을 전개형으로 덮어써
    **조용한 데이터 손실이 조용한 파일 파괴로 바뀐다.**

---

## 공용 사전 — `erdd/origins.yaml` 과 `erdd dict`

사전 4종(도메인·단어·용어·커스텀 항목)을 조직·전역 라이브러리와 주고받는 CLI 층이다. 라이브러리 쪽
규칙(`origin.base` 투영, 승격 엔진, 요청 큐)은 [shared-resources.md](shared-resources.md) 가 갖는다.

### `origin` 은 파일이 진실인 일반 병합 필드다

- **사전 4종의 `origin` 은 `erdd/origins.yaml` 에 실린다.** `file-merge.ts` 의 `FILE_FIELDS` 에 `출처`
  라벨로 들어 있고 `FILE_INVISIBLE_FIELDS` 에는 없다 — `push` 는 파일의 출처를 op 로 올리고 `pull` 은
  서버의 출처를 파일로 쓴다. 비교는 객체 전체를 한 값으로 본다.
- **출처를 모르는 옛 기준선(`origins.yaml` 이 없던 base)에서도 서버의 출처를 지우지 않는다.** base·로컬
  둘 다 출처가 없고 서버에만 있으면 3-way 가 「서버만 바뀜」으로 판정해 서버 값을 채택한다 — 첫 `pull`
  에서 `origins.yaml` 이 생기고, 첫 `pull` 전의 `push` 도 출처를 지우는 op 를 내지 않는다.
  `push.test.ts` 「업그레이드 직후(base·로컬에 origins.yaml 이 없음) push 는 서버의 origin 을 지우지
  않는다」가 잠근다.
- **삭제 판정은 출처를 빼고 본다**(`file-merge.ts` 의 `deleteJudgeFields`). 넣으면 옛 기준선에서 로컬이
  지운 항목이 「서버가 출처만 가졌다」는 이유로 삭제 충돌이 된다 — 사용자가 한 일은 삭제뿐인데 push 가
  막힌다. 대칭으로, 로컬이 출처만 바꾼 항목을 서버가 지우면 충돌 없이 지워진다.
- **파일이 진실이므로 `origins.yaml` 에서 줄이 사라지면 `push` 는 서버의 출처도 뗀다.** 사용자가 그런
  줄 모르는 경로(출처를 모르는 옛 스냅샷 복원, 옛 드래프트 유지)가 있어서, 떼는 update 가 있으면 확인
  프롬프트 **앞에** `공용 사전 출처를 떼는 변경 N건이 포함됩니다 — 의도하지 않았다면 erdd pull 로
  되돌리세요` 를 stderr 로 내고 성공 봉투에 `detachedOrigins` 를 싣는다(0 이어도 싣는다).

### `origins.yaml` 의 판독 규칙

`file-format.ts` 의 `filesToModel` 이 판정한다.

| 상황 | 처리 | 이유 |
|---|---|---|
| 형식 불일치(필수 키 누락·`kind` 가 4종 밖·`version` 이 정수가 아님·`base` 가 객체가 아님), 비객체 줄 | **파일 오류** — `serve` 편집 잠금, `push`·`dict` 거절, `validate` 가 가리킨다 | 오류 좌표 `origins[i]` 는 거르기 **전** 번호다 — 사람이 파일에서 그 줄을 찾는다 |
| 같은 `(kind, id)` 가 두 번 | 파일 오류 | 어느 줄이 맞는지 고를 수 없다. 키에 종류를 넣는 것은 단어와 용어가 같은 id 를 쓸 수 있어서다 |
| 가리키는 엔티티가 다른 종류로 있음 | 파일 오류(`kind가 …로 적혀 있지만 실제로는 …입니다`) | 조용히 무시하면 출처가 엉뚱한 엔티티에 붙을 자리를 남긴다 |
| 가리키는 엔티티가 없음(댕글링) | **조용히 무시**하고 다음 쓰기(`modelToFiles`)에서 정리된다 | 출처는 부속 정보다 — 사람이 `words.yaml` 에서 항목을 지운 것만으로 편집을 잠그면 과잉이다 |
| 파일 없음 | 출처 0건 | 출처가 0건이면 **파일을 쓰지 않는다**(없음 = 0건) |

`TOP_LEVEL_FILES` 에서 이 파일이 마지막 원소여야 하는 이유는 [data-layer.md](data-layer.md)
「이미 등록된 엔티티에 필드를 추가할 때」.

### `dict pull` — 로컬 파일 모델에 재동기화를 돌린다

- **서버 프로젝트 모델은 건드리지 않는다.** 라이브러리 항목을 받아 **로컬 파일 모델**에 core
  `planResync` → `applyResyncPlan` 을 돌리고 파일에 쓴다. 보관함(서버 프로젝트)은 다음 `erdd push` 때
  따라온다.
- **쓰는 파일은 `dict-shared.ts` 의 `DICTIONARY_FILES` 뿐이다** — 그룹·테이블 파일은 쓰지 않는다.
  `modelToFiles` 가 다시 만든 테이블 파일을 쓰면 사람이 다듬은 YAML 이 이유 없이 정규화된다.
  `dict-pull.test.ts` 「사전과 무관한 테이블 파일은 바이트 그대로다」가 잠근다.
- **사전 내용 파일을 먼저, `origins.yaml` 을 마지막에 쓴다**(`writeDictionaryFiles`). 파일 여럿의 쓰기는
  원자적이지 않다 — 출처를 먼저 쓰고 내용 전에 끊기면 「출처는 새 버전, 내용은 옛 값」이 되어 다음
  `dict pull` 이 버전이 같다고 **조용히** 넘기고 그 항목은 영원히 「프로젝트가 고친 항목」으로 남는다.
  출처가 마지막이면 끊겨도 옛 출처 대비 내용이 달라 다음 실행이 충돌로 **시끄럽게** 알린다.
  「pull 의 네 단계 쓰기」(아래 한계)와 같은 방향이다.
- **라이브러리 항목은 id 순으로 정렬해 넘긴다**(`fetchItems` 의 기본 `order: 'id'`). 같은 입력이면 같은
  계획이 나와야 `--dry-run` 과 실제 실행이 갈리지 않는다.
- **`--adopt` 의 배정은 core `adoptAssignments` 한 곳에서 한다** — 적용(`applyResyncPlan`)이 부르는 것과
  같은 함수라 보고가 실제와 갈라지지 않는다. `--adopt` 가 없어도 분류(「건너뜀 — --adopt 로 연결」 /
  「연결할 수 없음」)에 쓰려고 부른다. 항목별로 `adoptTargetOf` 를 보면 동명 원본 둘이 한 로컬 항목을
  노릴 때 「건너뜀 2」라 안내하고 `--adopt` 로는 1만 연결되는 거짓 안내가 된다.
- **`--dry-run` 은 파일도 config 도 쓰지 않는다** — `erdd diff` 와 같은 미리보기 계약이다.

### `dict push` — 서버의 승격 엔진을 부를 뿐이다

승격 판정과 쓰기는 서버의 기존 엔진이 **서버 프로젝트 모델** 기준으로 한다. CLI 는 core `planPromote`
로 같은 계획을 보이고 보낼 항목을 고른다([shared-resources.md](shared-resources.md) 「요청·승인 큐」).

- **전제가 둘이다 — 로컬 변경이 없고(`requireClean`), 서버 seq 가 마지막 `pull` 의 seq 와 같다.**
  승격 대상은 서버 엔티티라, 로컬에서 고친 값이 서버에 없으면 **보던 값이 아니라 보관함의 옛 값이**
  라이브러리에 올라간다. 서버가 앞서 나간 경우는 로컬이 깨끗해도 남의 새 값이 올라간다 — 로컬이
  깨끗하므로 `pull` 은 무해하니 받고 다시 보게 한다. **자동으로 `push` 하지 않는 이유**는 push 의 삭제
  확인·충돌 중단이 끌려와 두 명령의 실패 모드가 섞이기 때문이다.
- **계획은 서버가 준 순서 그대로 계산한다**(`fetchItems(…, { order: 'server' })`). 서버의
  `resource.promote`·`promotion.create` 는 `loadLibraryItems`(createdAt, 동률은 id) 순서로 `planPromote` 를
  **다시 계산**하고 동명 항목이 둘이면 먼저 나온 쪽이 `name-match` 대상이다. CLI 가 id 순으로 계산하면
  `expectedTargetItemId` 가 서버와 어긋나 그 항목이 `plan-changed` 로 조용히 건너뛰어진다.
- **승격이 커밋된 뒤의 실패는 「승격은 됐다」로 구분한다.** 성공하면 암묵적 pull(`syncDown`)로
  `origins.yaml` 을 받는데, 그 전에 로컬이 여전히 깨끗한지 **한 번 더** 본다 — 확인 프롬프트는 무기한
  기다리므로 그 사이 사람이 고친 파일을 `syncDown` 이 조용히 덮을 수 있다. 재확인이나 `syncDown` 이
  실패하면 재시도하지 않고 `{ mode: 'promote', ok: false, committed: true, syncError }` 로 끝낸다
  (`push.ts` 의 「반영됨 + 파일 갱신 실패」와 같은 규약 — 승격 실패로 보이면 사람도 에이전트도 다시
  올리려 든다).
- **서버가 전부 건너뛰면 종료 코드 `1` 이다.** 웹의 「선택이 전부 no-op 이면 무반응」을 되풀이하지 않는다.

### config 를 다시 쓰는 자리는 `dictionaries` 를 보존한다

**`ErddConfig.dictionaries` 는 필수 필드다 — 그것이 가드다.** `pull`(`syncDown`)은 서버 값으로 config 를
통째로 새로 만드는데, 거기서 구독을 빠뜨리면 **pull 할 때마다 구독이 사라지고** 사용자는 인자 없는
`dict pull` 이 왜 아무것도 받지 않는지 모른다. 옵셔널로 두면 새 쓰기 자리가 빠뜨려도 타입 오류가 없다.

- 지금 config 를 다시 쓰는 자리는 `syncDown`, `init`(연결·`--create`), `dict pull`, `serve` 의
  `project.update` 다. **새 자리를 만들면 구독을 이어 싣는다.**
- `init --project` 재연결은 **같은 서버의 같은 프로젝트일 때만** 구독을 잇는다(`keptSubscriptions`).
  다른 프로젝트의 구독은 옛 프로젝트의 선택이라 비운다. 그래서 `serverUrl` 을 정규화해(`trim` + 끝 슬래시
  제거) 저장한다 — 저장값이 갈리면 같은 서버를 다른 서버로 읽어 구독을 지운다.
- `serve` 의 파일 감시는 구독만 바뀐 config 를 reload 사유로 보지 않되, 메모리의 config 는 매번 갱신한다
  — 낡은 값이 남으면 다음 `project.update` 가 옛 구독으로 config 를 덮는다.

### `init --create` — config 가 커밋 지점이다

- **config 를 마지막에 쓴다.** 먼저 쓰면 그 뒤에서 끊겼을 때 **기준선 없이 연결된 config** 가 남고,
  사용자의 자연스러운 다음 수(`erdd pull`)가 `erdd/` 를 서버의 빈 상태로 덮는다. 이 순서면 중간 실패는
  「로컬 전용(또는 없는) config + 쓸모없는 base」로 남고 재실행이 전부 다시 쓴다.
- **기준선은 빈 모델·seq 0 이다.** `pull` 없이 `push` 가 요구하는 base 를 세우므로, 이관이면 `erdd diff`
  가 로컬 스키마 전부를 「추가」로 보인다. **`erdd/` 가 비어 있으면 빈 트리를 함께 쓴다** — 안 쓰면
  base 만 파일을 갖고 `erdd/` 는 비어 `push`·`diff` 가 「erdd/ 아래에 파일이 없습니다」 가드에 막힌다.
  파일이 하나라도 있으면(이관) 한 바이트도 건드리지 않는다.
- **로컬 트리와 config 규칙을 서버 호출 전에 읽고 검사한다.** YAML 오류나 서버 strict 스키마에 안 맞는
  명명 규칙으로 서버 호출 뒤에 멈추면 반쯤 만들어진 서버 프로젝트가 남는다.
- **이관 중 생성 권한이 없으면 `--project` 연결을 권하지 않는다.** 그 연결에는 기준선이 없어 다음 `pull`
  이 `erdd/` 를 덮는다 — 커밋해 두고 되얹는 수동 절차(로컬 모드 매뉴얼)를 가리킨다.

---

## 로컬 라우터는 서버 라우터의 계약을 따른다

`packages/cli/src/local/router.ts` 다.

- **웹은 `AppRouter` 타입으로 클라이언트를 만든다.** 그래서 로컬 라우터의 입출력이 어긋나도
  **컴파일에 안 잡히고 런타임에 깨진다.** `router.test.ts` 의 `inferRouterInputs/Outputs<AppRouter>`
  대조와 **프로시저 이름 집합 대조**를 지우지 마라 — 이 안의 유일한 실질 리스크를 닫는 자리다.
  - **손으로 적은 목록만으로는 샜다** — 실제로 `project.update` 의 입력과 `snapshot.delete` 의
    양축을 빠뜨렸다. 그래서 로컬이 구현한 프로시저를 **전부 훑는** 세 타입
    (`InputGaps`·`OutputGaps`·`LocalOnly`)을 함께 둔다. 어긋난 것이 있으면 타입이 그 **이름**이 되어
    오류 메시지가 어느 프로시저인지 말해 준다(`toEqualTypeOf<never>()` 로 적으면 이름을 잃는다).
- **서버에 프로시저를 더할 때 로컬에도 더할 필요는 없다** — 로컬 UI 에서 그 화면이 숨겨져 있으면
  된다(로컬은 의도적으로 축소된 라우터다). **반대로 로컬 모드에 보이는 화면이 부르는 프로시저는
  반드시 로컬 라우터에도 있어야 한다.**
  - ⚠️ **숨기는 것은 「다이얼로그를 닫아 두는 것」이 아니라 「렌더하지 않는 것」이다.**
    `ResourcePanel` 은 `enabled` 가드 없이 마운트 즉시 라이브러리 목록을 부르고,
    `PendingPromotionsBadge`(`AppShell`)는 대기 건수를 주기적으로 폴링한다 — 조건부 렌더가 아니면
    로컬에 없는 이름을 불러 화면에 오류가 뜬다.
  - ⚠️ **`AppShell` 의 `isLocal` 은 필수 prop 이다.** `useIsLocal()` 은 `MeContext`(= `RequireAuth`
    안)를 요구하는데 `AppShell` 은 단독으로도 렌더되므로, 계산은 `routes.tsx` 의 `Protected` 가 하고
    prop 으로 내린다. **옵셔널로 두면 호출부가 빠뜨려도 타입 오류 없이 서버 동작(배지 폴링)으로
    조용히 열린다.**
- ⚠️ **서버 쪽 반환 타입이 좁아지면 계약이 깨진다.** `auth.me` 의 `mode` 를 core 의 `RunMode` 로
  **명시**하지 않으면 tRPC 추론이 리터럴 `'server'` 로 좁혀 로컬의 `'local'` 과 서로를 만족하지
  못한다. **서버가 로컬과 공유하는 값은 core 의 타입으로 적어라.**

---

## 알려진 한계

### 파일·설정

- **`erdd.config.yaml` 의 방언·명명 규칙·테이블 옵션은 pull 시점 사본이다.** 서버에서 바꾸면 다음 pull 전까지
  로컬 `validate` 결과가 서버와 다를 수 있다.
- **서버와 오가는 파일에 `notes`·배치 좌표를 담지 않는다.** `push` 는 「파일에 없는 것은 서버에서
  건드리지 않는다」를 계약으로 지킨다(`applyMerge` 가 서버 값을 그대로 통과시킨다) — 그래서
  **파일에서 서버의 메모를 관리할 수 없다.** 공용 사전 출처는 이 한계에 들지 않는다(`origins.yaml`,
  위 「공용 사전」).
- **CLI 파일에는 최종 이름이 아니라 부분만 싣는다.** 파일 형식은 그대로 유지하기로 했고, 같은 마찰은
  **출력 쪽에서** 없앴다 — `erdd validate` 의 경고가 좌표(`erdd/tables/MBR.yaml  MBR.MBR_NO`)를 함께
  내므로 최종 이름을 말하는 경고에서도 한 줄에 부분 이름과 최종 이름이 같이 보인다.
  - ⚠️ **최종 이름을 문구에 쓰는 경고는 셋뿐이다** — `too-long` · `reserved` ·
    `duplicate-physical-table`. 나머지는 이미 부분 이름으로 말한다. **범위를 넓혀 잡지 마라.**
  - ⚠️ **관계 경고에는 `tableId` 가 없다** — `relationships[entityId].childTableId` 로 푼다.
    관계는 **자식 테이블 파일**에 실리므로 부모로 풀면 틀린 파일을 가리킨다.
- **인덱스 컬럼 방향을 `"MBR_NM DESC"` 한 문자열로 적는다.** 물리명이 정확히 `' ASC'`/`' DESC'` 로
  끝나면 되읽기가 모호하다. 사용자 판단으로 현행을 유지했고, DDL 파서도 리포 전역으로 같은 가정을 쓴다.
- **`erdd/tables/` 아래에 `.yaml` 로 끝나는 디렉터리가 있으면** `writeTree` 가 `EISDIR` 로 실패하고
  최상위 파일 정리까지 건너뛴다.
- **깨진 YAML·손상된 JSON 이 `CliError` 로 감싸이지 않고** 원본 예외가 새어 `run()` 이 `NETWORK` 로
  감싼다(파일 파싱 실패에 `NETWORK` 는 의미상 부정확하다).

### push·병합

- **배열 안 원소 단위 병합이 없다** — `index.columns` 한 원소만 달라도 필드 전체가 충돌한다.
- **충돌의 대화형 해소가 없다** — `erdd pull` 로 서버 변경을 받은 뒤 파일에서 손으로 정리한다.
- **한 push 가 op 상한(5000)을 넘으면 거부한다.** 대규모 최초 push(300테이블+)는 청크가 필요한데
  **「단일 Revision = undo 1회」 계약과 상충하므로 별도 설계 대상이다.**
- **`--json` 실패 응답이 두 형태다** — `{error:{code,message}}` 와 `{ok:false,conflicts:[…]}`.
  충돌은 오류가 아니라 **계획 결과**라 후자를 쓴다(exit 1 은 동일하다).
- **`expectedSeq` 재시도는 1회다.** 매우 활발한 프로젝트에서는 반복 실패할 수 있다.
- **`pull` 의 네 단계 쓰기는 원자적이지 않다.** 중단되면 base 가 트리보다 오래된 상태로 남아 다음
  `status` 가 오탐한다. **순서를 뒤집으면 낡은 트리를 숨기게 되어 더 나쁘므로 「시끄럽게 틀리는」
  쪽을 의도적으로 골랐다.** `pull --yes` 재실행으로 수렴한다.
- **`skill install` 은 Claude Code 형식만 낸다**(`AGENTS.md` 는 범위 밖이다).

### 공용 사전·`init --create`

- **`origins.yaml` 에 「손으로 고치지 않는다」는 머리 주석이 없다.** 쓰기가 `modelToFiles` 의 plain
  object → CLI 의 YAML 직렬화(`tree.ts` 의 `stringifyYaml`)라 파일별 주석을 실을 자리가 없다. 안내는
  매뉴얼·스킬 문서에만 있다. 고친다면 자리는 직렬화 층이고, 주석을 달면 `pull` 마다 재작성돼도 같은
  바이트가 나와야 `status` 가 오탐하지 않는다.
- **출처의 이름이 표시 자리마다 다르다.** `erdd diff`·웹 비교·Excel 은 `model-diff.ts` 의 `FIELD_LABEL`
  (「원본 참조」)을, push 충돌 보고는 `file-merge.ts` 의 `FILE_FIELDS`(「출처」)를 쓴다. 값 표시는
  `formatOrigin` 하나로 같다. 한쪽으로 맞추면 웹 문구가 함께 바뀌므로 사용자 가이드 인용을 같이 고친다.
- **`dict pull` 의 충돌 줄은 필드 키 그대로다**(`단어 고객  (abbreviation)`) — 값의 전후를 보이지
  않는다. 무엇이 바뀌었는지는 `--dry-run` 뒤 라이브러리 화면이나 `--conflicts theirs` 후 `git diff` 로 본다.
- **대형 사전의 첫 `dict pull` 은 다음 `push` 에서 op 상한(5000)에 걸릴 수 있다.** 로컬 적용에는
  상한이 없고 보관함으로 올리는 `push` 에만 있다(위 「push·병합」의 청크 한계와 같은 뿌리다).
- **`dict requests` 에 요청 항목의 이름이 없다** — 서버 행은 엔티티 id 만 갖고, 이름을 풀려면 모델이
  필요하다. `promotion.create` 가 돌려주는 `dropped` 는 사람용 출력에 건수로만 보인다(`--json` 에는 id 가
  실린다).
- **`init --create` 는 서버 생성과 로컬 쓰기가 원자적이지 않다.** `project.create` 뒤 로컬 쓰기가 실패하면
  서버에 빈 프로젝트가 남고, config 는 연결되지 않은 채라 재실행은 **새 프로젝트를 또 만든다.** config 를
  마지막에 쓰는 순서(위 「init --create」)가 로컬 쪽 피해는 막지만 서버 쪽 잔재는 웹에서 지운다.
- **이관 직후 `erdd status` 가 빈 최상위 파일을 `-`(삭제)로 보인다.** 기준선이 빈 모델의 트리(최상위
  다섯 파일)라 `erdd/` 에 없는 파일이 삭제로 잡힌다. 내용이 빈 목록이라 `erdd diff` 는 추가만 보이고,
  `push` 한 번으로 사라진다.

### 멱등성 잔여

- **서버는 여전히 멱등이 아니다.** 같은 요청을 그대로 두 번 보내면 리비전이 둘 생긴다. CLI 는
  재전송을 하지 않으므로 이 경로를 만들지 않지만, 다른 클라이언트가 `model.push` 를 직접 쓰면
  가능하다. 막으려면 `revisions.request_id`(마이그레이션)가 필요하다.
- **기록된 id 는 회수되지 않는다.** push 가 영영 실패하고 사용자가 그 항목을 파일에 남겨 두면 서버가
  모르는 id 가 계속 있고 `status` 가 계속 「로컬 변경」이라고 말한다(맞는 표시이나 지우는 길이 없다).
- **push 가 실패해도 기록 대상 파일이 한 번 재작성된다** — YAML 재직렬화라 주석·서식이 사라진다.
  트리는 원래 pull 마다 재작성되므로 새로운 종류의 손실은 아니지만 **실패 경로에서도 일어난다.**
- **던져서 끝나는 경로의 봉투에는 `reservedFiles` 가 없다.** `push.ts` 가 직접 만드는 두 봉투
  (conflicts · op 상한 초과)에는 실었지만, `throw err` 로 `run()` 이 만드는 봉투 — 서버 거절과
  CONFLICT 2회 — 는 그대로다. 둘 다 재시도 뒤에 닿을 수 있고 그때 워킹트리는 이미 재작성돼 있다.
  `CliError` 에 `details` 가 있으므로 수단은 이미 있다.
- **`reserveIds` 의 일부 가드는 프로덕션에서 도달하지 않는다.** `assigned` 가 `localTree` 의
  `structuredClone` 이라 키 집합이 항상 같다(가드를 지워도 cli 스위트가 전부 통과한다).
  테스트는 그 갈래를 검증하는데 코드 주석은 「닿지 않는다」고 적어 **둘이 다른 이야기를 한다** —
  방어 코드로 남기는 것 자체는 타당하나 어느 쪽이 사실인지 한 번 정리해야 한다.
- **id 를 나르지 않는 공유 참조는 검사에 걸리지 않는다.** `idOf` 를 지나지 않는 자리(두 도메인이 같은
  매핑을 alias 로 공유하는 것 등)는 합쳐질 id 가 없어 검사 대상이 아니고, 그 파일이 기록 대상이 되면
  직렬화가 **생성된 이름**으로 anchor 를 다시 쓴다.
- **전송 실패 시 자동 재시도는 없다** — 사용자가 다시 실행해야 한다(exit 1 유지). 보고 문구가
  「다시 push 하면 중복 없이 수렴합니다」이고 그 문장은 참이다.

### 토큰·인증

- **토큰에 만료가 없다.** 폐기만 가능하다.
- **`validateModelIntegrity` 는 CLI `validate` 경로에서 죽은 코드다.** `filesToModel` 이 파싱 단계에서
  참조 실패를 전부 잡고 키 === id 를 보장하므로 `ok:true` 인 모델에서는 그 검사들이 구조적으로 도달
  불가하다. `filesToModel` 이 느슨해질 때의 방어망으로 남겨 뒀다.
- **`tokensEqual`(`apps/server/src/auth/token.ts`)은 호출처가 없다.** 인증이 `tokenHash` unique 인덱스
  조회 한 방이라 상수시간 비교를 쓸 자리가 없다.
- **`context.ts` 의 `lastUsedAt` UPDATE 가 인증 경로 안에 있다.** 이 쓰기가 실패하면 유효한 토큰도
  인증 실패가 된다. 현재 단일 `pg.Pool` 이라 실사용 리스크는 낮으나 **리드 레플리카 도입 시 재검토
  대상**이다.
- **토큰 발급 화면의 「복사」 버튼이 `navigator.clipboard` 결과를 확인하지 않는다.** 비-HTTPS
  환경에서 복사되지 않아도 성공 토스트가 뜬다.
