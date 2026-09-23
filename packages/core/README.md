# @erdd/core

ERDD 의 **순수 로직 패키지**다. 모델 타입·명명 규칙·DDL/DBML 생성과 파싱·가져오기 계획·파일
포맷(YAML 트리 ↔ 모델) 변환이 전부 여기 있고, 서버·웹·CLI 가 같은 코드를 쓴다. 런타임 의존성은
`zod` 하나뿐이고 DOM·Node 전용 API 에 기대지 않는다.

보통은 직접 설치하지 않는다 — [`@erdd/cli`](../cli/README.md) 의 의존성으로 따라 들어온다. 소비처
코드에서 모델을 직접 다룰 때만 명시적으로 쓴다.

## ⚠️ 원본 TypeScript 를 그대로 배포한다 — 소비처 tsconfig 에 하한이 있다

이 패키지는 **빌드 산출물(`.js` + `.d.ts`)이 아니라 원본 `.ts` 를 그대로** 배포한다
(`package.json` 의 `main`·`types` 가 둘 다 `./src/index.ts` 다).

그래서 **`@erdd/core` 를 import 한 소비처는 이 패키지의 `.ts` 소스를 자기 tsconfig 로 타입체크한다.**
소비처의 `target` 이 낮으면 **소비처 코드가 아니라 `node_modules/@erdd/core/src/**` 에서** 컴파일
오류가 난다.

### 요구 사항

| 항목 | 값 |
|---|---|
| Node.js | **22 이상** (`engines.node: ">=22"`) |
| TypeScript `target` | **`ES2022` 이상** (`ESNext` 도 됨) |
| `moduleResolution` | `nodenext` / `bundler` 등 `package.json` 의 `main` 을 따라가는 것 |

```jsonc
// 소비처 tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",        // ← 하한. 낮추면 @erdd/core 안에서 오류가 난다
    "module": "nodenext",
    "moduleResolution": "nodenext"
  }
}
```

### 실측 (TypeScript 7.0.2, 2026-09-03)

소비처를 흉내 낸 임시 프로젝트(`node_modules/@erdd/core` 심볼릭 링크 + `import` 한 줄)에서
`target` 만 바꿔 가며 `tsc --noEmit` 을 돌린 결과다. 세 조건은 모든 실행에서 같았다 —
`strict: true` · `skipLibCheck: true` · `exclude: ["node_modules"]`.

| `target` | 결과 | 무엇이 깨지는가 |
|---|---|---|
| `ES2017` | 오류 45건 | `TS1501` 정규식 `s` 플래그 6곳(`ddl-parse.ts`) + `TS2550` `Object.fromEntries`·`String.trimEnd` 등 38건 |
| `ES2018` | 오류 39건 | `TS1501` 은 사라지고 `TS2550` 이 남는다 |
| `ES2020` | 오류 25건 | `TS2550` `Object.hasOwn` 24곳 · `String.prototype.at` 1곳 |
| `ES2021` | 오류 25건 | 위와 같다 |
| **`ES2022`** | **오류 0건 (EXIT=0)** | — |

```
$ tsc --noEmit -p tsconfig.json     # target: ES2017
.../packages/core/src/ddl-parse.ts(379,129): error TS1501: This regular expression flag is
  only available when targeting 'es2018' or later.
.../packages/core/src/dbml-note.ts(15,38): error TS2550: Property 'fromEntries' does not exist
  on type 'ObjectConstructor'. Do you need to change your target library? ...
... (45건)

$ tsc --noEmit -p tsconfig.json     # target: ES2020
.../packages/core/src/diff.ts(26,19): error TS2550: Property 'hasOwn' does not exist on
  type 'ObjectConstructor'. Try changing the 'lib' compiler option to 'es2022' or later.
.../packages/core/src/excel-import.ts(94,21): error TS2550: Property 'at' does not exist on
  type 'string'. ... (25건)

$ tsc --noEmit -p tsconfig.json     # target: ES2022
EXIT=0
```

### 흔한 회피 시도가 왜 안 통하는가 (전부 실측)

- **`skipLibCheck: true` 로는 안 된다.** 그 옵션은 **`.d.ts` 선언 파일**만 건너뛴다. 여기 들어 있는
  것은 `.ts` **소스**라 대상이 아니다. 위 실측은 전부 `skipLibCheck: true` 인 채로 실패했다.
- **`exclude: ["node_modules"]` 로도 안 된다.** `exclude` 는 **프로그램의 시작점(root files)** 을
  고를 뿐이고, 시작점에서 `import` 로 딸려 오는 파일은 그 목록과 무관하게 따라온다. 위 실측도
  `exclude` 를 준 채로 `node_modules/@erdd/core/src/**` 의 오류를 냈다.
- **`lib` 만 올려도 안 된다.** `target: ES2017` + `lib: ["ES2022"]` 로는 `TS2550`(라이브러리 계열)은
  사라지지만 **`TS1501` 6건이 그대로 남는다** — 정규식 `s` 플래그의 판정 기준은 `lib` 이 아니라
  `target` 이기 때문이다. ⚠️ 게다가 `lib` 을 **명시하면 기본으로 딸려 오던 `DOM` 이 빠져** `TS2304`
  (`structuredClone`·`TextEncoder`) 2건이 새로 생긴다 — 이 조합의 총 오류는 8건이다.

`target` 을 올릴 수 없는 소비처라면 번들러(esbuild·swc·vite 등)로 `@erdd/core` 를 자기 target 으로
트랜스파일해 쓰는 것이 남는 길이다.

## 쓰는 법

```ts
import {
  createEmptyModel, filesToModel, modelToFiles,
  generateDdl, generateDbml, parseDdl, parseDbml,
  planDdlImport, applyDdlImport,
  DEFAULT_NAMING_RULES, type ProjectModel,
} from '@erdd/core'

// 파일 트리 → 모델
const result = filesToModel(tree)
if (!result.ok) throw new Error(JSON.stringify(result.issues))

// 모델 → DDL
const ddl = generateDdl(result.model, 'postgresql', { kind: 'all' }, DEFAULT_NAMING_RULES)

// DDL → 모델(머지). 배치는 주입 인자다 — 안 주면 core 의 격자 배치다
const plan = planDdlImport(result.model, parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
const next: ProjectModel = applyDdlImport(result.model, plan, () => crypto.randomUUID())
```

`applyDdlImport` 의 네 번째 인자 `{ layout }` 은 테이블 좌표를 정하는 함수다. 기본값은 core 의 격자
배치이고, 웹 에디터는 dagre 계층 배치를 주입한다 — core 는 dagre 를 의존하지 않는다.

## 설치

`@erdd/cli` 와 같이 **공개 npm** 에 있다. 따로 할 레지스트리 설정은 없다.

```bash
pnpm add @erdd/core
# npm 이면
npm install @erdd/core
```
