<!-- source: packages/core/README.md @ v0.6.0 -->
<p><a href="README.md">English</a> | <b>한국어</b></p>

# @erdd/core

ERDD 의 **순수 로직 패키지**입니다. 모델 타입·명명 규칙·DDL/DBML 생성과 파싱·가져오기 계획·파일 포맷(YAML
트리 ↔ 모델) 변환이 전부 여기 있고, 서버·웹 에디터·CLI 가 같은 코드를 씁니다. 런타임 의존성은 `zod`
하나뿐이고 DOM·Node 전용 API 에 기대지 않습니다.

보통은 직접 설치하지 않습니다. [`@erdd/cli`](../cli/README.ko.md) 의 의존성으로 함께 설치됩니다. 여러분의
코드에서 모델을 직접 다룰 때만 명시적으로 선언하세요.

## 설치

`@erdd/cli` 와 같이 **공개 npm** 에 있습니다. 따로 할 레지스트리 설정은 없습니다.

```bash
pnpm add @erdd/core
# with npm
npm install @erdd/core
```

## 원본 TypeScript 를 그대로 배포하므로 tsconfig 에 하한이 있습니다

> [!WARNING]
> 이 패키지는 **빌드 산출물(`.js` + `.d.ts`)이 아니라 원본 `.ts` 를 그대로** 배포합니다. `package.json` 의
> `main`·`types` 가 둘 다 `./src/index.ts` 를 가리킵니다.

그래서 **`@erdd/core` 를 import 한 프로젝트는 이 패키지의 `.ts` 소스를 자기 tsconfig 로 타입체크합니다.**
`target` 이 낮으면 **여러분의 코드가 아니라 `node_modules/@erdd/core/src/**` 에서** 컴파일 오류가 납니다.

### 요구 사항

| 항목                | 값                                                                  |
| ------------------- | ------------------------------------------------------------------- |
| Node.js             | **22 이상** (`engines.node: ">=22"`)                                |
| TypeScript `target` | **`ES2022` 이상** (`ESNext` 도 됩니다)                              |
| `moduleResolution`  | `nodenext` / `bundler` 등 `package.json` 의 `main` 을 따라가는 방식 |

```jsonc
// your tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022", // lower bound; going lower breaks inside @erdd/core
    "module": "nodenext",
    "moduleResolution": "nodenext",
  },
}
```

### 실측 (TypeScript 7.0.2, 2026-09-03)

소비처를 흉내 낸 임시 프로젝트(`node_modules/@erdd/core` 심볼릭 링크 + `import` 한 줄)에서 `target` 만
바꿔 가며 `tsc --noEmit` 을 돌린 결과입니다. 세 설정은 모든 실행에서 같았습니다. `strict: true` ·
`skipLibCheck: true` · `exclude: ["node_modules"]` 입니다.

| `target`     | 결과                  | 무엇이 깨지는가                                                                                         |
| ------------ | --------------------- | ------------------------------------------------------------------------------------------------------- |
| `ES2017`     | 오류 45건             | `TS1501` 정규식 `s` 플래그 6곳(`ddl-parse.ts`) + `TS2550` `Object.fromEntries`·`String.trimEnd` 등 38건 |
| `ES2018`     | 오류 39건             | `TS1501` 은 사라지고 `TS2550` 이 남습니다                                                               |
| `ES2020`     | 오류 25건             | `TS2550` `Object.hasOwn` 24곳 · `String.prototype.at` 1곳                                               |
| `ES2021`     | 오류 25건             | 위와 같습니다                                                                                           |
| **`ES2022`** | **오류 0건 (EXIT=0)** | —                                                                                                       |

```text
$ tsc --noEmit -p tsconfig.json     # target: ES2017
.../packages/core/src/ddl-parse.ts(379,129): error TS1501: This regular expression flag is
  only available when targeting 'es2018' or later.
.../packages/core/src/dbml-note.ts(15,38): error TS2550: Property 'fromEntries' does not exist
  on type 'ObjectConstructor'. Do you need to change your target library? ...
... (45 errors)

$ tsc --noEmit -p tsconfig.json     # target: ES2020
.../packages/core/src/diff.ts(26,19): error TS2550: Property 'hasOwn' does not exist on
  type 'ObjectConstructor'. Try changing the 'lib' compiler option to 'es2022' or later.
.../packages/core/src/excel-import.ts(94,21): error TS2550: Property 'at' does not exist on
  type 'string'. ... (25 errors)

$ tsc --noEmit -p tsconfig.json     # target: ES2022
EXIT=0
```

### 흔한 회피 방법이 통하지 않는 이유 (전부 실측)

- **`skipLibCheck: true` 로는 안 됩니다.** 그 옵션은 **`.d.ts` 선언 파일**만 건너뜁니다. 여기 들어 있는
  것은 `.ts` **소스**라 대상이 아닙니다. 위 실측은 전부 `skipLibCheck: true` 인 채로 실패했습니다.
- **`exclude: ["node_modules"]` 로도 안 됩니다.** `exclude` 는 **프로그램의 시작점(root files)** 을 고를
  뿐입니다. 시작점에서 `import` 로 딸려 오는 파일은 그 목록과 무관하게 따라옵니다. 위 실측도 `exclude` 를
  준 채로 `node_modules/@erdd/core/src/**` 의 오류를 냈습니다.
- **`lib` 만 올려도 안 됩니다.** `target: ES2017` + `lib: ["ES2022"]` 로는 `TS2550`(라이브러리 계열)은
  사라지지만 **`TS1501` 6건이 그대로 남습니다.** 정규식 `s` 플래그의 판정 기준은 `lib` 이 아니라 `target`
  이기 때문입니다. 게다가 **`lib` 을 명시하면 기본으로 딸려 오던 `DOM` 이 빠져** `TS2304`
  (`structuredClone`·`TextEncoder`) 2건이 새로 생깁니다. 이 조합의 총 오류는 8건입니다.

`target` 을 올릴 수 없다면 번들러(esbuild·swc·vite 등)로 `@erdd/core` 를 여러분의 target 으로
트랜스파일해 쓰는 방법이 남습니다.

## 사용법

```ts
import {
  createEmptyModel,
  filesToModel,
  modelToFiles,
  generateDdl,
  generateDbml,
  parseDdl,
  parseDbml,
  planDdlImport,
  applyDdlImport,
  DEFAULT_NAMING_RULES,
  type ProjectModel,
} from '@erdd/core'

// file tree → model
const result = filesToModel(tree)
if (!result.ok) throw new Error(JSON.stringify(result.issues))

// model → DDL
const ddl = generateDdl(result.model, 'postgresql', { kind: 'all' }, DEFAULT_NAMING_RULES)

// DDL → model (merge). Layout is injected; without it, core uses a grid layout
const plan = planDdlImport(result.model, parseDdl(ddl), 'postgresql', DEFAULT_NAMING_RULES)
const next: ProjectModel = applyDdlImport(result.model, plan, () => crypto.randomUUID())
```

`applyDdlImport` 의 네 번째 인자 `{ layout }` 은 테이블 좌표를 정하는 함수입니다. 기본값은 core 의 격자
배치이고, 웹 에디터는 dagre 계층 배치를 주입합니다. 그래서 core 는 dagre 에 의존하지 않습니다.

## 라이선스

MIT License. 자세한 내용은 [LICENSE](LICENSE) 를 확인하세요.
