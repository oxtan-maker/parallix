# CP-5: Final verification

## Summary

Ran the full mission verification set against the fixed tree:

1. Mission regression test:
   `node --require ./test/bootstrap-parallix-home.js --test test/task-1424-post-integrate-publish-reinstall.test.js`
   → 1 pass, 0 fail.
2. Directly affected packaging/self-update tests:
   `test/package-persistent-data.test.js`, `test/refresh-global-px-script.test.js`,
   `test/task-1417-stale-publish-build-check.test.js` → all pass.
3. `./scripts/verify-local.sh static-analysis` → ESLint clean, tsc typecheck
   clean, test-hygiene clean.
4. `./scripts/verify-local.sh all` (full `npm test` suite) → 2032 tests run,
   2010 pass, 0 fail, 22 skipped (pre-existing, none introduced by this
   mission — no `.only`/bare `.skip` added).
5. Manually confirmed no stray `.tgz` remains in the repo root (`ls *.tgz`
   returns "No such file").

## Root cause and fix (recap)

`npm pack`/`npm install -g` extraction assigns each file its own
extraction-time mtime in directory-sorted order. Since `<name>.ts` always
sorts after `<name>.js` for every guarded pair under `lib/commands/`, every
installed pair looked stale to `lib/core/build-freshness.ts`'s mtime
comparison regardless of actual build freshness — a deterministic false
positive on every fresh install, exactly matching the backlog report. Fixed by
excluding `.ts` sources under `lib/` from the published npm package
(`package.json`'s `files` array, `!lib/**/*.ts`), since the compiled `.js` is
already canonical for installed packages. This removes the comparison targets
entirely for installed packages while leaving the checkout-side guard
(`npm run prepack`/`publish:guard`, used by `px integrate`'s verification
capture) unchanged, so a genuinely stale checkout still fails closed before
it is ever packed. Also added trap-based tarball cleanup to
`scripts/refresh-global-px.sh` so the pack artifact is removed on both success
and failure paths.

## Goal Check

| Goal Check | Evidence | Status |
|---|---|---|
| Regression test fails on parent commit, models real packaged-runtime scenario, passes after fix | Test file `test/task-1424-post-integrate-publish-reinstall.test.js` (packs and installs a real tarball, runs the installed package's own `lib/core/build-freshness.js` against its own installed tree). Pre-fix run failed with `[parallix] Stale build detected...` for all `lib/commands/*.js`/`.ts` pairs (see CP-1.md). Post-fix run: `node --require ./test/bootstrap-parallix-home.js --test test/task-1424-post-integrate-publish-reinstall.test.js` → `installed tarball runtime does not trip the stale-build guard on a fresh, correctly-built checkout` passes | PASS |
| No ad hoc `utimes`/touch repair needed for packaged install | `test/package-persistent-data.test.js:65-71` — old `fs.utimesSync` repair block removed and replaced with negative-control assertion (`assert.ok(!entry.endsWith('.ts'), ...)`) over the installed `lib/commands/` directory; test `global tarball reinstall preserves PARALLIX_HOME stats and agent blocklist` passes | PASS |
| Shipped runtime freshness behavior deterministic for guarded surfaces (`px.ts`/`px.js`, `index.ts`/`index.js`, `lib/commands/*.ts`/`.js`), narrowed only with documented rationale | `lib/core/build-freshness.ts:88-99` (docstring documents the packaged-runtime narrowing rationale); `package.json:45` (`"!lib/**/*.ts"` files exclusion); `docs/authority-reference.md:349-357` (operator-facing rationale); checkout-side comparison logic in `findStaleBuildArtifacts` at `lib/core/build-freshness.ts:32-51` is unchanged — test names `prepublishOnly fails closed when a guarded compiled file is stale` and `prepublishOnly still passes when guarded compiled files are fresh` in `test/task-1417-stale-publish-build-check.test.js` still pass | PASS |
| `scripts/refresh-global-px.sh` completes pack/install without leaving the tarball, cleans up on failure too | `scripts/refresh-global-px.sh:34` (`trap 'rm -f "${TARBALL}"' EXIT`); test name `scripts/refresh-global-px.sh cleans up the packed tarball on both success and failure` in `test/refresh-global-px-script.test.js:44-48` passes; manual check `ls *.tgz` in repo root returns "No such file or directory" | PASS |
| Self-update path still wired to real product flow (version bump, packaging, reinstall) | Test names `workflow.config.json wires the generic post-integrate hook to the checked-in script` and `scripts/refresh-global-px.sh bumps the patch version and reinstalls from a packed tarball of this checkout` in `test/refresh-global-px-script.test.js` pass; `workflow.config.json`'s `adapters.integrate.postIntegrateCommand` still points to `./scripts/refresh-global-px.sh` | PASS |
| `./scripts/verify-local.sh static-analysis` passes | Command `./scripts/verify-local.sh static-analysis` run directly, output ends `=== Static Analysis Gate: ALL STAGES PASSED ===` (ESLint clean, tsc typecheck clean, test-hygiene clean) | PASS |
| `./scripts/verify-local.sh all` passes | Command `./scripts/verify-local.sh all` run directly, final `node:test` summary: `tests 2032`, `pass 2010`, `fail 0`, `skipped 22` (pre-existing skips, none added by this mission) | PASS |

Next action: Hand off for review — all mission gates pass, all three checkpoint-declared regression/support tests are green, docs and self-update script are updated, and no stray tarball or workaround remains.
