# CP-7 — Full verification

## Summary

Ran the mission-declared gate on the final tree and answered the Definition of
Done with per-criterion evidence. All success criteria SC01–SC14 are satisfied;
the mission gate passes.

**Verification runs**

- `git diff --check` — 0 output (SC12).
- `./scripts/verify-local.sh all` — PASS on the final tree (run for this
  checkpoint; the same gate also passed inside the CP-6 checkpoint run, unit
  suite elapsed 133.7s, under the 180s suite budget).

## Round 1 review fix (F1)

Reviewer finding F1 (blocking): the `stats` re-wiring to `withGraph`
(`src/composition/create-cli.ts`) made `px stats` run the preflight
mission-import gate on first service resolution, appending an
`import_history` row per source root — mutating the operator db that the
parent's read-only `px stats` never touched, and deterministically breaking
`test/package-persistent-data.test.ts` in the always-run `integration-suite`
pre-merge gate (`config/integration-pipelines.json`).

Fix (command-side, per the reviewer's direction): `withGraph` now accepts
the existing `ProductionApplicationServiceOptions`, and the `stats` command
passes `{ skipImportGate: true }`. Stats remains read-only with respect to
the operator db; the other `withGraph` commands (`integrate`, `review`,
`status`) are unchanged and still trigger the gate as before. Missions not
yet imported derive as no-review unknown — the parent behavior.

Verification:

- Empirical repro of the reviewer's protocol: seed-only fresh `PARALLIX_HOME`
  → `import_history` = 0; then `node build/px.mjs stats --today ...` from a
  worktree dir → `import_history` = 0 and db bytes unchanged.
- `test/package-persistent-data.test.ts` — green (was the deterministic
  pre-fix failure).
- `npm run test:integration` — 1508 tests, 0 fail.
- `./scripts/verify-local.sh all` — PASS (checkpoint gate).

## Definition of Done

| # | Criterion (falsifiable) | Evidence | Verdict |
|---|-------------------------|----------|---------|
| SC01 | Reproduction test red on parent, green on final | `test/task-2378-authoritative-stats.test.ts` — `"live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate"` and `"failed approval boundary transition surfaces and blocks Backlog promotion"` red at `BASELINE_SHA = 0938a9a59627d9810b78e5620a03de9357c2ffad` (CP-1), green on final tree (3/3 pass) | PASS |
| SC02 | No optional-store default in the four functions; omission throws | `src/adapters/cli/commands/stats.ts` (`loadMissionReview`, `deriveImplementerAndFixRounds`, `recordIntegrationStats` throw the invariant error naming the caller obligation), `src/adapters/cli/commands/integrate-post.ts` (`recordPostIntegrationStats`); `grep -rn "missing-authority" src/` → 0 consumers | PASS |
| SC03 | Production stats wiring derives authoritative values, no external lookup | `"live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate"` — seeds a misleading backlog task (`assignee: [codex]`, "Review round 7"), derives `source: 'review-aggregate'`, authoritative implementer, `prFixRounds: 2` through `createStatsWorkflowAdapter` | PASS |
| SC04 | Store present, Review absent → unknown, never fabricated zero | `src/adapters/cli/commands/stats.ts` (`deriveImplementerAndFixRounds` returns `{ implementer: 'unknown', prFixRounds: null }` when the store has no Review); `"R12: external artifacts with misleading values do not affect authoritative result"` in `test/task-2376-lifecycle-timing.test.ts` | PASS |
| SC05 | Boundary failure surfaces, Backlog NOT promoted, `px integrate` recovers | `"failed approval boundary transition surfaces and blocks Backlog promotion"` in `test/task-2378-authoritative-stats.test.ts` (command fails operator-visible, Backlog stays non-approved, Mission stays `review`, recovery via existing approve transition); `"R7: review without approval stops — Mission remains review"` and `"R9: normal integration state proceeds without rerunning approval"` in `test/integrate.test.ts` | PASS |
| SC06 | Every review-persistence call site classified; approval sites bound | CP-2 tables (verdict per site under `src/`); sole unbound approval path (`src/adapters/review/review-artifacts.ts` `consumeReviewerArtifacts` → `postWorkflowReview` forward) bound in CP-3; `src/composition/review-persistence.ts` wiring | PASS |
| SC07 | R5 regression: human approval persists `ReviewerDecision`, transition at `decidedAt`, no second approval | `"R5: human px review approval persists ReviewerDecision and lands integration at decidedAt without a second approval"` in `test/task-2378-authoritative-stats.test.ts` | PASS |
| SC08 | R13 updated in place: store omission throws, no lookup, no fabrication | `"R13: missing MissionStore cannot activate heuristic inference"` in `test/task-2376-lifecycle-timing.test.ts` (same file, same test name, new SC08 semantics) | PASS |
| SC09 | task-2376 regressions pass unchanged (R13 the only edit) | `test/task-2376-lifecycle-timing.test.ts` 11/11; `test/integrate.test.ts` 72/72 (incl. `"R4: stale active recovery chains submit-for-review then approve with original decidedAt"`) | PASS |
| SC10 | Canonical metrics unchanged | `"R10: first-pass approval yields known reviewFixRounds=0"`, `"R11: two request-changes cycles yield known reviewFixRounds=2"` in `test/task-2376-lifecycle-timing.test.ts`; `"R7/R8: PR-fix averages exclude unknown rounds and retain known zero"` in `test/task-2369-regressions.test.ts` (`[0, 2, unknown, unknown]` → n=2, average `1.00`) | PASS |
| SC11 | No new domain types / subsystems / dependencies | No new command types, no `Review` / `ReviewerDecision` shape changes, `package.json` unchanged (sole lockfile diff is pre-existing `pi-ai` bin-path drift from baseline); recovery still routes through `submit-for-review` / `approve` / `integrate`. **Corrected after this checkpoint:** commit `48aceda15` later narrowed one existing rule in `src/domain/mission-workflow.ts` (see `missions/task-2378/CP-8.md`); `src/domain/mission.ts` and `src/domain/review.ts` remain untouched | PASS |
| SC12 | `git diff --check` clean | `git diff --check` → 0 output on the final tree | PASS |
| SC13 | `./scripts/verify-local.sh all` passes | `./scripts/verify-local.sh all` → PASS (this checkpoint run; also PASS in the CP-6 checkpoint run) | PASS |
| SC14 | No `.only` / unannotated `.skip` introduced | `grep -n "\.only\|\.skip"` over the changed test files (`test/task-2378-authoritative-stats.test.ts`, `test/task-2376-lifecycle-timing.test.ts`, `test/stats.test.ts`, `test/task-1415-closed-mission-counts.test.ts`, `test/default-test-suite.test.ts`, `test/integrate.test.ts`) → 0 matches; test-hygiene stage of the gate passes | PASS |

**Restricted areas** — `src/domain/mission.ts`, `src/domain/review.ts`, and
`src/application/mission-lifecycle-service.ts` unchanged.
`src/domain/mission-workflow.ts` was unchanged as of this checkpoint; commit
`48aceda15` afterwards narrowed one existing rule in it, documented with its
justification in `missions/task-2378/CP-8.md`. `src/adapters/review/review-state.ts`
changed only to surface the boundary outcome; `src/adapters/review/review-commands.ts`
only for failure propagation and Backlog ordering.

**Branch hygiene** — all checkpoints are local-only commits on
`mission/task-2378`; nothing pushed to `origin` (local-only development rule).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `git diff --check` reports no errors on the final tree (SC12) | `git diff --check` → 0 output | PASS |
| Mission gate `./scripts/verify-local.sh all` passes (SC13) | `./scripts/verify-local.sh all` → PASS (unit suite under budget; integration suite green) | PASS |
| All success criteria SC01–SC14 evidenced | `test/task-2378-authoritative-stats.test.ts`, `test/task-2376-lifecycle-timing.test.ts`, `test/integrate.test.ts`, `test/task-2369-regressions.test.ts`, `./scripts/verify-local.sh all` | PASS |
| Reproduction test green on the final tree (SC01) | `test/task-2378-authoritative-stats.test.ts` — 3/3 pass | PASS |
| task-2376 regression set green on the final tree (SC09/SC10) | `test/task-2376-lifecycle-timing.test.ts` 11/11, `test/integrate.test.ts` 72/72, `test/task-2369-regressions.test.ts` `"R7/R8: PR-fix averages exclude unknown rounds and retain known zero"` | PASS |
| Restricted areas untouched as of this checkpoint | No `src/domain/*` or `src/application/mission-lifecycle-service.ts` changes at CP-7; the later `src/domain/mission-workflow.ts:114` edit is documented in `missions/task-2378/CP-8.md:40` | PASS |
| Round 1 finding F1 fixed: `px stats` stays read-only w.r.t. the operator db (no `import_history` write) | `test/package-persistent-data.test.ts`, "global tarball reinstall preserves PARALLIX_HOME measurements and agent blocklist" | PASS |
| No focused or unannotated skipped tests (SC14) | 0 matches for `.only` / `.skip` in `test/task-2378-authoritative-stats.test.ts`, `test/task-2376-lifecycle-timing.test.ts`, `test/integrate.test.ts`; test-hygiene stage of `./scripts/verify-local.sh all` clean | PASS |

Next action: superseded — the request-changes round-loop closure and round 1
findings F1–F5 landed after this checkpoint; continue at
`missions/task-2378/CP-8.md`, which is the mission's final evidence document.
