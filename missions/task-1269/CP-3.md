# CP-3: Mutation gate CLI

## Summary

Implemented `lib/commands/mutation-gate.ts`, mirroring `coverage-gate.ts`'s
shape (testable `run(args, options)` export, `exitFn` injection, CJS compat
block). Flags: `--dry-run`, `--base <branch>` (defaults to
`getPrimaryBranch()`), `--head <ref>` (defaults `HEAD`), `--baseline-path
<path>` (defaults `config/mutation-baseline.json`), `--threshold <pct>`
(defaults to no minimum — ratchet-only, per mission scope).

Pipeline:
1. `scopeMutationTargets(base, head)` (CP-2) → diff-scoped `targetFiles`.
2. `findTestFiles(targetFiles)` — matches `test/<basename>.test.js` per
   target file; falls back to the full `test/*.test.js` suite only if no
   exact matches exist. This keeps runs fast: mutating 2 real repo files
   (`lib/core/git.js`, `lib/core/mutation-scoper.js`) and running only their
   2 matched test files completed in ~27s end-to-end (well under the 60s/
   10-file budget), instead of the 115-file full suite.
3. Generates a per-run `stryker.conf.json` (`buildStrykerConfig`) reusing the
   CP-1 POC's proven shape: `testRunner: "command"`,
   `commandRunner.command: "node --test <matched test files>"`,
   `coverageAnalysis: "off"`, `mutate: <targetFiles>`.
4. Runs `node_modules/.bin/stryker run <configPath>` directly (not `npx` —
   `npx stryker` was found during POC work to sometimes resolve the
   deprecated, incompatible `stryker@1.x` package from npx's global cache
   instead of the locally installed `@stryker-mutator/core`; invoking the
   local bin avoids that ambiguity entirely).
5. Parses `reports/mutation/mutation.json` (`computeScoresFromReport`),
   scoring each file as `killed / (killed + survived + timeout)`.
6. Ratchet: for each target file with a `config/mutation-baseline.json`
   entry, reject (exit 1) if new score < baseline score. Files with no prior
   baseline entry pass automatically (see CP-4).
7. On success, writes updated per-file scores + ISO timestamp back to the
   baseline file and exits 0.

## Verification (real, non-dry-run)

- `node lib/commands/mutation-gate.js --dry-run --base main --head HEAD` →
  correctly reported the current mission diff's target set:
  `lib/core/git.js, lib/core/mutation-scoper.js` (git.js pulled in as a
  resolved callee of mutation-scoper.js), matched test files
  `test/git.test.js, test/mutation-scoper.test.js`, exit 0, **no Stryker
  process spawned**.
- Full run against `/tmp/test-baseline.json` (no prior entries): exit 0,
  `lib/core/git.js: 41.12`, `lib/core/mutation-scoper.js: 55.68` written to
  the baseline with `filePaths.<path>.score`/`.timestamp` schema.
- Ratchet-rejection check: seeded `lib/core/mutation-scoper.js` baseline
  entry at `score: 99`, re-ran → exit 1, stderr:
  `mutation-gate: ratchet FAILED — mutation score regressed on:
  lib/core/mutation-scoper.js: 55.68 < baseline 99`.

## Goal Check

| Success criterion | Evidence |
|---|---|
| `mutation-gate.ts` exists, typed, passes static-analysis | `lib/commands/mutation-gate.ts:1-297`; `./scripts/verify-local.sh static-analysis` → `ALL STAGES PASSED` (ESLint clean, tsc clean, test-hygiene clean) |
| `--dry-run` prints diff-scoped set, exits 0, no Stryker run | Manual run above; `lib/commands/mutation-gate.ts:201-210` (`dryRun` branch returns before any `spawnSyncFn` call) |
| Ratchet rejects a score regression, exit 1 | Manual run above; `lib/commands/mutation-gate.ts:253-263` (`regressions.length > 0` → `exitFn(1)`) |
| No-regression run exits 0 and writes baseline | Manual run above; `lib/commands/mutation-gate.ts:272-279` (`saveBaseline`) |
| Baseline schema `{ filePaths: { <path>: { score, timestamp } } }` | `/tmp/test-baseline.json` output matches exactly; `lib/commands/mutation-gate.ts:36-42` (`Baseline`/`BaselineEntry` interfaces) |
| Under 60s on a mission-diff-sized run | Manual `time` run: `real 0m26.671s` for 2 target files + 2 matched test files |

Next action: CP-4 — document and finalize the first-run/no-baseline
behavior already implemented here (files with no prior baseline entry pass
the ratchet automatically and seed the baseline), and record in the ADR why
this incremental-seeding approach was chosen over an eager full-`lib/` scan.
