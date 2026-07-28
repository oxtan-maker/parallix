# CP-1: Transition Inventory and Dependency-Proof Record

## Summary

Created the complete inventory of every transitional CommonJS mechanism and its replacement proof. The repository's current state after TASK-2284/2285/2287 is:

- **Primary runtime:** `build/px.mjs` (canonical ESM bundle) — `package.json:37` bin entry
- **Rollback artifact:** `dist/` (CommonJS tree) emitted by `scripts/build-canonical-bundle.js`
- **Test runtime:** `.test-runtime/` (CommonJS modules) emitted by `scripts/build-test-runtime.ts`
- **Compatibility shim:** `test/source-runtime-alias.js` maps `../dist/` imports to `.test-runtime/`

### Inventory

#### 1. dist/ Emitter (CommonJS Rollback Tree)

| Item | Path | Lines | Replacement | Proof |
|------|------|-------|-------------|-------|
| `emitCommonJsTree()` | `scripts/build-canonical-bundle.js` | ~195-210 | Retired — `build/px.mjs` is sole production artifact | `package.json:37` bin=`build/px.mjs`; `scripts/package-content-audit.js:40` forbids `dist/` in published package |
| `emitEsmTree()` | `scripts/build-canonical-bundle.js` | ~212-240 | Retired — TUI/adapters inlined in bundle | `build/px.mjs` inlines all first-party code |
| `dist/` staging + swap | `scripts/build-canonical-bundle.js` | ~242-252 | Retired | `scripts/package-content-audit.js:40` forbids `dist/` in published package |
| Rollback script | `scripts/rollback-commonjs-package.js` | all | Retained for documentation — references `dist/` as rollback concept | `docs/npm-package-major-migration.md` §Rollback describes `dist/` rollback |

#### 2. Package Entry (package.json)

| Item | Path | Current State | Target State |
|------|------|---------------|--------------|
| `type` | `package.json:7` | `"module"` | `"module"` (no change) |
| `bin.px` | `package.json:37` | `build/px.mjs` | `build/px.mjs` (no change) |
| `main` | `package.json` | absent | absent (no change) |
| `exports` | `package.json` | absent | absent (no change) |
| `files` | `package.json:36` | `build/` + metadata | `build/` + metadata (no change) |

**Conclusion:** `package.json` is already in the final ESM-only shape (TASK-2285). No changes needed.

#### 3. Compatibility Re-exports / Shims

| Item | Path | Purpose | Replacement | Proof |
|------|------|---------|-------------|-------|
| `source-runtime-alias.js` | `test/source-runtime-alias.js` | Maps `../dist/index` → `src/platform/runtime/index` and `../dist/lib/` → `.test-runtime/lib/` | Remove after test migration to `.ts` with direct `src/` imports | `.test-runtime/` provides CommonJS modules for `node:test` mocks |

#### 4. Authored JavaScript — Test Files (to migrate to `.ts`)

| File | dist/ imports | Migration |
|------|---------------|-----------|
| `test/forgejo-pr-round-sync.test.js` | 13× `../dist/lib/review/review` | → `.ts`, imports from `src/` |
| `test/task-2239-rereview-after-response.test.js` | `../dist/lib/review/review` | → `.ts`, imports from `src/` |
| `test/task-2243-probe-abort-promotion.test.js` | `../dist/lib/core/git`, `mission-utils`, `backlog`, `forgejo`, `stats`, `integrate` | → `.ts`, imports from `src/` |
| `test/task-2270-graphify-exclusion.test.js` | none | → `.ts` (no dist/ imports to change) |
| `test/task-2297-graphify-codex-repro.test.js` | `../dist/lib/core/mission-utils`, `../dist/lib/agents/codex` | → `.ts`, imports from `src/` |

#### 5. Authored JavaScript — Non-Test Files (tool-required exceptions)

| File | Tool Rationale |
|------|----------------|
| `test/bootstrap-parallix-home.js` | Test bootstrap preload (`--require`) for HOME isolation and network shims |
| `test/run-default-tests.js` | Test runner orchestration (build, test-runtime, discovery, spawn) |
| `test/lib/agent-mock.js` | Mock launcher helper for test fixtures |
| `test/lib/agent-script-runner.js` | Stable executable symlink target for launcher safety net |

#### 6. Authored JavaScript — Build/Tool Scripts (to migrate to TypeScript)

| File | Purpose |
|------|---------|
| `scripts/build-canonical-bundle.js` | Canonical ESM bundle builder (dist/ emitter removed) |
| `scripts/build-sea.js` | Native single-executable builder |
| `scripts/build-test-runtime.ts` | `.test-runtime/` CommonJS emitter |
| `scripts/package-native-release.ts` | Native release archive packager and evidence writer |
| `scripts/package-content-audit.js` | Published package content verification |
| `scripts/release-metadata.js` | NOTICES/SBOM/manifest generation |
| `scripts/verify-reproducible-dist.js` | Reproducible dist/ check (retired — dist/ removed) |
| `scripts/annotate-test-errors.js` | Test type-error annotation tool |
| `scripts/fix-remaining-test-errors.js` | Test type-error fix tool |
| `scripts/rollback-commonjs-package.js` | Rollback manifest generator |

#### 7. Coverage Gate dist/ References

| Item | Path | Lines | Change |
|------|------|-------|--------|
| JSDoc usage line | `src/platform/runtime/lib/commands/coverage-gate.ts` | 8 | Update to `.test-runtime/` |
| `COVERAGE_INCLUDES` | `src/platform/runtime/lib/commands/coverage-gate.ts` | 81-82 | `dist/index.js` → `.test-runtime/lib/index.js`; `dist/lib/**/*.js` → `.test-runtime/lib/**/*.js` |
| DRY-RUN log | `src/platform/runtime/lib/commands/coverage-gate.ts` | 292, 335 | Update denominator text |
| package.json script | `package.json:51` | — | `dist/lib/commands/coverage-gate.js` → `.test-runtime/lib/commands/coverage-gate.js` |

#### 8. Mutation Scoper/Gate dist/ References

| Item | Path | Lines | Change |
|------|------|-------|--------|
| JSDoc scope | `src/platform/runtime/lib/core/mutation-scoper.ts` | 11 | Update to `.test-runtime/` |
| `isInScope()` | `src/platform/runtime/lib/core/mutation-scoper.ts` | 46-47 | `dist/index.js` → `.test-runtime/lib/index.js`; `dist/lib/` → `.test-runtime/lib/` |
| `toRuntimePath()` | `src/platform/runtime/lib/core/mutation-scoper.ts` | 57 | `dist/` prefix → `.test-runtime/` prefix |
| JSDoc usage | `src/platform/runtime/lib/commands/mutation-gate.ts` | 10 | Update to `.test-runtime/` |
| verify-local.sh | `scripts/verify-local.sh` | 320 | `dist/lib/commands/mutation-gate.js` → `.test-runtime/lib/commands/mutation-gate.js` |

#### 9. Reproducible dist/ Check

| Item | Path | Change |
|------|------|--------|
| `scripts/verify-reproducible-dist.js` | all | Retire — `dist/` no longer emitted |
| `package.json` script `test:reproducible-output` | `package.json:52` | Retire |

#### 10. Documentation Reconciliation (ADR targets for CP-3)

| Document | Current dist/ References | Target |
|----------|-------------------------|--------|
| `docs/adr/0037-ai-workflow-coordination-architecture.md` | `workflow/index.js`, `workflow/lib/*.js` | Add reconciliation addendum noting `dist/` retired |
| `docs/adr/0042-workflow-cli-color-rendering-approach.md` | `workflow/lib/fmt.js` | Add reconciliation addendum |
| `docs/adr/0044-workflow-distribution-model.md` | `dist/` runtime, CommonJS compatibility | Add reconciliation addendum |
| `docs/adr/0046-npm-publish-process-and-security.md` | `dist/` in package context | Add reconciliation addendum |
| `docs/adr/0049-diff-scoped-mutation-testing-with-ratchet-enforcement.md` | `dist/` runtime, `build:cjs`, `dist/index.js` | Update 2026-07-18 correction addendum |
| `docs/authority-reference.md` | `index.js`/`px.js`/`lib/` entry points, `dist/px.js` | Update to `build/px.mjs` |
| `docs/npm-package-major-migration.md` | `dist/` rollback, `dist/px.js` | Update rollback section |

#### 11. Asset/Package-Root Assumptions

| Item | Path | Current | Target |
|------|------|---------|--------|
| Package content audit `FORBIDDEN_PREFIXES` | `scripts/package-content-audit.js:40` | `'dist/'` in forbidden list | Retain (dist/ still forbidden in published package) |
| `.gitignore` | `.gitignore:19` | `dist/` excluded | Retain |
| `.npmignore` | `.npmignore` | No explicit `dist/` line | No change (covered by `files` allowlist) |

### Replacement-Gate Evidence

Each removal group has recorded replacement evidence from TASK-2284, TASK-2285, or TASK-2287:

| Mechanism | Dependency | Proof File |
|-----------|-----------|------------|
| `dist/` emitter retired | TASK-2285 | `test/task-2285-pack-install-smoke.test.ts` — ESM bundle pack/install smoke |
| `dist/` emitter retired | TASK-2285 | `test/task-2285-release-metadata.test.ts` — release metadata from bundle |
| Rollback artifact | TASK-2285 | `test/task-2285-rollback.test.ts` — rollback assembly and execution |
| Binary distribution | TASK-2286 | `test/task-2286-native-sea-smoke.test.ts` — native SEA smoke |
| Source authority | TASK-2284 | `test/task-2284-catalog-round-trip.test.ts` — catalog round-trip |
| CLI compatibility | TASK-2285 | `scripts/package-content-audit.js` — published package content audit |
| Test runtime | TASK-2285 | `scripts/build-test-runtime.ts` — `.test-runtime/` CommonJS emitter |
| Clean checkout | TASK-2285 | `scripts/verify-reproducible-build.ts` — reproducible build artifact comparison |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Transition inventory records every dist/ emitter, package entry, compatibility re-export, test shim, authored JS file, and asset/package-root assumption | `scripts/build-canonical-bundle.js:195-252` (emitCommonJsTree, emitEsmTree, dist/ swap); `test/source-runtime-alias.js:1-19` (compatibility shim); `test/forgejo-pr-round-sync.test.js` through `test/task-2297-graphify-codex-repro.test.js` (5 authored JS test files); `scripts/package-content-audit.js:40` (asset assumptions) | PASS |
| Each mechanism has a recorded replacement and the exact gate that proves it | `test/task-2285-pack-install-smoke.test.ts`, `test/task-2285-rollback.test.ts`, `test/task-2286-native-sea-smoke.test.ts`, `test/task-2284-catalog-round-trip.test.ts` | PASS |
| Authored JS exceptions are listed with path and tool rationale | `test/bootstrap-parallix-home.js:1` (test bootstrap preload, `--require` target per `test/run-default-tests.js:196`), `test/run-default-tests.js:1` (test runner per `package.json:47`), `test/lib/agent-mock.js:1` (mock helper imported in `test/task-1036-review-fallback.test.ts`), `test/lib/agent-script-runner.js:1` (stable executable with shebang, used in `test/agents.test.ts`) | PASS |
| Coverage/mutation dist/ references inventoried | `src/platform/runtime/lib/commands/coverage-gate.ts:81-82` (COVERAGE_INCLUDES), `src/platform/runtime/lib/core/mutation-scoper.ts:46-47` (isInScope), `scripts/verify-local.sh:320` (mutation-gate invocation) | PASS |
| ADR reconciliation targets identified | ADR 0037, ADR 0042, ADR 0044, ADR 0046, ADR 0049 | PASS |
| Rollback phase documented as single coherent unit | `scripts/rollback-commonjs-package.js` — emitter, entries, exports, test shims, and assumptions restored together; `test/task-2285-rollback.test.ts` exercises full rollback | PASS |

Next action: Begin CP-2 — retire the transitional implementation: remove dist/ emitter from build-canonical-bundle.js, migrate 5 JS test files to TypeScript, convert build scripts to ESM, update coverage/mutation targets to .test-runtime/, and remove source-runtime-alias.js shim.
