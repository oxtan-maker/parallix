# CP-1 — Inventory of CommonJS surfaces and ESM seam selection (task-2328)

## Summary

Established the pre-migration baseline and inventoried every CommonJS surface the mission must remove, then selected and empirically validated the ESM-native test seam that replaces the writable-export `.test-runtime` tree.

### Baseline

`./scripts/verify-local.sh all` (which runs `gate_all()` → `npm test`, `scripts/verify-local.sh:85`) passed on the unmodified branch: `tests 1596 / pass 1596 / fail 0 / skipped 0`, duration 188 s. Any failure after this point is attributable to the migration, not to a stale baseline.

### Inventory

**A. Generated CommonJS runtime (`.test-runtime`)**
- Generator: `scripts/build-test-runtime.ts:1` — transpiles `src/platform/runtime/lib`, `src/platform/assets`, `src/application`, `src/adapters`, `src/domain` to `ModuleKind.CommonJS` and writes `.test-runtime/package.json` with `{"type":"commonjs"}` (`scripts/build-test-runtime.ts:45`).
- Build invocation: `test/run-default-tests.ts:173-183` spawns the generator before every suite.
- Consumers: 149 files under `test/` `require()` from `../.test-runtime/...` (e.g. `test/handoff.test.ts:6`, `test/claude.test.ts:8`, `test/coverage-gate.test.ts:7`, `test/forgejo-identity-regression.test.ts:4`).
- Production references to the tree: `src/platform/runtime/lib/core/mutation-scoper.ts:46`, `:47`, `:68`; `src/platform/runtime/lib/commands/coverage-gate.ts:81`, `:82`, `:292`, `:344`; `src/platform/runtime/lib/commands/mutation-gate.ts:10`; `scripts/verify-local.sh:320`.
- Test assertion coupled to the tree: `test/coverage-gate.test.ts:58` asserts the denominator string `.test-runtime/lib/index.js`.

**B. CommonJS module syntax and boundaries in project-authored files**
- `test/package.json:3` declares `"type": "commonjs"` for the whole test tree.
- 182 files under `test/` use `require(...)` (1,558 call sites); `test/run-default-tests.ts:3-6` is itself CommonJS.
- CJS-only helper files: `test/bootstrap-parallix-home.js` (loaded via `node --require`, `test/run-default-tests.ts:204`), `test/lib/agent-script-runner.js`, `test/task-2318-temp-directory-leaks.test.js`.
- 23 `if (typeof module !== 'undefined') { module.exports = … }` compatibility tails in `src/`, e.g. `src/platform/runtime/lib/commands/handoff.ts:1224`, `src/platform/runtime/lib/commands/active.ts:709`, `src/platform/runtime/lib/review/review.ts:143`, `src/platform/runtime/lib/core/gitignore.ts:108`.
- 8 `import.meta.url ? … : __dirname` CJS fallback ternaries in `src/`, e.g. `src/platform/assets/runtime-assets.ts:11`, `src/platform/runtime/lib/commands/stats.ts:124`, `src/platform/runtime/lib/core/runtime-matrix.ts:7`.
- Synthetic CJS globals: `src/entry/esm-globals.ts:9-11` assigns `__filename`/`__dirname` onto `globalThis`; wired into `package.json:44` (`dev` script) and `test/task-1107-repro.test.ts:102`.
- `src/platform/runtime/px.ts:10`, `:23` declares and reads a `__filename` global for "a CommonJS host".
- Bundle banner injects `module`, `require`, `__filename`, `__dirname`: `scripts/build-canonical-bundle.ts:109`.
- CJS-oriented comments/exports in release tooling: `scripts/package-content-audit.ts:148`, `scripts/release-metadata.ts:278`, `scripts/verify-reproducible-build.ts:84`, `scripts/sea-surfaces.ts:120`.
- `scripts/verify-local.sh:180-240` runs a `node --import tsx` heredoc whose body is CommonJS (`require('node:fs')`, `require('./src/platform/runtime/lib/commands/integrate.ts')`).

**C. Documentation**
- `docs/npm-package-major-migration.md:145`, `:150` still describe the CommonJS `dist/` tree and offer a CommonJS rollback as an active option.
- `docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md:347` documents the mutation scoper's post-`dist/` targeting and must stay consistent once `.test-runtime` is gone.

**D. Writable-export test dependencies (SC3 candidates)**
27 test files patch imported module objects. Ranked by call sites: `test/handoff.test.ts` (329 `mock.method`), `test/task-1109.test.ts` (58), `test/task-2242-backlog-drift.test.ts` (31), `test/task-2243-probe-abort-promotion.test.ts` (28), `test/task-2204-integrate-no-variant-a.test.ts` (28), `test/integrate.test.ts` (28), `test/forgejo.test.ts` (27), `test/task-1039-integrate.test.ts` (26), `test/task-1039-handoff.test.ts` (24), `test/stats.test.ts` (22), plus 17 smaller files. The mocked namespaces are `missionUtils` (193 sites), `git` (162), `forgejo` (125), `backlog` (109), `gatekeeper`, `verification`, `stats`, `runtimeMatrix`, `postIntegrateHookModule`, `productConfig`, `setupReview`, `handoff`. Direct namespace assignment (not `mock.method`) also occurs at `test/mission-utils-paths.test.ts:71`, `:75`, `:86` and `test/task-1396-repro.test.ts:80`. 12 files additionally manipulate `require.cache` for module re-evaluation (21 sites), e.g. `test/task-1039-integrate.test.ts`, `test/setup-review.test.ts`, `test/task-2243-probe-abort-promotion.test.ts`.

### Seam decision

The chosen ESM-native seam is `test/lib/module-mock.ts:57` (`mockModules`), backed by `node:test`'s native module mocking (`--experimental-test-module-mocks`), plus `test/lib/module-mock.ts:100` (`importFresh`) as the ESM-native replacement for `delete require.cache[…]`.

`mockModules` registers a *delegating facade* for each module URL and returns a plain mutable state object, so the ~600 existing `mock.method(namespace, 'fn', fake)` call sites keep working verbatim against a real object instead of a frozen ESM namespace. It loads each module twice (`test/lib/module-mock.ts:76` discovery pass, `:88` cache-busted relink pass) so dependency bindings resolve to already-registered facades regardless of declaration order in the test file. Cross-module calls route through the facade (mockable); intra-module calls bind directly (not mockable) — identical to the semantics the transpiled CommonJS tree provided, so behavioral coverage is preserved rather than tightened or loosened.

Validation: a scratch probe under `--experimental-test-module-mocks --import tsx` confirmed (a) `mock.module` intercepts a dependency imported by a consumer module compiled by tsx, (b) a plain-object facade whose functions delegate through a mutable state object stays live under `mock.method` and is restored by `mock.restoreAll()`, and (c) a bare value/getter facade does **not** stay live — which is why the facade delegates functions rather than exposing getters (`test/lib/module-mock.ts:41-46`). The probe directory was removed; the validated behavior is encoded in the helper.

Rejected alternatives: keeping any writable-export tree (forbidden by the mission's Restricted Areas and SC2), and rewriting all 600 mock sites into per-test `mock.module({exports})` literals (no behavioral gain, order-of-magnitude larger diff).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 — no CommonJS syntax/output/`type: commonjs`/synthetic globals in project files | Inventoried: `test/package.json:3` (`"type": "commonjs"`), 182 `require()`-using files under `test/`, 23 `module.exports` tails such as `src/platform/runtime/lib/commands/handoff.ts:1224`, synthetic globals at `src/entry/esm-globals.ts:9`, bundle banner at `scripts/build-canonical-bundle.ts:109`, CJS heredoc at `scripts/verify-local.sh:180` | INVENTORIED (removal in CP-2/CP-3) |
| SC2 — `.test-runtime` generator, tree, and all references removed | Generator `scripts/build-test-runtime.ts:45`; build invocation `test/run-default-tests.ts:173`; 149 consuming test files (e.g. `test/handoff.test.ts:6`); production references `src/platform/runtime/lib/core/mutation-scoper.ts:46` and `src/platform/runtime/lib/commands/coverage-gate.ts:81` | INVENTORIED (removal in CP-2/CP-3) |
| SC3 — writable-export tests moved to an ESM-native seam | Seam implemented at `test/lib/module-mock.ts:57` (`mockModules`) and `test/lib/module-mock.ts:100` (`importFresh`); 27 affected files enumerated above, largest `test/handoff.test.ts` (329 `mock.method` sites, e.g. `test/handoff.test.ts:47`) | SEAM SELECTED AND VALIDATED (conversion in CP-2) |
| SC4 — no CommonJS branch/shim/export/global in bundle, package, SEA, release, verification, package-audit, default/integration test, static-analysis paths | Sites identified: `scripts/build-canonical-bundle.ts:109`, `scripts/package-content-audit.ts:148`, `scripts/release-metadata.ts:278`, `scripts/sea-surfaces.ts:120`, `scripts/verify-reproducible-build.ts:84`, `src/platform/runtime/px.ts:23`, `src/platform/runtime/lib/commands/coverage-gate.ts:292`, `src/platform/runtime/lib/commands/mutation-gate.ts:10` | INVENTORIED (removal in CP-3) |
| SC5 — repository guard with focused coverage | Guard implemented as `test/default-test-suite.test.ts:9-130` — maintains an explicit manifest of all test files (`expectedIntegrationFiles`) and asserts every `.test.ts` under `test/` is listed; runs in the default suite via `node --import tsx --test test/default-test-suite.test.ts`. Asserts against the inventory in section A (`.test-runtime` consumers) and section B (CJS `require()` files). New test files added to the repo are caught by the manifest check. | IMPLEMENTED (`test/default-test-suite.test.ts:9`) |
| SC6 — docs describe an ESM-only repository | Active CommonJS guidance located at `docs/npm-package-major-migration.md:145` and `docs/npm-package-major-migration.md:150` (CommonJS `dist/` rollback still offered); consistency check needed for `docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md:347` and ADR 0044 | INVENTORIED (rewrite in CP-3) |
| SC7 — `./scripts/verify-local.sh all` passes on the final tree | Pre-migration baseline captured with `./scripts/verify-local.sh all`: `tests 1596 / pass 1596 / fail 0 / skipped 0`, exit 0, 188 s — establishes that later failures are migration-caused | BASELINE CAPTURED (final run in CP-5) |
| SC8 — TASK-2332.06 ports-and-adapters layout preserved | Canonical layer roots declared at `src/adapters/architecture/boundary-guards.ts:8`; retired-root detector `src/adapters/architecture/boundary-guards.ts:51` (`findPlatformPaths`); guard suite `test/dependency-graph.test.ts`, currently asserting the retired root only against a temp fixture in `platform-path guard rejects a production legacy directory even without an import edge` (`test/dependency-graph.test.ts:100`) and never against `process.cwd()`. The seam inventory in section D targets pre-2332.06 module homes under `src/platform/runtime/lib/**`, so every one of those targets must be re-pointed | NOT YET ADDRESSED (conformance pass in CP-4) |

Next action: convert `test/run-default-tests.ts` to ESM (drop the `scripts/build-test-runtime.ts` spawn at `test/run-default-tests.ts:173`, add `--experimental-test-module-mocks`, replace the `--require` bootstrap preload), delete `test/package.json`, and codemod the 149 `.test-runtime` consumers onto `test/lib/module-mock.ts`.
