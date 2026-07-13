# CP-1: Current-state evidence and constraints (task-2223)

## Summary of work done

Completed the full inventory of the repository's TypeScript development, build, test,
mutation, packaging, asset, generated-output, and freshness surfaces; captured current
official Node.js, TypeScript, and npm sources for the ecosystem claims; and mapped the
statements in ADRs 0037, 0044, 0046, and 0049 plus README/build-freshness documentation
that the new ADR 0044 update must reconcile. No repository files outside this checkpoint
document were modified.

### 1. Inventory: development and distribution surfaces (feeds SC2)

| Surface | Evidence | Finding |
|---|---|---|
| Package manifest | `package.json:7` (`"main": "index.js"`), `package.json:8-10` (`"bin": {"px": "px.js"}`), `package.json:11-13` (`"engines": {"node": ">=20"}`) | No top-level `"type"` field anywhere in `package.json`, so Node treats all `.js` as CommonJS. `main` and `bin` point at repo-root compiled siblings. |
| Files allowlist | `package.json:34-49`, exclusion `package.json:45` (`"!lib/**/*.ts"`) | Published tarball ships compiled `lib/**/*.js` but strips the TypeScript sources under `lib/`; also ships `config/`, `data/`, `docs/`, `examples/`, `prompts/`, `templates/`. |
| Default build | `package.json:51` (`"build": "tsc"`), `tsconfig.json:6` (`"outDir": "dist"`), `tsconfig.json:7` (`"rootDir": "."`) | The default `tsc` build emits to `dist/`, a layout nothing else consumes — the first of the two apparent output layouts. |
| In-place CJS build | `package.json:52` (`build:cjs` — `tsc --rootDir . --outDir . --module CommonJS --moduleResolution Node --esModuleInterop`, then shebang re-insertion + `chmod +x px.js`) | The layout actually used: sibling `.js` next to every `.ts`, in the source tree. Second output layout. |
| TypeScript config | `tsconfig.json:9-10` (`module`/`moduleResolution` `NodeNext`), `tsconfig.json:14-18` (include: `index.ts`, `px.ts`, `lib/**/*.ts`), `tsconfig.json:19` (exclude `test/`) | One tsconfig in the repository (verified via `find . -name "tsconfig*"`). Tests are excluded from typechecking entirely; `allowJs`/`checkJs` are false (`tsconfig.json:3-4`). |
| Import-specifier convention | `px.ts:5` (`import * as fmt from './lib/core/fmt.js'`) | Sources use ESM `import` syntax with explicit `.js` extensions (NodeNext convention), compiled down to CJS `require`. |
| ESLint | `eslint.config.mjs:9-22` (`compiledJsIgnores` per-directory globs), `eslint.config.mjs:35-37` (lint `**/*.ts`) | Lints `.ts` plus non-generated `.js`; the ignore list mirrors `.gitignore`'s compiled-output globs and must be kept in sync by hand. |
| Unit-test runner | `test/run-default-tests.js:7-11` (collect `test/*.test.js`, exclude `e2e-real-agent-smoke.test.js`), `test/run-default-tests.js:13-20` (`node --test` with `--require test/bootstrap-parallix-home.js`) | 148 tracked `.js` test files, 0 `.ts` (via `git ls-files test/`). `pretest` (`package.json:56`) runs `build:cjs`, so tests exercise compiled sibling output, preloaded through the CJS-only `--require` flag. |
| E2E runners | `config/integration-pipelines.json` gates `workflow` (`node test/e2e-mission-lifecycle.test.js`, order 50) and `custom-agent-smoke` (`node test/e2e-real-agent-smoke.test.js`, order 51); `docs/real-agent-smoke.md:41` | E2E suites run as integration-only gates; the real-agent smoke is excluded from the default suite. |
| Freshness guard | `lib/core/build-freshness.ts:32-51` (`findStaleBuildArtifacts` — mtime comparison of `.ts`/`.js` pairs for `px`, `index`, and every `lib/commands/*.ts`), `lib/core/build-freshness.ts:60` (`PARALLIX_SKIP_BUILD_CHECK=1` bypass), `package.json:53-55` (`publish:guard` wired to `prepack`/`prepublishOnly`) | The source/runtime drift defence is mtime-based and checkout-only; installed packages skip it by design (task-1424 rationale documented at `lib/core/build-freshness.ts:76-99`). |
| Package-content tests | `test/package-persistent-data.test.js`, test name `"global tarball reinstall preserves PARALLIX_HOME stats and agent blocklist"`; `test/task-1424-post-integrate-publish-reinstall.test.js`, test name `"installed tarball runtime does not trip the stale-build guard on a fresh, correctly-built checkout"` | Tarball pack/install behaviour is already covered by real tests that build, pack, and install into temp dirs — the base the replacement verification contract extends. |
| Coverage | `package.json:58` (`test:coverage` → `node lib/commands/coverage-gate.js --lcov`) | Coverage gate runs against compiled sibling output. |
| Mutation testing | `scripts/verify-local.sh:186-189` (`gate_mutation`: `npm run build:cjs` then `node lib/commands/mutation-gate.js`), `lib/commands/mutation-gate.ts:118` (`mutate: targetFiles`), `lib/commands/mutation-gate.ts:121` (command runner `node --test <matched test files>`), `stryker.conf.json` (manual template) | Diff-scoped StrykerJS ratchet (ADR 0049) mutates compiled `.js` targets and shells out to `node --test`; it is coupled to the sibling-output layout. |
| Executable entry points | `px.ts:1` and `index.ts:1` (`#!/usr/bin/env node`), `package.json:52` (shebang re-insertion + `chmod +x` for `px.js`) | Both entry points carry shebangs in source; `build:cjs` must repair the compiled `px.js` shebang because `tsc` preserves it only as emitted text. |
| Tracked generated JS | `.gitignore:15-25` (ignores `dist/`, `lib/**` compiled globs, `/index.js`, `/px.js`); exception: `git ls-files` shows `lib/commands/repair-handoff.js` tracked beside `lib/commands/repair-handoff.ts` | 72 tracked `.ts` under `lib/`, exactly one tracked compiled sibling (`lib/commands/repair-handoff.js`) that predates the ignore rules — the "tracked sibling CommonJS output" the mission cites. |
| Asset resolution | `lib/commands/draft.ts:17-18` (`path.join(__dirname, '..', '..', 'prompts', 'draft.md')` / `templates/mission-scaffold.md`) | Runtime assets resolve `__dirname`-relative with hard-coded `..` depth — correct today, but the depth breaks if compiled output moves to `dist/`. |
| Verification path | `scripts/verify-local.sh:24-26` (`gate_all` = `npm test`), `scripts/verify-local.sh:29-62` (static-analysis: ESLint + `npm run typecheck` + `scripts/test-hygiene.sh`), `scripts/verify-local.sh:192-210` (`docs` subcommand), `workflow.config.json` (`"command": "./scripts/verify-local.sh {{area}}"`) | The docs gate checks documentation presence (`README.md`, `CHANGELOG.md`, `LICENSE`, `docs/adr/`); `docs/doc-standards.md:75-77` additionally requires all README relative links to resolve. `gate_integrate` in `scripts/verify-local.sh:76` `require`s compiled `./lib/commands/integrate.js` directly — another sibling-layout coupling. |
| Direct source execution | `package.json:68` (`tsx ^4.22.4` devDependency) | `tsx` is installed but wired to no npm script — there is currently no blessed direct-`.ts` execution path; development runs compiled output via `node index.js <command>` (`README.md:202-206`). |

### 2. ADR and documentation conflict map (feeds SC11)

| Document | Statement to reconcile | Evidence |
|---|---|---|
| ADR 0037 | Established `workflow/` as raw, uncompiled Node source — "no bundlers, no transpilation" era; the repo now compiles TypeScript, so the zero-transpilation stance is already historical | ADR 0037; restated in ADR 0044's Context (`docs/adr/0044-workflow-distribution-model.md:43`) |
| ADR 0044 | Accepted (2026-06-22) the local-tarball / global `px` distribution stance; predates the TypeScript migration and says nothing about module format, output layout, or build | `docs/adr/0044-workflow-distribution-model.md:7-39` |
| ADR 0046 | npm registry publication, `files` allowlist as security posture, `npm pack --dry-run` content audit, zero-runtime-dependency stance | ADR 0046, Decision and "Security posture" sections |
| ADR 0049 | Mutation gate documented against the sibling layout: "Git tracks `.ts` sources; the compiled `.js` under `lib/` (produced by `npm run build:cjs`) is gitignored and is what actually executes under `node --test`" | `docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md:146-147` |
| README | Development section documents `npm test` and `node index.js <command>` as the source-checkout paths | `README.md:194-206` |
| Build-freshness documentation | Public-distribution section documents `npm run build:cjs` + `npm pack` as the release sequence and the mtime fail-closed guard incl. the task-1424 installed-package exemption | `docs/authority-reference.md:313-360` |

### 3. Ecosystem sources captured (feeds SC12) — all accessed 2026-07-11

1. **Node.js — Modules: Packages** (`https://nodejs.org/api/packages.html`): `"type"` "defines the module format that Node.js uses for all `.js` files that have that `package.json` file as their nearest parent"; absent/`"commonjs"` → CJS. `"exports"` "takes precedence over the `"main"` field when importing the package by name" and encapsulates unexported internals; the `"import"`/`"require"` conditions carry the documented dual CommonJS/ES-module-packages hazard.
2. **TypeScript Handbook — Modules Reference, `node16`/`nodenext`** (`https://www.typescriptlang.org/docs/handbook/modules/reference.html`): "Extensionless relative paths are not supported in `import` paths" — relative ESM imports need explicit `.js` extensions; "The detected module format of input `.ts` … files determines the module format of the emitted JavaScript files", detection driven by the nearest `package.json` `"type"`; `nodenext` allows `require()` of ES modules "reflecting Node.js v22.12.0+".
3. **npm Docs — package.json** (`https://docs.npmjs.com/cli/v11/configuring-npm/package-json`): `files` is an allowlist; `package.json`, `README`, `LICENSE`, and files named by `main`/`bin` are always included; `bin` targets must start with `#!/usr/bin/env node`; "The `type` field … is not used by npm".
4. **npm Docs — scripts (lifecycle)** (`https://docs.npmjs.com/cli/v11/using-npm/scripts`): `prepack` "Runs BEFORE a tarball is packed (on `npm pack`, `npm publish`, and when installing a git dependency)"; `prepublishOnly` runs only on `npm publish`; `pretest` runs before `npm test`.
5. **TypeScript — TSConfig Reference** (`https://www.typescriptlang.org/tsconfig/`): `outDir`/`rootDir` control the emitted tree shape; `declaration` generates `.d.ts`; `declarationMap`/`sourceMap` map output back to `.ts` sources; `noEmit` supports typecheck-only projects; project `references`/`composite` structure multi-part programs.

### 4. Constraints pinned for the decision (CP-2 input)

- Sources already use ESM syntax with `.js`-extension specifiers (`px.ts:5`), so a NodeNext CJS emit and a NodeNext ESM emit are both reachable without rewriting import specifiers.
- 148 CommonJS test files, the CJS-only `--require` preload (`test/run-default-tests.js:14`), the `require()` call in `scripts/verify-local.sh:76`, and the compiled-`.js` mutation scoper (`lib/commands/mutation-gate.ts:118`) are the observed compatibility mass that an ESM flip would have to move.
- No consumer of a dual ESM/CJS artifact was found anywhere in the repository (checked `package.json` `exports` — absent; ADRs 0044/0046 describe only the CLI tarball/registry path). The stop rule for an evidenced dual-package consumer is **not** triggered.
- `engines.node >=20` (`package.json:12`) bounds every ecosystem claim.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: dated ADR 0044 update + index entry | ADR 0044 (`docs/adr/0044-workflow-distribution-model.md:5` — current "Last updated" line to be superseded); update drafted in CP-2–CP-4 | PENDING (CP-4) |
| SC2: current-state diagram + evidence table covering all named surfaces | Inventory table above: `package.json:34-49`, `tsconfig.json:6-19`, `eslint.config.mjs:9-22`, `test/run-default-tests.js:7-20`, `lib/core/build-freshness.ts:32-51`, `lib/commands/mutation-gate.ts:118`, `test/package-persistent-data.test.js`, `.gitignore:15-25`, `px.ts:1` | PASS (evidence gathered; ADR embedding in CP-2) |
| SC3: measurable end-state targets | Constraints pinned in §4 above; targets drafted in CP-2 against `tsconfig.json:6`, `package.json:51-52` | PENDING (CP-2) |
| SC4: scored 3-model decision matrix, dual-package hazard resolved | Hazard source captured (§3 item 1, Node.js packages doc); no dual-package consumer evidenced (§4) | PENDING (CP-2) |
| SC5: accepted end-state contract with no open options | Input constraints fixed: `px.ts:5` specifier convention, `package.json:7-10` current `main`/`bin` | PENDING (CP-2) |
| SC6: test contract (unit/E2E/coverage/mutation, conversion vs checked JS, test tsconfig, direct source execution) | Current model evidenced: `tsconfig.json:19` (tests excluded), `test/run-default-tests.js:13-20`, `package.json:58`, `scripts/verify-local.sh:186-189`, `package.json:68` (`tsx` unwired) | PENDING (CP-2) |
| SC7: asset resolution/copy rules without CWD dependence | Current mechanism evidenced: `lib/commands/draft.ts:17-18` (`__dirname`-relative, depth-coupled) | PENDING (CP-2) |
| SC8: replacement for mtime freshness | Current guard evidenced: `lib/core/build-freshness.ts:32-51`, `package.json:53-55`; replacement designed in CP-3 | PENDING (CP-3) |
| SC9: publication proof steps + inclusion/exclusion table | Existing proof base evidenced: `"installed tarball runtime does not trip the stale-build guard on a fresh, correctly-built checkout"` (`test/task-1424-post-integrate-publish-reinstall.test.js`) | PENDING (CP-3) |
| SC10: ordered migration phases with gates and rollback | Coupling points enumerated (§4); phases drafted in CP-3 | PENDING (CP-3) |
| SC11: ADRs 0037/0046/0049 + ADR 0044 history + README + freshness docs reconciled | Conflict map complete (§2): ADR 0037, ADR 0046, ADR 0049, `docs/adr/0044-workflow-distribution-model.md:43`, `README.md:194-206`, `docs/authority-reference.md:313-360` | PASS (map complete; ADR text in CP-4) |
| SC12: ecosystem claims cite current official docs with access dates | §3 above — five official sources (nodejs.org, typescriptlang.org ×2, docs.npmjs.com ×2), all accessed 2026-07-11 | PASS (sources captured; ADR embedding in CP-4) |
| SC13: diff limited to ADR, index, checkpoints, backlog docs | `git diff --name-only` after CP-1: only `missions/task-2223/CP-1.md` | PASS (so far) |
| SC14: `./scripts/verify-local.sh docs` + link/consistency checks recorded | Command identified: `./scripts/verify-local.sh docs` (`scripts/verify-local.sh:192-210`); run recorded in CP-4 | PENDING (CP-4) |

Next action: Draft CP-2 — write the measurable end-state goals, score the three required target models (NodeNext ESM→`dist/`, CommonJS→`dist/`, dual-package/bundled) in a decision matrix weighting the observed CJS compatibility mass from §4, resolve the dual-package hazard against the Node.js packages documentation, and fix the single end-state contract (tree, module format, `package.json` shape, compiler projects, declarations, source maps, clean-output ownership).
