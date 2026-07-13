# ADR 0044: Workflow Distribution Model for parallix

Status: Accepted
Date: 2026-06-02
Last updated: 2026-07-11 (task-2223 — repository-wide TypeScript model accepted)

## 2026-07-11 Update: Repository-wide TypeScript development, build, test, and distribution model (task-2223)

This dated update decides the end-state TypeScript architecture that the
2026-06-22 distribution stance left open. It selects one coherent model for
source layout, module format, compiler projects, tests, package metadata,
declarations, source maps, assets, and local execution, and decomposes the
migration into reviewable follow-up missions. **It changes no runtime, build,
test, or package behavior in this mission** — the sections below are the
accepted contract that migration missions implement. The 2026-06-22 update and
the original Context/Decision below are preserved unchanged as history.

### 1. Current state (evidence inventory)

The repository today runs a hybrid model with two apparent output layouts and
an mtime-based drift guard:

```
                    TypeScript sources (authoritative, tracked)
                    index.ts   px.ts   lib/**/*.ts        (72 .ts under lib/)
                          │
          ┌───────────────┴────────────────────┐
          │ npm run build                      │ npm run build:cjs
          │ (tsc → outDir "dist")              │ (tsc --rootDir . --outDir .
          ▼                                    ▼  --module CommonJS + shebang fix)
   dist/** (gitignored,                 sibling .js beside every .ts
   consumed by nothing today)           (gitignored except one tracked file:
                                         lib/commands/repair-handoff.js)
                                               │
              ┌────────────────────────────────┼──────────────────────────┐
              ▼                                ▼                          ▼
   npm test (pretest=build:cjs;      npm pack / npm publish        node index.js <cmd>
   node --test over 148 CJS          (files allowlist ships        (source-checkout dev,
   test/*.test.js, tests             sibling .js, strips           runs sibling .js)
   excluded from typecheck)          lib/**/*.ts; mtime
                                     freshness guard fail-closed)
```

| Surface | Evidence | Current behavior |
|---|---|---|
| Package manifest | `package.json:7-13` | No `"type"` field (Node default: CommonJS); `"main": "index.js"`, `"bin": {"px": "px.js"}` point at repo-root compiled siblings; `"engines": {"node": ">=20"}`. |
| npm artifact contents | `package.json:34-49` | `files` allowlist ships compiled `lib/**/*.js` plus `config/`, `data/`, `docs/`, `examples/`, `prompts/`, `templates/`, and excludes TypeScript sources under `lib/` via `!lib/**/*.ts` (`package.json:45`). |
| TypeScript configuration | `tsconfig.json` (the only tsconfig in the repository) | `module`/`moduleResolution` `NodeNext`, `target ES2024`, `strict`; `outDir: "dist"`, `rootDir: "."`; includes `index.ts`, `px.ts`, `lib/**/*.ts`; **excludes `test/`** (`tsconfig.json:19`); `allowJs`/`checkJs` false. |
| Build scripts | `package.json:51-52` | `build` = plain `tsc` (emits to `dist/`, consumed by nothing); `build:cjs` = in-place sibling emit with `--module CommonJS --moduleResolution Node`, then shebang re-insertion and `chmod +x px.js`. |
| ESLint | `eslint.config.mjs:9-22` | Flat config lints `**/*.ts` and non-generated `**/*.js`; a hand-maintained `compiledJsIgnores` glob list mirrors `.gitignore`'s compiled-output entries. |
| Unit test runner | `test/run-default-tests.js:7-20`, `package.json:56-57` | `pretest` runs `build:cjs`; `npm test` runs Node's built-in `node --test` over every `test/*.test.js` (148 CommonJS files, 0 TypeScript) except the real-agent smoke, preloading `test/bootstrap-parallix-home.js` via the CommonJS-only `--require` flag. |
| E2E runners | `config/integration-pipelines.json`, `docs/real-agent-smoke.md:41` | `node test/e2e-mission-lifecycle.test.js` (gate order 50) and `node test/e2e-real-agent-smoke.test.js` (order 51) run as integration-only gates. |
| Build-freshness guard | `lib/core/build-freshness.ts:32-51`, `package.json:53-55` | mtime comparison of `.ts`/`.js` pairs for `px`, `index`, and every `lib/commands/*.ts`; wired to `prepack`/`prepublishOnly`; bypass via `PARALLIX_SKIP_BUILD_CHECK=1`; skips installed packages by design (task-1424, `lib/core/build-freshness.ts:76-99`). |
| Package-content tests | `test/package-persistent-data.test.js`, `test/task-1424-post-integrate-publish-reinstall.test.js` | Real pack/install proof exists: `"global tarball reinstall preserves PARALLIX_HOME stats and agent blocklist"` and `"installed tarball runtime does not trip the stale-build guard on a fresh, correctly-built checkout"` build, pack, and install into temp dirs. |
| Coverage | `package.json:58` | `test:coverage` runs `node lib/commands/coverage-gate.js --lcov` against compiled sibling output. |
| Mutation testing | `scripts/verify-local.sh:186-189`, `lib/commands/mutation-gate.ts:118-121`, `stryker.conf.json`, ADR 0049 | Diff-scoped StrykerJS ratchet: rebuilds siblings, mutates the compiled `.js` targets, shells out to `node --test`. Coupled to the sibling-output layout. |
| Executable entry points | `px.ts:1`, `index.ts:1`, `package.json:52` | Both entries carry `#!/usr/bin/env node`; `build:cjs` repairs the compiled `px.js` shebang and executable bit. |
| Tracked generated JavaScript | `.gitignore:15-25`; `git ls-files` | Compiled output is gitignored (`dist/`, per-directory `lib/**` globs, `/index.js`, `/px.js`) with exactly one tracked exception: `lib/commands/repair-handoff.js` beside its `.ts` source. |
| Asset resolution | `lib/commands/draft.ts:17-18` | Runtime assets resolve `__dirname`-relative with hard-coded `../..` depth — correct in the sibling layout, broken by any layout that changes module depth. |
| Import-specifier convention | `px.ts:5` | Sources already use ESM `import` syntax with explicit `.js` extensions (the NodeNext requirement), compiled down to CommonJS `require`. |
| Direct source execution | `package.json:68` | `tsx ^4.22.4` is a devDependency wired to no npm script; the documented dev path runs compiled output (`node index.js <command>`, `README.md:194-206`). |

Pain points this decision removes: (a) two output layouts where only one is
consumed; (b) one tracked generated file creating noisy diffs; (c) tests
excluded from the type boundary; (d) mtime freshness as the only drift
defence; (e) per-directory ignore globs duplicated between `.gitignore` and
`eslint.config.mjs`; (f) depth-coupled asset resolution.

### 2. Measurable end-state goals

- **G1 One authoritative source tree.** `index.ts`, `px.ts`, and `lib/**/*.ts` are the only runtime sources; the count of tracked compiled runtime `.js` files is 0 (today: 1, `lib/commands/repair-handoff.js`).
- **G2 Reproducible clean builds.** From a fresh clone: `npm ci && npm run build && npm test` passes with no pre-existing artifacts; building the same commit twice yields an identical `dist/` file list.
- **G3 Generated output separated.** All compiled output lives under `dist/` (gitignored); `git status` is clean after any build; no build writes into the source tree.
- **G4 Full intended type coverage.** `tsc --noEmit` covers all runtime sources **and** all `test/**/*.js` files (via a test typecheck project); today tests are excluded (`tsconfig.json:19`).
- **G5 Explicit public API boundary.** `package.json` `"exports"` restricts package-name resolution to the declared entry; internal `lib/` paths are not public API.
- **G6 Correct npm artifact contents.** `npm pack --dry-run` output matches the inclusion/exclusion table in §7 exactly: no runtime `.ts`, no tests, no operator state.
- **G7 Debuggable stack traces.** `dist/**/*.js.map` is emitted and published; the `px` entry enables source maps so traces cite `.ts` files and lines.
- **G8 Fast local feedback.** One documented command each for: direct-source run (no build step), typecheck, unit tests; unit tests require at most one incremental `tsc` build.

### 3. Alternatives and scored decision matrix

Three coherent end-to-end models were evaluated. Scores are 1 (worst) to 5
(best); weights reflect this repository's exposure: compatibility, package
correctness, and migration cost carry weight 3 because the observed
compatibility mass is large (148 CommonJS test files; the CommonJS-only
`--require` preload at `test/run-default-tests.js:14`; `require()` calls into
compiled output at `scripts/verify-local.sh:76` and `package.json:53`; the
compiled-`.js` mutation scoper at `lib/commands/mutation-gate.ts:118`), while
toolchain complexity, debugging, and local feedback carry weight 2.

| Criterion (weight) | A: NodeNext ESM → `dist/` | B: CommonJS → `dist/` | C: Dual-package / bundled |
|---|---|---|---|
| Compatibility with current consumers and tests (3) | 2 — every CJS test file, the `--require` preload, and script-level `require()`s must move or be shimmed | 5 — existing tests, preload, and `require()` couplings keep working; only paths change | 3 — CJS half compatible, but the artifact doubles |
| Toolchain complexity (2) | 3 — single `tsc`, but `__dirname` disappears, interop rules shift, shebang/bin behavior re-verified | 4 — single `tsc`, no semantic shift from today's emit | 1 — two builds or a bundler; conditional `exports`; largest surface |
| Package correctness (3) | 4 — single format, no hazard | 4 — single format, no hazard | 1 — carries the documented dual-package hazard; two copies of every module |
| Debugging / stack traces (2) | 4 — source maps supported | 4 — source maps supported identically | 2 — bundling obscures traces; dual output doubles map surface |
| Migration cost (3) | 1 — test conversion or mass `.cjs` renames, preload replacement, asset/mutation rework land together | 4 — mechanical repointing, phaseable with a rollback point per step | 2 — everything in B plus a second pipeline |
| Local feedback (2) | 4 — `tsx` runs sources directly | 4 — `tsx` runs sources directly | 3 — bundle step slows the loop |
| **Weighted total** | **43** | **63** | **30** |

**Winner: B — CommonJS emitted to `dist/`.**

**Dual-package hazard and rejection of C.** Node.js documents that packages
exposing both `"import"` and `"require"` conditions risk the dual
CommonJS/ES-module-packages hazard: two module instances of the same package
can load in one process with divergent state (Node.js Modules: Packages,
accessed 2026-07-11). No current consumer requires dual output: `package.json`
has no `exports` field today, ADRs 0044/0046 describe only the CLI
tarball/registry path, and no external `require()`/`import` consumer of
parallix-as-a-library is evidenced anywhere in the repository. **Dual-package
output is rejected.** Discovery of a real consumer needing it is a
stop-and-reassess condition for this decision, not license to broaden it.
Bundled single-file output was already rejected as the primary path by this
ADR's original decision matrix (Option E) and stays a future enterprise
extension.

**Why not ESM now.** Option A is the more modern layout, but novelty is not a
scored criterion; observed compatibility is. The sources already use
NodeNext-style extension-ful `import` specifiers (`px.ts:5`), so the accepted
model keeps the door open: a later ESM flip is primarily a `"type"` flip plus
the test-side migration — and is permitted **only** through a future dated
update to this ADR. Until then, ESM emit is rejected, not deferred-ambiguous.

### 4. Accepted end-state contract

All items in this section are decided; no mutually exclusive options remain
open.

**Repository tree (authoritative):**

```
index.ts  px.ts  lib/**/*.ts        # the only runtime sources (tracked)
test/**/*.js                        # checked-JavaScript tests (tracked; see §5)
tsconfig.json                       # emit project (runtime sources → dist/)
tsconfig.test.json                  # check-only project (tests; noEmit)
dist/                               # ALL generated output (gitignored, never tracked)
  dist/index.js  dist/px.js  dist/lib/**/*.js  (+ .js.map siblings)
prompts/  templates/  config/  data/  docs/  examples/  tools/   # assets at package root
```

- **Module format:** CommonJS emit. `package.json` gains an explicit
  `"type": "commonjs"` (today the field is absent and CommonJS is implied;
  making it explicit pins the emit format under NodeNext detection rules).
- **Import-specifier convention:** ESM `import` syntax in `.ts` sources with
  explicit `.js` extensions on relative specifiers, exactly as today
  (`px.ts:5`). This is an ecosystem requirement under
  `moduleResolution: NodeNext`, not a style preference.
- **`package.json` contract:** `"type": "commonjs"`;
  `"main": "dist/index.js"`; `"bin": {"px": "dist/px.js"}`;
  `"exports": {".": "./dist/index.js", "./package.json": "./package.json"}`.
  The `exports` field formalizes that deep paths into `lib/` are not public
  API (Node resolves `exports` in precedence over `main` when importing by
  name). The CLI (`px`) is the supported product surface.
- **Compiler projects:** `tsconfig.json` is the emit project — `module`/
  `moduleResolution: NodeNext`, `outDir: "dist"`, `rootDir: "."`, `strict`,
  `sourceMap: true`, `declaration: false`; includes only runtime sources.
  `tsconfig.test.json` is the check-only project — `noEmit: true`,
  `allowJs: true`, `checkJs: true`, including `test/**/*.js` (see §5). The
  legacy `build:cjs` flag override (`--module CommonJS --moduleResolution
  Node`) is retired with the sibling layout; plain `tsc` with
  `"type": "commonjs"` emits the same CommonJS format under NodeNext.
- **Declaration policy:** `.d.ts` files are neither emitted nor published.
  parallix is a CLI, not a typed library; there is no evidenced library
  consumer (§3). This is a repository preference, revisitable only via a
  dated ADR update if such a consumer appears.
- **Source-map policy:** `.js.map` files are emitted by the build and shipped
  in the npm artifact. The `dist/px.js` and `dist/index.js` entries enable
  source maps at startup (`process.setSourceMapsEnabled(true)`) so operator
  stack traces cite `.ts` locations.
- **Shebang/executable contract:** `px.ts` and `index.ts` keep
  `#!/usr/bin/env node` as their first line; `tsc` preserves the shebang in
  emitted entries, and npm requires it for `bin` targets. The tarball smoke
  proof (§7) verifies the installed `px` launches.
- **Clean-output ownership:** `dist/` is owned exclusively by `npm run build`
  (plain `tsc`); a `clean` script removes it; it stays gitignored; the count
  of tracked compiled runtime files is 0 (the one tracked sibling,
  `lib/commands/repair-handoff.js`, is deleted in migration phase T4). With
  the sibling layout gone, the per-directory compiled-output globs disappear
  from both `.gitignore:15-25` and `eslint.config.mjs:9-22`, ending the
  duplicated ignore-list maintenance.
- **Development execution path:** direct-source runs use `tsx` (already a
  devDependency, `package.json:68`) via a wired npm script (`npm run dev --
  <command>`, executing `tsx px.ts`); compiled runs use `node dist/index.js
  <command>` after `npm run build`. The README's `node index.js <command>`
  guidance is updated in migration phase T5.

### 5. Test contract

- **Checked JavaScript, not conversion.** The 148 `test/*.test.js` files stay
  CommonJS JavaScript and enter the type boundary through
  `tsconfig.test.json` (`allowJs` + `checkJs` + `noEmit`). Wholesale
  conversion to TypeScript is rejected on migration cost (it would be the
  single largest diff in the repository for no behavioral gain). Authoring
  new tests in TypeScript is deferred to optional phase T6 and is **not**
  required for this decision to complete.
- **Test-only typecheck configuration:** `tsconfig.test.json` as defined in
  §4; wired into `./scripts/verify-local.sh static-analysis` alongside the
  existing ESLint and runtime typecheck stages.
- **Runners:** Node's built-in `node:test` remains the only test runner.
  Unit: `npm test` → `test/run-default-tests.js` (the `--require` preload of
  `test/bootstrap-parallix-home.js` keeps working because tests remain
  CommonJS). E2E: `node test/e2e-mission-lifecycle.test.js` and
  `node test/e2e-real-agent-smoke.test.js` as integration gates, unchanged.
- **Execution against `dist/`:** after phase T4, tests and repo scripts load
  runtime modules from `dist/` (e.g. `require('../dist/lib/...')`), and
  `pretest` runs `npm run build` instead of `build:cjs`.
- **Coverage:** `npm run test:coverage` (`lib/commands/coverage-gate.js
  --lcov`) is retained, executing against `dist/` output after T4.
- **Mutation testing:** the diff-scoped StrykerJS ratchet (ADR 0049) is
  retained; phase T4 repoints the scoper's target mapping from sibling
  `lib/**/*.js` to `dist/lib/**/*.js`. Ratchet semantics are unchanged.
- **Direct source execution during development:** `npx tsx px.ts <command>`
  (wrapped as `npm run dev`) — this is the command for running uncompiled
  sources; tests always run against compiled output to keep the tested
  artifact identical to the shipped artifact.

### 6. Asset resolution and copy contract

Non-code assets (`prompts/`, `templates/`, `config/`, `data/`, `docs/`,
`examples/`, and the executable `tools/setup-forgejo-docker.sh`) follow one
rule in both layouts:

- **Assets live at the package root and are never copied into `dist/`.** The
  build emits JavaScript and source maps only. The npm `files` allowlist
  ships the asset directories at the package root exactly as today
  (`package.json:34-49`), so the installed package root and the source
  checkout root have the same asset shape.
- **Resolution is module-relative through one helper.** A single
  `packageRoot()` helper in `lib/core/` locates the package root by walking
  up from the calling module's `__dirname` to the nearest directory whose
  `package.json` has `"name": "@magnusekdahl/parallix"`. Every asset lookup
  goes through it. This replaces hard-coded depth arithmetic such as
  `path.join(__dirname, '..', '..', 'prompts', ...)`
  (`lib/commands/draft.ts:17-18`), which silently breaks when compiled depth
  changes (`lib/commands/` vs `dist/lib/commands/`).
- **CWD-dependent asset lookup is prohibited.** `process.cwd()` identifies
  the *target repository* (this ADR's runtime/target-state boundary), never
  the location of tool-owned assets. No module may resolve `prompts/`,
  `templates/`, `config/`, documentation, or scripts relative to the CWD.
- The helper works identically for: compiled runs (`dist/lib/core/x.js` walks
  up to the installed package root), source-checkout compiled runs, and
  direct-source runs via `tsx` (`lib/core/x.ts` walks up to the checkout
  root). Migration phase T2 lands the helper plus temp-directory resolution
  tests before any layout change.

### 7. Target verification contract (replaces mtime freshness)

The mtime-based drift guard (`lib/core/build-freshness.ts:32-51`) exists
because compiled output lives beside sources and can silently go stale. In the
target architecture that failure mode is removed by construction, and the
guard is replaced by four reproducible checks:

- **V1 — Clean-checkout build proof.** From a pristine checkout of the release
  commit (`git status --porcelain` empty): `npm ci && npm run build &&
  npm test`. Because `prepack` runs `npm run build`, every packed artifact is
  freshly emitted at pack time — a stale `dist/` can never be shipped, which
  is the property the mtime guard approximated.
- **V2 — Reproducible-output check.** Build the same commit twice into clean
  `dist/` trees; the emitted file lists must be identical. This pins G2 and
  catches nondeterministic emit or stray build inputs.
- **V3 — Package-content audit.** `npm pack --dry-run` output is checked
  against the §8 inclusion/exclusion table. This extends ADR 0046's
  operational content audit into a named, scripted gate rather than an
  operator habit.
- **V4 — Tarball-install smoke.** Pack, install into a temporary prefix, run
  `px --version` and representative read-only commands. This generalizes the
  existing proofs in `test/task-1424-post-integrate-publish-reinstall.test.js`
  and `test/package-persistent-data.test.js`, which already build, pack, and
  install into temp dirs.

**Temporary migration guard.** The existing mtime guard remains in force
during phases T1–T4, because the sibling `.js` layout stays the
source-checkout runtime until T4 completes and can still go stale in exactly
the way the guard detects. Its purpose during migration is unchanged
(fail-closed `prepack`/`prepublishOnly`, `PARALLIX_SKIP_BUILD_CHECK=1`
bypass). **Removal gate:** phase T5 deletes the guard, `publish:guard`, and
`build:cjs` together, and may do so only after V1–V4 are wired and passing as
gates. Deleting the guard before its replacements are enforced is a
stop-the-phase condition.

### 8. Publication proof

Named steps, executed in order for every release (automatable later; the
contract is the sequence, not the automation):

1. **P1 clean checkout** — fresh `git clone` (or pristine worktree) of the
   release commit; `git status --porcelain` must be empty.
2. **P2 install** — `npm ci`.
3. **P3 build** — `npm run build` (emits `dist/` only).
4. **P4 test** — `npm test`.
5. **P5 content audit** — `npm pack --dry-run`; compare against the table
   below; any unexpected entry fails the release.
6. **P6 pack** — `npm pack` (`prepack` re-runs the build, so the tarball is
   never stale).
7. **P7 temp install** — `npm install -g --prefix "$(mktemp -d)"
   ./magnusekdahl-parallix-*.tgz`.
8. **P8 identity smoke** — `px --version` from that prefix; it must print the
   executing `px.js` path (PATH-collision visibility, per the 2026-06-22
   update).
9. **P9 representative commands** — read-only commands (`px status`,
   `px stats`) against a temporary target repository.
10. **P10 publish** — `npm publish --access public` per ADR 0046 (registry
    path) or distribution of the tarball (local path).

**Artifact inclusion/exclusion table (the V3/P5 reference):**

| Content | In tarball? | Rationale |
|---|---|---|
| `dist/**/*.js` | **Included** | The runtime. |
| `dist/**/*.js.map` | **Included** | Source-mapped stack traces (G7). |
| `*.d.ts` declarations | Excluded | Not emitted; no library consumer (§4). |
| `index.ts`, `px.ts`, `lib/**/*.ts` | Excluded | Sources are not needed at runtime; today only `lib/**/*.ts` is stripped (`package.json:45`) while root entries are excluded by omission — the target makes the exclusion uniform. |
| `test/` (all 148+ test files) | Excluded | Tests never ship. |
| `tsconfig.json`, `tsconfig.test.json`, `eslint.config.mjs`, `stryker.conf.json` | Excluded | Development configuration. |
| `prompts/`, `templates/`, `config/`, `data/`, `docs/`, `examples/`, `tools/setup-forgejo-docker.sh` | **Included** | Tool-owned assets at package root (§6). |
| `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md` | **Included** | npm always includes manifest/README/LICENSE; CHANGELOG is the versioning authority. |
| Operator state: `.forgejo-local/`, sessions, `agents.local.json`, `graphify-out/`, `missions/`, `backlog/` | Excluded | Operator/repo-local state never ships (ADR 0046 security posture). |

### 9. Phased migration backlog

Each phase is one review-sized mission. No phase is implemented by task-2223.
Every phase ends at a commit that is independently revertable; "rollback"
names what a revert restores. Integration gates refer to the pipeline in
`config/integration-pipelines.json` and `./scripts/verify-local.sh`.

| Phase | Depends on | Scope (one mission each) | Compatibility shim while it lands | Gates (acceptance evidence) | Documentation duty | Rollback point |
|---|---|---|---|---|---|---|
| **T1 — Test typecheck project** | — | Add `tsconfig.test.json` (`noEmit`, `allowJs`, `checkJs`, includes `test/**/*.js`); wire it as a stage in `./scripts/verify-local.sh static-analysis`; fix or `@ts-expect-error`-annotate revealed test-type defects | None needed — no runtime or layout change | `./scripts/verify-local.sh static-analysis` and `npm test` pass; typecheck stage demonstrably covers `test/` | Note the new stage in AGENTS.md's static-analysis description | Revert the phase commit; runtime untouched |
| **T2 — Asset-resolution hardening** | — | Add `packageRoot()` in `lib/core/`; migrate every depth-coupled asset lookup (e.g. `lib/commands/draft.ts:17-18`) to it; add temp-directory resolution tests proving lookups are CWD-independent | None — behavior-preserving refactor in the current layout | `npm test` and `node test/e2e-mission-lifecycle.test.js` pass; new resolution tests exercise a temp dir that is not the checkout | — | Revert the phase commit |
| **T3 — Package flips to `dist/`** | T2 | `package.json`: add `"type": "commonjs"`, point `main`/`bin`/`exports` at `dist/`, rewrite `files` for the §8 table; `prepack` runs `npm run build`; enable `sourceMap` in `tsconfig.json`; entries enable source maps | Sibling layout and `build:cjs` remain the source-checkout dev/test runtime; only the packed artifact changes | Updated tarball tests pass, incl. successors of `"installed tarball runtime does not trip the stale-build guard on a fresh, correctly-built checkout"` and `"global tarball reinstall preserves PARALLIX_HOME stats and agent blocklist"`; `px --version` from a temp-prefix install; `npm pack --dry-run` matches the §8 table | CHANGELOG MINOR entry; update `docs/authority-reference.md` install steps | Revert `package.json`/`tsconfig.json`; previous tarball shape restored |
| **T4 — Repo runtime moves to `dist/`** | T3 | `pretest` becomes `npm run build`; tests and repo scripts load `dist/` (test `require` paths, `scripts/verify-local.sh:76` `gate_integrate` require, `publish:guard` require, `npm run test:coverage` target); mutation scoper maps diff `.ts` → `dist/lib/**` (`lib/commands/mutation-gate.ts:118`); **delete tracked `lib/commands/repair-handoff.js`**; trim sibling globs from `.gitignore:15-25` and `eslint.config.mjs:9-22` (keep `dist/`) | `build:cjs` and the mtime guard remain available this phase so a revert restores a working sibling flow | `npm test`, `./scripts/verify-local.sh static-analysis`, `./scripts/verify-local.sh mutation-gate --dry-run`, `node test/e2e-mission-lifecycle.test.js` all pass on the `dist/` layout | Update ADR 0049's layout description via dated note | Revert the phase commit; `build:cjs` regenerates siblings |
| **T5 — Retire sibling build and mtime guard** | T4, and V1–V4 wired as passing gates | Delete `build:cjs`, `publish:guard`, `prepack`/`prepublishOnly` freshness wiring, and `lib/core/build-freshness.ts` + its tests; add the V3 content-audit script and V2 reproducibility check as named gates; add `npm run dev` (`tsx px.ts`); update README Development and `docs/authority-reference.md` §Public distribution | None — replacements must already be enforced (see §7 removal gate) | Full integration pipeline (`px integrate` gate plan) passes; `npm pack --dry-run` audit passes; tarball-install smoke passes; CHANGELOG MINOR entry | Rewrite README `node index.js` guidance to `node dist/index.js` / `npm run dev`; supersede the freshness narrative in `docs/authority-reference.md` | Revert restores guard + `build:cjs` intact (they are deleted, not decayed) |
| **T6 — TypeScript test authoring (optional)** | T1, T4 | Allow new tests in TypeScript and/or convert high-value suites; extend `tsconfig.test.json` | n/a | `npm test` + static-analysis | — | Revert; deferred indefinitely without affecting T1–T5 |

Deletion timing, explicitly: the tracked sibling
`lib/commands/repair-handoff.js` dies in **T4**; `build:cjs`, the mtime guard,
and `PARALLIX_SKIP_BUILD_CHECK` die in **T5**; nothing is deleted in T1–T3.

Backlog tasks capturing these phases: T1 = task-2224, T2 = task-2225,
T3 = task-2226, T4 = task-2227, T5 = task-2228, T6 (optional) = task-2229.

### 10. Compatibility and semver impact

- **CLI surface (the supported product): unchanged.** Every `px <command>`
  behaves identically; only the file executing it moves to `dist/px.js`.
- **Package-name resolution: unchanged.** `require('@magnusekdahl/parallix')`
  keeps resolving — `exports`/`main` move the target to `dist/index.js`.
- **Deep subpath requires break at T3** (`@magnusekdahl/parallix/lib/...`)
  once `exports` encapsulates internals. No such consumer is evidenced (§3);
  these paths are declared non-public here. If a real one surfaces, that is
  the same stop-and-reassess condition as the dual-package clause.
- **Semver:** under the CHANGELOG-authority discipline
  (`docs/authority-reference.md`), phases T1, T2, T4, T6 are PATCH-class
  (internal); **T3 and T5 are MINOR-class** with explicit changelog entries
  (artifact layout and release-verification contract change). Nothing here is
  MAJOR because the supported public surface — the CLI — is unchanged.

## 2026-06-22 Update: Public distribution stance (task-1331)

parallix was pushed to public GitHub on 2026-06-22. This ADR is moved from
`Proposed` to `Accepted` with one concrete near-term public distribution stance,
so the public repo has a single authoritative answer for contributors and
operators. The original Context/Decision/analysis below is preserved as the
reasoning that produced this stance.

**Accepted near-term model: local npm tarball, globally installed `px` CLI — no
registry publish.** This is Alternative A (external runner / package boundary)
realized as the simplest credible delivery for a freshly public repo:

- The published package name is the scoped `@magnusekdahl/parallix`, resolving the
  `px` namespace risk (this ADR, "`px` Namespace Risk", items 1–4). The unscoped
  `px` / `parallix` npm names are not relied upon.
- Acquisition is `npm pack` from this repo followed by a single global
  `npm install -g <tarball>` (a user-writable `--prefix` is supported for
  no-sudo installs). Reinstall replaces rather than accumulates runtimes.
- `node parallix <command>` (source run) remains the compatibility baseline and
  the local-development path; the tarball install is the same code with a
  versioned global `px`.
- `package.json` reflects this: `"private": false`, `"name": "@magnusekdahl/parallix"`,
  `bin.px`, and a `files` allowlist. The operator-facing install/invoke/source-dev
  story lives in `README.md` ("Public distribution (canonical packaging and
  install)").

**Still deferred (not accepted by this stance):** publishing to the public npm
registry or any registry, standalone single-file binaries, Homebrew, Docker, and
CI/release automation or signing. The enterprise no-source-copied artifact path
(acceptance gate 6) and the per-command logging/dry-run audit (gate 7) remain
open follow-up work; the accepted stance is the manual local-tarball path that is
proven by the existing `px.js` runner, `files` allowlist, and Node test suite,
not those still-open enterprise gates.

## Context

parallix (`workflow/`) is a Node.js CLI that coordinates AI-assisted software missions through the full lifecycle: `draft → active → review → integrate → done`. It lives as raw, uncompiled source in the WrGroceries monorepo at `workflow/` — no bundlers, no transpilation, no publish step. This was chosen deliberately in ADR 0037 to preserve the fastest possible developer iteration: `node workflow <command>` works immediately with zero setup.

Since then, parallix (the workflow tool) has grown beyond WrGroceries use:

1. **WrGroceries inner-loop** (current): `node workflow` runs directly from source in the monorepo root. Zero friction.
2. **EM task repository**: The operator maintains a separate repository for EM-only tasks. Copying `workflow/` there is feasible but creates implicit drift — there is no version boundary, no way to say "which revision am I running?", and no automated way to get updates.
3. **Enterprise locked-down repositories**: The operator wants to demonstrate and test parallix in enterprise repos where committing custom Node.js code is prohibited. Enterprise IT policy does not allow unreviewed source code in product repositories. parallix's current architecture requires the code to live *inside* the target repository to function, which is incompatible with this constraint.
4. **Public publishing**: The operator wants to share parallix publicly. A directory of Node files without a package manifest, CLI entry point, semantic versioning, changelog, or distribution mechanism is not credible as a public tool from an EM facing senior/staff engineers.

The current model optimizes for use case 1 at the expense of 2, 3, and 4. The `workflow/package.json` exists but is marked `"private": true`, has no `bin` field, no exports map, no dependencies beyond one optional devDependency (`sonarqube-scanner`), and one entry point (`index.js`). The `workflow/lib/` directory contains 44 modules across these domains:

- **Command handlers** (one per `node workflow <command>`): `mission-start.js`, `draft.js`, `active.js`, `status.js`, `checkpoint.js`, `review.js`, `handoff.js`, `integrate.js`, `resolve-conflict.js`, `rebase.js`, `diff.js`, `stats.js`, `verification.js`, `coverage-gate.js`
- **Core infrastructure**: `git.js`, `fmt.js`, `spawn-tee.js`, `gatekeeper.js`
- **Agent adapters**: `codex.js`, `claude.js`, `gemini.js`, `glm.js`, `opencode.js`, `mistral.js`
- **State/config**: `state-map.js`, `backlog.js`, `product-config.js`, `forgejo.js`, `agents.js`, `sessions.js`
- **Review subsystem**: `review-state.js`, `review-polling.js`, `review-events.js`, `review-loop.js`, `review-artifacts.js`, `review-commands.js`, `review-prompts.js`
- **Utility**: `mission-utils.js`, `repair-handoff.js`, `limit-hit.js`, `runtime-matrix.js`, `stats-backback.js`

The `workflow/config/` directory holds `state-map.json` (virtual-to-actual state mappings) and `agents.json` (agent family eligibility). The `workflow/data/` directory holds `stats.csv` (mission history). These are all repo-relative paths assumed to exist at fixed locations beneath the `workflow/` directory root.

There is no existing target-repository resolution mechanism that lets parallix operate from outside the host repository. Some modules read and write repo state through paths rooted in the current `workflow/` checkout, while normal JavaScript imports such as `require('./lib/...')` resolve tool code relative to the runtime. Those are different path classes and must not be collapsed into one rule during extraction.

## Decision

**Adopt parallix productization with `px` as the intended short external binary name, while separating the workflow runtime from target-repository state. Do not lock subcommands, flag names, config schema, install location, or enterprise distribution mechanism in this ADR.**

The current `workflow/` directory remains the source of truth until extraction work proves a safer boundary. Future phases must first classify every path the workflow touches as one of:

- **Tool-owned assets**: code, prompts, built-in config, tests, and release metadata that travel with parallix.
- **Target-repository state**: `AGENTS.md`, mission docs, backlog tasks, review events, git branches/worktrees, verification scripts, and any repo-local policy files.
- **Operator-local state**: credentials, agent launcher commands, sessions, caches, and workstation-specific settings.

Only after that classification is proven by tests may implementation work introduce a package boundary or new invocation surface.

### Candidate consumption modes

These modes describe use cases to validate, not an installation contract:

| Mode | Candidate delivery mechanism | Target repo needs workflow source? | Use case | Required proof before adoption |
|------|------------------------------|-----------------------------------|----------|--------------------------------|
| WrGroceries local | Existing `node workflow <cmd>` from source | Existing repo-owned source | Current inner-loop development | Existing behavior remains byte-for-byte or semantically equivalent where output includes expected runtime data |
| Local external runner | A checked-out or locally linked parallix runtime outside the target repo | No copied `workflow/` in target repo | EM repo and cross-repo dogfooding | Commands operate on an explicit target repo without assuming sibling directories or a fixed OS path |
| Package artifact | npm package, tarball, or another Node-compatible artifact | No copied `workflow/` in target repo | Broader reuse and version pinning | Artifact contents, install/run process, and update path are proven in temporary directories |
| Enterprise artifact | To be determined after enterprise constraints are known | No copied workflow source | Locked-down demos | Human-reviewed feasibility note covering allowed runtimes, network policy, source-review expectations, and artifact handling |
| Standalone binary | Future option only | No copied workflow source | Environments without Node/npm | Separate ADR or task after package boundary is stable |

### Interface Boundary

ADR 0044 accepts `px` as the intended short binary name for external distribution because the product is being renamed and prepared for external visibility. It does **not** define the `px` subcommand list, flag names, help text, or repo-selection syntax. The accepted interface requirements are:

1. The existing `node workflow <command>` interface continues to work in WrGroceries during extraction.
2. Any `px` interface beyond the binary name must be proposed by implementation evidence, documented in its own task, and tested against at least one temporary target repo.
3. Target repository selection must be explicit and OS-neutral. It may use CWD, an absolute path, a relative path, or config discovery, but it must not assume sibling worktree names, home-directory layouts, package manager globals, or platform-specific install directories.
4. Existing command behavior is the compatibility baseline. New ergonomics such as `doctor`, `init`, aliases, or dry-run modes are product features, not ADR commitments.

### `px` Namespace Risk

`px` is a good product-aligned short name, but it is not globally unique. Current/historical public uses include:

- `@ae-studio/px`, a JavaScript package-manager command wrapper that installs a `px` binary and advertises invocations such as `px dev` and `px install`.
- PX Systems, a parallel/cloud execution tool centered on a `px` CLI with commands such as `px cluster up` and `px job submit`.
- `@posix/px`, an older npm script-shell package that exposes `px` / `px.cmd`.
- `px`, an older npm package for PC-Axis parsing, which occupies the unscoped npm package name even though it is not primarily a modern CLI.

The practical risk is local PATH collision, not conceptual naming failure. parallix can still use `px` if follow-up packaging work proves:

1. The published package name is scoped, for example `@magnusekdahl/parallix`, rather than relying on the unscoped `px` package name.
2. Install is a single global install (`npm install -g <tarball>`) that replaces on reinstall rather than accumulating runtimes, and is never blind: `px --version` identifies the executing `px.js` path, operators check for a pre-existing `px` on PATH (item 4), and a user-writable prefix (`npm config set prefix`) can control the location. (Resolved by TASK-1236; see `parallix/README.md`.)
3. `px` startup/help output clearly identifies parallix so accidental collisions are obvious.
4. Enterprise and dogfood validation check whether `px` is already present on PATH and document the selected invocation form.

### Configuration and State Boundary

ADR 0044 does **not** define `parallix.config.json`, presets, adapter schemas, or config merge order.

Before a config file is added, follow-up work must produce a configuration inventory that answers:

1. Which current files are tool defaults (`workflow/config/state-map.json`, `workflow/config/agents.json`, prompts, command metadata).
2. Which files are target-repo state (`docs/missions/*`, `backlog/tasks/*`, `review-events/*`, verification scripts, repo instructions).
3. Which values are operator-local and must not be committed (agent commands, tokens, local session paths, caches).
4. Which values truly need repo-local override, with examples from actual WrGroceries and EM usage.

Any eventual config contract must be minimal, evidence-based, and treated as a product API with migration and compatibility tests.

### Package Boundary

The package layout is intentionally unresolved. A future phase may keep the current `workflow/` shape, introduce subpackages, or use another layout, provided it proves:

1. `workflow/index.js` or an equivalent compatibility shim preserves existing `node workflow` behavior.
2. Tool-owned assets resolve relative to the installed/runtime location.
3. Target-repository state resolves relative to the selected target repo.
4. Operator-local state stays outside committed target-repo artifacts.
5. Tests cover path resolution from at least one temporary target repo that is not the parallix source tree.

### Architecture boundary

```
┌─────────────────────────────────────────────────────┐
│  Target Repository                                   │
│  (any git repo: WrGroceries, EM repo, enterprise)   │
│                                                     │
│  optional config       ← only after proven needed    │
│  docs/missions/       ← mission artifacts           │
│  backlog/tasks/       ← backlog tasks               │
│  AGENTS.md            ← repo rules                  │
│  .git/                ← git data                    │
│                                                     │
│  no copied workflow source for enterprise use        │
└──────────────────────┬──────────────────────────────┘
                       │ explicit target-repo selection
                       ▼
┌─────────────────────────────────────────────────────┐
│  parallix runtime                                  │
│                                                     │
│  package, checkout, or other proven artifact        │
│    px — intended external binary                    │
│    lib/ — command implementations                   │
│      draft.js, active.js, review.js, etc.           │
│      git.js, forgejo.js, agents.js                  │
│      codex.js, claude.js, gemini.js, opencode.js    │
│    config/ — tool defaults                          │
│    data/ — tool-owned data, if any                  │
└─────────────────────────────────────────────────────┘
```

## Enterprise Safety Model

parallix is designed for use in enterprise environments where source code hygiene is mandatory:

- **No workflow source copied into enterprise target repos**: Enterprise use requires parallix to run from outside the target product repository. Vendored source may remain a separate non-enterprise distribution mode, but it does not satisfy the enterprise safety model.
- **No assumed install directory or operating system layout**: Enterprise docs must describe inputs and constraints, not hard-coded paths. Validation must use temporary directories and paths supplied at runtime.
- **Artifact claims require proof**: A `.tgz`, npm package, or binary is not assumed enterprise-safe. Each artifact must be inspectable, hashable, and tested for install/run behavior before it is documented as supported.
- **No secrets in repo config**: Credentials, tokens, local agent launcher commands, and session state remain operator-local. If config is later introduced, it must not require secrets in committed files.
- **Dry-run and logging are requirements to evaluate, not assumed existing features**: Enterprise-facing tasks must inventory which commands already support preview behavior and add explicit support only where implementation and tests prove it.
- **Explicit logging boundary required**: parallix's logging must be audited before enterprise use. The required outcome is that logs do not expose git secrets, credentials, local agent command contents, or sensitive prompt material.

## Decision matrix

| Option | WrGroceries loop | EM repo | Enterprise demo | Public credible | Source coupling | Ops cost | Decision |
|--------|-----------------|---------|-----------------|-----------------|-----------------|----------|----------|
| **A: External runner/package boundary** | Fast if compatibility shim stays | Clean if target-state boundary is proven | Possible but unproven until constraints are known | High if versioned and documented | Low — parallix tool and target repos are separate | Medium — packaging, release process, compatibility work | **Accept** |
| B: Copy/export script | Fast (is source) | Feasible but drift | Prohibits — source must be copied in | Low — no version boundary, no install mechanism | High — hidden forks across repos | Low — copy a directory | Reject as primary |
| C: Git submodule/subtree | Fast (is source) | Versioned but inline | Prohibits — source lives in target repo | Low — Git dependency, not a standard package | Medium — submodule ref is versioned code in target | Low-Medium | Accept only for non-enterprise repos that explicitly allow vendored source |
| D: Keep embedded (current) | Fastest (zero setup) | Drift-prone copy required | Prohibits — must commit source | Very low — no package, no CLI, no versioning | Maximum | Zero | Reject — status quo is the problem |
| E: Single binary (packaged) | Slower iteration (rebuild needed) | Clean | Best — no node/npm dependency | High — standalone executable | Low — separated | High — bundling, rebuild cycle, debuggability | Keep as future extension, not primary |

### Alternative analysis

**Alternative A (external runner/package boundary)**: Separate the parallix runtime from target-repo state and make versioning possible. npm packaging may be the eventual delivery path because the current workflow is Node-based and already has `workflow/package.json`. The ADR accepts `px` as the intended external binary name, but does not prescribe subcommands, flags, config schema, tarball installation flow, or filesystem layout. Those details must be proven by follow-up implementation tasks.

**Alternative B (copy/export with `w.sh` script in target)**: The operator currently solves the EM repo use case by copying `workflow/` into a second repository. This works but creates the well-known software distribution problems: no version tracking, no way to update downstream consumers, silent drift when the source repository's workflow changes. The `w.sh` shell wrapper helps with context switching between repos but does not address distribution. This is a pragmatic migration bridge but not the target architecture.

**Alternative C (git submodule)**: A submodule keeps `workflow/` as a versioned external reference. The consuming repo does not own the source but still contains it on disk. This solves versioning for non-enterprise repos that explicitly allow vendored tooling, but it fails the enterprise requirement because workflow source materializes inside the target repository. It also adds Git operational complexity (submodule init/update, fixed commits) that is unnecessary for the primary productization path.

**Alternative D (keep embedded — current model)**: The existing model. Works perfectly for use case 1 and nothing else. The `workflow/` directory is the thing being evaluated — it is the constraint, not the solution.

**Alternative E (standalone binary)**: Tools like `pkg` or `nexe` can produce a single executable. Useful for enterprise demos where the target machine has no Node.js installed. However, packaging adds a build step that breaks the current zero-friction inner loop, and single-executable Node has debugging limitations. This is a good future extension for enterprise air-gapped demos, not the right primary model.

### Why Node package artifacts remain the leading candidate over standalone binary

The distinction between Option A and E in the matrix above is delivery mechanism. Option A first proves a runtime/target-repo boundary for the existing Node workflow. A Node package artifact is the leading candidate after that proof because it fits the current implementation, but this ADR does not accept npm, tarball, or any specific install flow as the final distribution contract. Option E (standalone binary) is retained as a future enterprise extension.

The reason a Node package artifact is preferred over a standalone binary for the **first proof path** is:

1. **Inner-loop speed**: The existing source-run mode preserves the current zero-compilation loop while the boundary is proven. A binary would need rebuilds.
2. **Debuggability**: Source-level debugging of Node modules is well-supported. Standalone binaries obscure stack traces and source maps.
3. **Ecosystem alignment**: The workflow already has `package.json`, depends only on Node builtins, and has no external npm dependencies to vendor. The expected packaging cost is lower than a standalone binary, but the exact package metadata and layout remain follow-up proof work.
4. **Ecosystem familiarity**: npm packages, changelogs, and semantic versioning are standard expectations for public Node tools. A custom binary format has none of those conventions.

## Consequences

### Positive

- **WrGroceries keeps fast inner-loop**: `node workflow <cmd>` remains the compatibility baseline. No rebuild step is required until a later task proves an alternative.
- **EM repo usage can become clean**: No copying once the target-state boundary is proven. The same verified runtime can operate on a selected repo and respect that repo's backlog, missions, and AGENTS.md.
- **Enterprise demos get a credible path**: The design no longer requires copying workflow source into a target repo. Actual artifact acceptability remains to be proven with enterprise constraints.
- **Public publishing becomes credible after proof**: Semantic versioning, changelog, package metadata, and tests are standard expectations for a tool at this scope.
- **Version pinning**: A package or artifact can prove exactly which revision ran and eliminate silent copy drift.
- **Senior/staff credibility**: Versioned tooling with ADRs, changelogs, and test suites is recognized as professional-grade. The "my personal scripts" narrative is replaced by an explicit target-repo boundary backed by evidence.
- **Multi-repo consistency becomes possible**: Once package/artifact distribution is proven, repositories can run the same versioned runtime instead of divergent copies.

### Negative

- **Initial extraction cost**: The 44 modules in `workflow/lib/` must be audited and may need reorganization. Cross-module imports and `__dirname`-relative paths need classification before they can be changed safely.
- **Release discipline required**: Every change to the workflow after extraction needs a version bump (or at least clear development-version tracking). The current model has no such overhead.
- **External-runner setup for WrGroceries**: If a later task introduces workspace linking, a local package, or another external runner, that setup must be documented and tested. It is not assumed by this ADR.
- **Agent adapter coupling**: Each agent adapter (`codex.js`, `claude.js`, `gemini.js`, `glm.js`, `opencode.js`, `mistral.js`) currently resolves commands from environment variables or `agents.json`. Follow-up work must preserve the operator-local command protocol before adding repo-level overrides.
- **Config migration is unproven**: The existing `workflow/config/state-map.json` and `agents.json` may remain tool defaults, become target-repo state, or be split. A new schema is not accepted until a task proves the need.
- **Tests need adaptation**: The 44 lib modules reference each other and `workflow/` filesystem paths. Tests must be restructured to prove both source-tree and external-target execution.

## Alternatives considered

### Keep embedded (current model)

Positive: Zero-friction inner loop. No packaging overhead. Everything works out of the box.
Negative: As documented in Context, creates friction for EM repo (task 2), enterprise demos (task 3), and public publishing (task 4). Each additional repository multiplies the copy-drift problem. The ChatGPT research in the backlog task identified the embedded model as "good for one repo, poor as a reusable EM/developer tool."
Assessment: Retain as the compatibility baseline while the external boundary is proven. Do not require workspace linking until an implementation task demonstrates it is the right local development shape.

### Shell wrapper + env-based config extraction

Positive: No build step, no package boundary, no npm. Wrap `workflow/` with a shell script that sets environment variables for parallix to read, pointing it at a target repo path.
Negative: The workflow's modules use `__dirname` directly (not environment variables). Every module would need refactoring to respect env-based paths. The approach is essentially reimplementing the config/CLI layer that Option A provides as a first-class feature. The environment variable protocol would be undocumented unless treated as a formal spec.
Assessment: A valid interim step for EM repo usage if full extraction takes too long. Any environment-variable or config resolution pattern must be documented as a product API before consumers depend on it.

### Docker container

Positive: Isolates parallix from the target repo's environment. No npm, no Node installation required on the target machine. Container image can include everything.
Negative: Docker is overkill for a pure Node CLI. Container image size, build time, and runtime overhead are not justified by the problem scope. Docker-in-Docker may be blocked in enterprise environments anyway (the same environments where we want parallix).
Assessment: Not worth the cost for this problem domain unless enterprise constraints require it. A tarball may be simpler than Docker, but it is still an artifact containing files that must be reviewed and tested before being called enterprise-safe.

### Git worktree-based distribution

Positive: Leverages existing worktree infrastructure. parallix lives in one worktree, commands run from it targeting sibling worktrees.
Negative: Worktrees are a repository-level mechanism, not a distribution mechanism. They require the workflow source to exist in *some* worktree, which does not solve the enterprise constraint (some enterprise repo may not allow any worktrees, or parallix may need to run against a repo on a machine without write access).
Assessment: parallix already uses worktrees as its mission orchestration mechanism (ADR 0037). This ADR is about how parallix *code itself* reaches target repos, not how it orchestrates them. Worktrees remain an internal implementation detail.

## Acceptance Gates for `Status: Accepted`

ADR 0044 can move from `Proposed` to `Accepted` only after follow-up work proves:

1. A committed path inventory classifies tool-owned assets, target-repository state, and operator-local state across the current `workflow/` runtime.
2. `node workflow <cmd>` remains compatible for WrGroceries after any boundary refactor.
3. A `px` proof slice runs against at least one temporary target repo without relying on fixed OS paths, sibling directory names, package-manager globals, or copied workflow source.
4. The config/state decision is settled: either no repo config is needed yet, or a minimal schema is documented with migration and compatibility tests.
5. The chosen local artifact/dogfood path is tested from caller-supplied temporary paths and its contents exclude operator-local state.
6. Enterprise distribution has a constraints matrix and either a supported no-source-copied artifact path with proof or an explicit defer/no-go decision.
7. Logging and dry-run/preview behavior are inventoried command-by-command before any enterprise safety claim is made.

## Links

- ADR 0037: AI Workflow Coordination Architecture — established the `workflow/` directory as the repo's coordination CLI
- ADR 0041: Integration-time pipeline gates — the `node workflow integrate` command that operates on target repos
- ADR 0042: Workflow CLI Color Rendering Approach — the `fmt.js` module that the new package will reorganize
- ADR 0043: Git target resolution strategy — shows the workflow already has repo-target reasoning, but only for the host repo
- backlog task-1229: Adopt an ADR and create missions for productification of workflow
