<p><b>English</b> | <a href="README.ko.md">한국어</a></p>

# @erdd/core

This is ERDD's **pure logic package**. Model types, naming rules, DDL/DBML generation and parsing, import
planning, and the file format conversion (YAML tree ↔ model) all live here. The server, the web editor,
and the CLI share the same code. Its only runtime dependency is `zod`, and it relies on no DOM-only or
Node-only API.

You usually do not install it directly. It comes in as a dependency of [`@erdd/cli`](../cli/README.md).
Declare it explicitly only when your own code works with the model.

## Installation

Like `@erdd/cli`, it is on the **public npm registry**. No registry configuration is needed.

```bash
pnpm add @erdd/core
# with npm
npm install @erdd/core
```

## It ships the original TypeScript, so your tsconfig has a lower bound

> [!WARNING]
> This package ships **the original `.ts` files, not build output (`.js` + `.d.ts`)**. Both `main` and
> `types` in `package.json` point to `./src/index.ts`.

So **a project that imports `@erdd/core` type-checks this package's `.ts` source with its own tsconfig.**
With a low `target`, compile errors appear **in `node_modules/@erdd/core/src/**`, not in your code**.

### Requirements

| Item                | Value                                                                        |
| ------------------- | ---------------------------------------------------------------------------- |
| Node.js             | **22 or later** (`engines.node: ">=22"`)                                     |
| TypeScript `target` | **`ES2022` or later** (`ESNext` also works)                                  |
| `moduleResolution`  | `nodenext`, `bundler`, or another mode that follows `main` in `package.json` |

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

### Measurements (TypeScript 7.0.2, 2026-09-03)

These results come from a scratch project that mimics a consumer (a `node_modules/@erdd/core` symlink plus
one `import` line). Only `target` changed between runs of `tsc --noEmit`. Three settings were the same in
every run: `strict: true`, `skipLibCheck: true`, and `exclude: ["node_modules"]`.

| `target`     | Result                | What breaks                                                                                                       |
| ------------ | --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ES2017`     | 45 errors             | `TS1501` regex `s` flag in 6 places (`ddl-parse.ts`) + 38 `TS2550` such as `Object.fromEntries`, `String.trimEnd` |
| `ES2018`     | 39 errors             | `TS1501` disappears; `TS2550` remains                                                                             |
| `ES2020`     | 25 errors             | `TS2550`: `Object.hasOwn` in 24 places, `String.prototype.at` in 1                                                |
| `ES2021`     | 25 errors             | Same as above                                                                                                     |
| **`ES2022`** | **0 errors (EXIT=0)** | —                                                                                                                 |

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

### Why the usual workarounds fail (all measured)

- **`skipLibCheck: true` does not help.** That option skips only **`.d.ts` declaration files**. This
  package contains `.ts` **source**, which it does not cover. Every failing run above had
  `skipLibCheck: true`.
- **`exclude: ["node_modules"]` does not help either.** `exclude` only selects the program's **root
  files**. Files pulled in through `import` from a root file are loaded regardless of that list. The runs
  above reported errors in `node_modules/@erdd/core/src/**` with `exclude` set.
- **Raising only `lib` does not help.** With `target: ES2017` and `lib: ["ES2022"]`, the `TS2550`
  (library) errors go away, but **the 6 `TS1501` errors remain**. The regex `s` flag is judged by
  `target`, not `lib`. Also, **setting `lib` explicitly drops the default `DOM`**, which adds 2 new
  `TS2304` errors (`structuredClone`, `TextEncoder`). That combination totals 8 errors.

If you cannot raise `target`, the remaining option is to transpile `@erdd/core` to your target with a
bundler (esbuild, swc, vite, and so on).

## Usage

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

The fourth argument of `applyDdlImport`, `{ layout }`, is a function that sets table coordinates. The
default is core's grid layout. The web editor injects a dagre hierarchical layout, so core does not depend
on dagre.

## License

MIT License. See [LICENSE](LICENSE) for details.
