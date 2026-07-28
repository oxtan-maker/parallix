# CP-2: Retire the Transitional CommonJS Implementation

## Summary

Removed the transitional CommonJS layer inventoried in CP-1 as one coherent change, and migrated the authored JavaScript that existed only to support it. All work landed in commit `5da463ed6`.

### Starting state

The branch arrived with CP-2 partially done and the suite non-functional. `test/source-runtime-alias.js` (the resolver shim mapping `../dist/` → `.test-runtime/`) had been deleted while 148 test files still imported `../dist/lib/...`, and the `dist/` emitter had been removed from the bundler. Every affected test failed with `MODULE_NOT_FOUND`. A `--no-gate` verification bypass plus `DEBUG` logging had been added to `forgejo.ts`/`rebase.ts`/`handoff.ts` to get past the publish gate; that code did not typecheck.

### Work done

**1. Test imports repointed (no shim).** Rewrote 148 test files from `../dist/lib/` to `../.test-runtime/lib/`, so no resolver hook is needed. Two files had no `.test-runtime` counterpart and now read source directly: `test/index.test.ts` (→ `src/platform/runtime/index.ts`) and `test/px-shell-init.test.ts` (→ `src/platform/runtime/px.ts`).

**2. Mutation scoper defect fixed.** `toRuntimePath()` mapped `src/platform/runtime/lib/foo.ts` → `.test-runtime/src/platform/runtime/lib/foo.js`, a path that never exists, so `isInScope()` dropped every changed source file and the diff-scoped mutation target set was silently always empty. It now strips the runtime-library source root and passes non-library paths through unchanged.

**3. Mutation and coverage gates repaired.** Both were invoked as bare `node` entry points against `.test-runtime/`. That tree is transpiled with `transpileModule`, which leaves `import.meta` intact, so both gates died with `SyntaxError: Cannot use 'import.meta' outside a module`. Both now run from TypeScript source through `tsx`. Entry detection matches the *invoked script name* rather than `import.meta.url` — inside the canonical bundle every inlined module reports the bundle's own URL, which made the gate execute on every `px` command (caught by `test/tui-spawn.test.ts` before commit).

**4. Authored JavaScript migrated to TypeScript.** Seven build scripts converted, including the native release archive packager; `scripts/package.json` (the `"type": "commonjs"` marker that existed only to keep them loadable) deleted; `tsconfig.scripts.json` added and wired into `npm run typecheck`. `test/run-default-tests.js` and `test/lib/agent-mock.js` converted. The two one-shot task-2224 migration tools (`annotate-test-errors.js`, `fix-remaining-test-errors.js`), referenced by no gate or script, were deleted.

**5. Deterministic-artifact gate restored.** `scripts/verify-reproducible-dist.js` had been deleted outright, removing the SC6 gate. Replaced with `scripts/verify-reproducible-build.ts`, targeting `build/` and comparing SHA-256 digests across two clean builds — the retired check compared file *names* only and would pass a build that embedded a timestamp.

**6. Stale `dist/` artifact assumptions removed.** Retargeted the rollback proof, shebang, TUI-spawn and real-agent-smoke assertions to `build/px.mjs`; deleted the two `tui-spawn` cases that silently returned early once `dist/` stopped existing (they had been "passing" in ~1 ms). `src/platform/runtime/lib/review/rebase.ts` resolved a packaged nested CLI at `../../px.js`; it now resolves `build/px.mjs`.

**7. Out-of-scope bypass reverted.** The `--no-gate` / `skipVerification` plumbing and `DEBUG` logging were reverted to `main`. Retiring `dist/` does not require weakening publish verification, and Restricted Areas forbids altering security controls in this mission.

### Remaining JavaScript exceptions (SC1)

| Path | Tool rationale |
|---|---|
| `eslint.config.mjs` | ESLint flat config; the tool loads it as JavaScript before any TS transform |
| `test/bootstrap-parallix-home.js` | `node --require` preload; runs before the tsx loader is registered |
| `test/lib/agent-script-runner.js` | Stable shebang executable spawned as a real subprocess by launcher tests |
| `scripts/stubs/react-devtools-core.mjs` | esbuild `alias` target; must be a resolvable JS module at bundle time |
| `proofs/task-2277-local-runtime/*.mjs` | Node module-customization loader hooks; loaded by the runtime's own resolver |
| `test/package.json` | `"type": "commonjs"` marker keeping `test/` CommonJS under an ESM root package |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: no authored runtime/test/build-tool JavaScript; remaining exceptions listed with tool rationale | `scripts/build-canonical-bundle.ts:1`, `scripts/build-sea.ts:1`, `scripts/package-native-release.ts:1`, `scripts/release-metadata.ts:1`, `scripts/package-content-audit.ts:1`, `scripts/build-test-runtime.ts:1`, `scripts/sea-surfaces.ts:1`, `test/run-default-tests.ts:1`, `test/lib/agent-mock.ts:1`; exceptions table above; typecheck extended via `package.json:50` and `tsconfig.scripts.json:12` | PASS |
| SC2: `dist/` emitter, package entry, compatibility re-exports, test shims and asset assumptions removed | `scripts/package-content-audit.ts:39` (`dist/` stays forbidden in published tarballs), `test/task-2279-assets-and-rollback-shim.test.ts:38` `"task-2288 build emits the canonical bundle as the sole executable package target"`, `test/tui-rollback-proof.test.ts:49` `"rollback-proof: canonical bundle includes TUI but keeps it off the headless startup path"` | PASS |
| SC2: no test shim remains; tests name their runtime directly | `test/run-default-tests.ts:202` (alias shim retired), `test/index.test.ts:17`, `test/px-shell-init.test.ts:18` | PASS |
| SC3: source, bundle, npm fallback, TUI, SQLite and CLI gates pass before deletion is accepted | `./scripts/verify-local.sh all` — exit 0, 1395 tests, 0 fail; `./scripts/verify-local.sh static-analysis` — all 4 stages PASS | PASS |
| SC5: mutation gate targets accepted source with no `dist/` assumption | `src/platform/runtime/lib/core/mutation-scoper.ts:58` (`RUNTIME_SOURCE_ROOT`), `test/mutation-scoper.test.ts:99` `"toRuntimePath maps runtime-library .ts to .test-runtime .js and passes through everything else"`, `scripts/verify-local.sh:323`; `./scripts/verify-local.sh mutation-gate --dry-run` resolves 23 targets and 19 matched test files | PASS |
| SC5: coverage gate targets accepted source with no `dist/` assumption | `src/platform/runtime/lib/commands/coverage-gate.ts:311`, `test/coverage-gate.test.ts` `"coverage-gate reports denominator and metric in output"` (asserts `.test-runtime/lib/index.js` denominator) | PASS |
| Gate entry points load under both module systems and do not fire from the bundle | `src/platform/runtime/lib/commands/mutation-gate.ts:320`, `src/platform/runtime/lib/commands/coverage-gate.ts:311`; `test/tui-spawn.test.ts` `"build/px.mjs status still exits 0 (headless path unchanged)"` | PASS |
| SC6: deterministic-artifact check exists and compares artifact bytes | `scripts/verify-reproducible-build.ts:32` (`artifactDifferences`), `test/task-2228-distribution-verification.test.ts:88` `"reproducible build check reports added, removed, and byte-changed artifacts"` | PASS |
| Formatter enforcement retargeted off the retired tree onto authoritative source | `test/fmt-enforcement.test.ts:40` `"no direct console.log/error calls in src/platform/runtime/lib/**/*.ts except fmt.ts"`, `test/fmt-enforcement.test.ts:50` `"no direct console.log/error calls in src/platform/runtime/index.ts"` | PASS |
| Shipped-artifact assertions name the canonical bundle, not `dist/` | `test/task-1390-shell-init-shebang.test.ts:30` `"build/px.mjs has shebang for direct execution (task-1390)"`, `src/platform/runtime/lib/review/rebase.ts:178` | PASS |
| SC8: rollback stays one coherent phase | The entire retirement is commit `5da463ed6`; reverting that single commit restores the emitter, entries, exports, test shims and assumptions together. `scripts/rollback-commonjs-package.js` and `test/task-2285-rollback.test.ts` were removed because they restored the CommonJS *package*, which no longer exists | PASS |
| Out-of-scope verification bypass removed | `src/platform/runtime/lib/tools/forgejo.ts`, `src/platform/runtime/lib/commands/rebase.ts`, `src/platform/runtime/lib/commands/handoff.ts`, `src/platform/runtime/lib/review/rebase.ts` reverted to `main`; `npm run typecheck` clean (it previously reported 2 errors in `forgejo.ts`) | PASS |

### Notes on baseline

`test/task-2286-native-sea-smoke.test.ts:386` and `test/task-2286-sea-stop-rules.test.ts:89` failed `tsc --project tsconfig.test.json` on `main` before this checkpoint (verified in the `/home/magnus/code/parallix` worktree at `8c0cb210b`). Both are fixed here so the mission's static-analysis gate is genuinely green rather than baseline-red.

The default suite reports a slightly different test count per run (1347–1397), with a different file's tests dropping each time. This variance reproduces on `main` (1396 then 1377 across two consecutive runs), so it is pre-existing harness behaviour under concurrency, not a regression from this checkpoint. Every run recorded here reports `fail 0` and exit 0.

Next action: Begin CP-3 — add dated reconciliation addenda to ADRs 0037, 0042, 0046 and 0049 (preserving their original decision records), and update `docs/authority-reference.md` and `docs/npm-package-major-migration.md` so the CLI, TUI, web board, task catalog, operator SQLite, repository state, assets, binary-first distribution and npm fallback are described consistently against `build/px.mjs`.
