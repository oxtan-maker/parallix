# Mission: Clean up tsc --checkJs type errors so the static-analysis gate passes stage 2 (task-1361)

## Goal

Eliminate all `tsc --checkJs --noEmit` type errors in the `lib/core` and `lib/commands` subsystems (and their transitive imports) so that `./scripts/verify-local.sh static-analysis` exits 0 with all three stages passing: ESLint, tsc, and test-hygiene.

## Why Now

TASK-1353 wired the static-analysis gate into `verify-local.sh` but it currently fails at stage 2 with ~2956 errors. TASK-1360 addresses the ESLint stage; until both are green, the full three-stage gate remains non-functional. This blocks TASK-1362 (integrating static-analysis as a required integration gate). The project has adopted `strict: true` + `checkJs: true` as a correctness baseline — leaving 1175 direct errors in the gate's included files violates that commitment.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: gate failure blocks integration pipeline; ~2956 errors across 37 files; no @types/node installed; zero JSDoc type annotations on public APIs

## Scope

### Directly in scope (tsconfig `include`)

- **lib/core/** (11 files): `fmt.js`, `git.js`, `gitignore.js`, `mission-utils.js`, `persistent-data-migration.js`, `product-config.js`, `runtime-matrix.js`, `spawn-tee.js`, `state-map.js`, `storage.js`, `verification.js`
- **lib/commands/** (19 files): `active.js`, `checkpoint.js`, `config.js`, `coverage-gate.js`, `diff.js`, `draft.js`, `handoff.js`, `integrate.js`, `mission-start.js`, `rebase.js`, `repair-handoff.js`, `resolve-conflict.js`, `review.js`, `setup-review.js`, `setup.js`, `stats-backfill.js`, `stats.js`, `status.js`, `verify.js`

### Transitively in scope (imported by the above)

- **lib/agents/** (6 files): `agents.js`, `claude.js`, `claude-telemetry.js`, `codex.js`, `codex-telemetry.js`, `limit-hit.js`, `mistral.js`, `opencode-export.js`, `opencode-telemetry.js`, `stage-telemetry.js`
- **lib/review/** (4 files): `rebase.js`, `review-adapter.js`, `review-artifacts.js`, `review-commands.js`, `review-events.js`, `review-loop.js`, `review-polling.js`, `review-prompts.js`, `review-state.js`
- **lib/tools/** (6 files): `backlog.js`, `forgejo.js`, `gatekeeper.js`, `sessions.js`, `setup-review.js`

### Fix strategies permitted

1. Install `@types/node` as a dev dependency (resolves TS2580 `process`/`Buffer` and TS2307 `fs`/`path`/`child_process` errors)
2. Add `@type` JSDoc annotations on function signatures, parameter destructuring, and return values
3. Fix actual type mismatches (wrong argument shapes, missing properties on objects)
4. Add `@type` cast comments for specific `unknown` catch blocks (TS18046)
5. Add `@satisfies` or explicit type narrowing where object shapes are dynamic

### Fix strategies forbidden

- Blanket `// @ts-nocheck` or `// @ts-ignore` on any file in `lib/core` or `lib/commands`
- Relaxing `strict`, `checkJs`, `allowJs`, `noEmit`, or the `include` globs in `tsconfig.json`
- Adding `"skipLibCheck": true` or `"suppressImplicitAnyIndexErrors": true`
- Removing files from gitignore to exclude them from the gate

## Out of Scope

- TASK-1362: Wiring static-analysis as a required gate in `config/integration-pipelines.json` (deferred until this task is green)
- ESLint cleanup (TASK-1360) — handled separately
- Converting `.js` files to `.ts` — the project uses JSDoc, not TSX migration
- Adding `@types/node` to published `files` in `package.json` — it stays as a dev dependency only
- Testing agent invocation at runtime (behavioral tests remain as-is)

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is objectively testable.

1. `npx tsc --checkJs --noEmit` exits with code 0 and reports zero errors (not zero warnings — zero errors)
2. `./scripts/verify-local.sh static-analysis` exits 0, printing `PASS` for all three stages: ESLint, tsc, test-hygiene
3. `tsconfig.json` retains all original settings: `strict: true`, `checkJs: true`, `allowJs: true`, `noEmit: true`, and `include` of `["lib/core/**/*.js", "lib/commands/**/*.js"]`
4. Zero `// @ts-nocheck` or `// @ts-ignore` directives exist in any file under `lib/core/` or `lib/commands/`
5. `npm test` passes with zero failures (current baseline: 1667 pass, 0 fail, 22 skipped)
6. `@types/node` is present in `package.json` `devDependencies` (if installed as the fix for TS2580/TS2307)

### Goal-Check Table

| # | Criterion | Verification Command | Current State | Target State |
|---|-----------|---------------------|---------------|--------------|
| 1 | tsc exits 0, 0 errors | `npx tsc --checkJs --noEmit 2>&1 | grep "error TS" | wc -l` | 0 |
| 2 | Full gate passes | `./scripts/verify-local.sh static-analysis` | Fails at stage 2 | All 3 stages PASS |
| 3 | tsconfig.json unchanged | `diff tsconfig.json.orig tsconfig.json` | N/A (baseline) | No diff |
| 4 | No @ts-nocheck/@ts-ignore in scope | `grep -rn '@ts-nocheck\|@ts-ignore' lib/core/ lib/commands/` | Unknown (likely none) | 0 matches |
| 5 | npm test passes | `npm test` | 1667 pass, 0 fail | 0 fail |
| 6 | @types/node in devDeps | `node -e "JSON.parse(require('fs').readFileSync('package.json')).devDependencies['@types/node']"` | Missing | Present |

## Risks and Assumptions

- **Risk:** ~2956 errors is large; some may be cascading from a single missing `@types/node` installation. Installing `@types/node` alone may eliminate 372 TS2580 + 101 TS2307 = 473 errors (~16%).
- **Risk:** `lib/commands/draft.js` (1003 lines) and `lib/commands/stats.js` (1685 lines) are the largest files and likely contain the most errors. They may need to be tackled first or in parallel subtasks.
- **Assumption:** JSDoc `@param` / `@returns` annotations are sufficient — no need to write separate `.d.ts` declaration files.
- **Assumption:** `require()` imports resolve correctly to their `.js` counterparts; no ES-module interop issues.
- **Risk:** Some `lib/agents/`, `lib/review/`, `lib/tools/` files are imported by scope files but have their own errors. Fixing them is necessary but they are not the primary target — their fixes should be minimal and focused on the types actually consumed by the importing scope files.
- **Assumption:** Existing behavioral tests (`npm test`) will continue to pass — type annotation changes are additive, not behavioral.

## Checkpoints

- **CP 1 — Foundation:** Install `@types/node` if absent, verify it reduces error count. Confirm baseline `npm test` passes.
- **CP 2 — lib/core clean:** All 11 files in `lib/core/` pass tsc individually (when checked with their imports resolved). Error count drops below 1500.
- **CP 3 — lib/commands clean:** All 19 files in `lib/commands/` pass tsc. Error count drops below 500.
- **CP 4 — Transitive clean:** Imported files in `lib/agents/`, `lib/review/`, `lib/tools/` that are reachable from scope files have zero remaining errors. Total error count = 0.
- **CP 5 — Gate verified:** `./scripts/verify-local.sh static-analysis` exits 0. `npm test` still passes.

## Gates

- [ ] `./scripts/verify-local.sh static-analysis` — all 3 stages must exit 0
- [ ] `npm test` — zero failures

## Restricted Areas

- Do NOT modify `tsconfig.json` compiler options or `include` arrays
- Do NOT modify `./scripts/verify-local.sh` gate logic
- Do NOT add `// @ts-nocheck` or `// @ts-ignore` to any file under `lib/core/` or `lib/commands/`
- Do NOT change the `strict`, `checkJs`, `allowJs`, or `noEmit` settings
- Do NOT modify files outside `lib/` except `package.json` (for `@types/node` addition)

## Stop Rules

- Stop and escalate if fixing type annotations requires changing function signatures that break `npm test` — revert and flag the affected function for manual review
- Stop if `@types/node` installation introduces conflicts with existing type definitions (unlikely but possible with NodeNext module resolution)
- Stop if any single file requires more than 50 unique JSDoc annotations — split that file's work into a separate task
- Stop if the gate becomes flaky (intermittent pass/fail) — investigate root cause before proceeding
