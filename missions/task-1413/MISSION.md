# Mission: Stale-generated-JS-masks-.ts-changes-across-branch-switches-runtime-dispatch-and-integration-gates (task-1413)

## Goal

Guarantee that compiled JavaScript artifacts (`lib/**/*.js`, `px.js`, `index.js`) always reflect the current TypeScript source before any runtime dispatch or integration gate exercises the CLI. Achieve this by (a) inserting a preflight freshness check into `index.ts` that validates `.ts` → `.js` parity at module-load time and fails fast with a clear `npm run build:cjs` instruction when artifacts are missing or stale, and (b) hardening the `workflow` integration gate and e2e harness to rebuild before exercising the CLI.

## Why Now

Two independent incidents have demonstrated the same underlying gap:

1. **Local runtime dispatch regression** — `node px.ts stats` produced tables inconsistent with the task-1409 fix even though `lib/commands/stats.ts` contained the correct logic. A stale `lib/commands/stats.js` survived in the working tree across branch switches (because `.js` is gitignored per `.gitignore:16-24`) and masked the current source. Running `npm run build:cjs` immediately restored expected output.

2. **`workflow` integration gate flakiness** — `config/integration-pipelines.json` defines the `workflow` gate as `node test/e2e-mission-lifecycle.test.js`, which invokes the compiled `px.js` CLI directly. The `pretest` npm script (`npm run build:cjs`) never fires for bare `node` invocations, so the gate can run against a stale build. This was reproduced on task-1411: the gate failed against a stale build and only passed after manually running `npm run build:cjs`.

Both incidents cause silent masking of real fixes/regressions in one direction, or false gate failures in the other.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Two confirmed production regressions (local dispatch + integration gate) trace to a single architectural gap; the fix is localized to `index.ts` dispatch logic and `test/e2e-mission-lifecycle.test.js` + `config/integration-pipelines.json`.

## Scope

- **`index.ts` dispatch path** (`index.ts:123-151`): Add a preflight freshness validator that runs before `requireFn(targetLib)` loads any command module. The validator compares the mtime (or hash) of every `.ts` source under `lib/commands/` and the root entrypoints `px.ts`/`index.ts` against their compiled `.js` siblings. On mismatch or absence, it prints a clear error including the `npm run build:cjs` instruction and exits non-zero (exit code 1).
- **`px.ts` `run()` function** (`px.ts:181-273`): Add equivalent preflight check before `_require('./lib/commands/mission-start.js')` and `_require('./index.js')` at lines 218-221. The check must cover the same file pairs.
- **`test/e2e-mission-lifecycle.test.js`**: Harden the e2e harness to run `npm run build:cjs` before spawning the CLI via `CLI_ENTRY` (currently at line 325). This ensures the workflow gate always exercises fresh artifacts.
- **`config/integration-pipelines.json`**: Optionally harden the `workflow` gate command to include `npm run build:cjs &&` before `node test/e2e-mission-lifecycle.test.js` as a defense-in-depth measure.
- **Freshness validator utility**: Extract the comparison logic into a reusable function (e.g., `lib/core/build-freshness.ts` or inline in `index.ts`) covering: root entrypoints (`px.ts`/`index.ts`) and all `lib/commands/*.ts` files.
- **Reproduction test**: Author a deterministic test that creates a controlled stale `.js` artifact, verifies the preflight check rejects it (red), then validates the fix passes (green).

## Out of Scope

- Changing the build system (`npm run build:cjs` command or `tsconfig.json` output paths).
- Modifying `.gitignore` to un-gitignore `.js` files (the fix must work with the existing gitignore strategy).
- Adding a watcher or hot-reload mechanism.
- Fixing stale `.js` artifacts that already exist on disk (the preflight check is preventive, not restorative).
- Changes to `lib/commands/*.ts` command implementations themselves.
- Mutation-gate or code-coverage gates (outside the stale-build scope).

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. **Preflight check in `index.ts`**: When a `.js` sibling is missing or has an older mtime than its `.ts` source, `node index.js <any-command>` exits with code 1 and prints a message containing `npm run build:cjs`. (Direct `node index.ts` execution does not fire the `require.main === module` bootstrap; the compiled `index.js` is the product entrypoint.) Verified by the reproduction test in `test/task-1413-stale-build.test.js` (red at parent commit, green after fix).

2. **Preflight check in `px.ts`**: `node px.js <any-command>` exhibits the same stale-build rejection behavior as `index.js`. Same reproduction test covers both entrypoints.

3. **Coverage scope**: The preflight validator checks at minimum: `px.ts`/`px.js`, `index.ts`/`index.js`, and every `lib/commands/*.ts`/`lib/commands/*.js` pair. Verified by test assertions covering all 20 command modules in `lib/commands/`.

4. **Workflow gate rebuild**: `test/e2e-mission-lifecycle.test.js` runs `npm run build:cjs` before spawning the CLI at line 325. Verified by reading the test source and confirming the build step precedes `spawnSync(process.execPath, [CLI_ENTRY, ...args], ...)`.

5. **E2E gate passes on clean tree**: After applying the fix, `node test/e2e-mission-lifecycle.test.js` passes all 6 scenarios (SC1-SC6) without manual pre-build. Verified by running the test against the fixed tree.

6. **No regression on fresh builds**: When `.js` artifacts are freshly built (mtime ≥ `.ts` source mtime), command dispatch proceeds normally with no error output. Verified by running `npm run build:cjs && node index.js status` and `node px.js version` succeeding with expected output.

7. **Static analysis clean**: `./scripts/verify-local.sh static-analysis` passes (ESLint + tsc typecheck + test-hygiene) on the final tree.

## Risks and Assumptions

- **Risk**: Adding synchronous file I/O (stat/hash) at module-load time adds latency to every CLI invocation. Mitigation: only compare mtimes (not full hashes); skip validation if `PARALLIX_SKIP_BUILD_CHECK=1` env var is set for CI/CI-like environments that control builds externally.
- **Risk**: Cross-device or network filesystems may have unreliable mtime. Assumption: all development work happens on local ext4/btrfs filesystems where mtime is reliable.
- **Assumption**: `npm run build:cjs` is always available and produces `.js` files co-located with `.ts` sources (as defined by the current `tsconfig.json` and `package.json` build script).
- **Assumption**: The `workflow` gate in `config/integration-pipelines.json` is the sole integration-time gate that exercises the CLI via bare `node` (not `npm test`). The `lib` gate uses `static-analysis` which does not execute the CLI.
- **Risk**: The preflight check must gracefully handle the case where `.ts` source exists but `.js` has never been built (first-time setup). In this case, the error must still be actionable.

## Checkpoints

- **CP 1 (Lock the bug)**: Author `test/task-1413-stale-build.test.js` that reproduces the stale `.js` masking scenario: creates a fake stale `lib/commands/stats.js` with older mtime than `lib/commands/stats.ts`, invokes `index.ts` dispatch, and asserts exit code 1 with `npm run build:cjs` in stderr. This test must fail (red) at the mission's parent commit and pass (green) after the fix.
- **CP 2 (index.ts preflight)**: Implement the freshness validator in `index.ts` before the `requireFn(targetLib)` call at line 145. Add unit-level assertions in the reproduction test that `node index.ts stats` fails with the expected error when `lib/commands/stats.js` is stale.
- **CP 3 (px.ts preflight)**: Mirror the freshness check in `px.ts` `run()` before the `_require` calls at lines 218-221. Extend the reproduction test to also cover `node px.ts stats`.
- **CP 4 (e2e harness hardening)**: Add `npm run build:cjs` step in `test/e2e-mission-lifecycle.test.js` before CLI spawning. Update `config/integration-pipelines.json` workflow gate command as defense-in-depth.
- **CP 5 (Gate pass)**: Run `./scripts/verify-local.sh all` (includes `npm test`). Confirm all 6 e2e scenarios pass. Confirm static analysis is clean.

## Gates

- [x] `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED (ESLint clean, tsc typecheck clean, test-hygiene clean)
- [x] `./scripts/verify-local.sh all` — 1992 pass, 0 fail, 22 skipped (on rebased tree)

## Restricted Areas

- **Do not modify** `lib/commands/*.ts` command implementations (stats, active, checkpoint, config, etc.). The fix is in dispatch plumbing only.
- **Do not modify** `tsconfig.json` or the `build:cjs` script in `package.json`.
- **Do not modify** `.gitignore` — the solution must work with `.js` remaining gitignored.
- **Do not modify** files under `lib/core/runtime-matrix.ts`, `lib/agents/`, `lib/tools/`, or `lib/review/` beyond what is strictly needed for the shared freshness validator.

## Stop Rules

- Stop if the preflight check introduces more than ~200 lines of new code (indicates over-engineering).
- Stop if `npm run build:cjs` itself fails on the target branch (blocker; escalate).
- Stop if the e2e test suite reveals a pre-existing flaky test unrelated to stale builds (do not conflate issues).
- Stop after CP 5 passes all gates — no additional hardening or polish beyond what the DOD requires.

Reproduction-Test: test/task-1413-stale-build.test.js
