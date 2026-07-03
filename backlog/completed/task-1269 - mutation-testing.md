---
id: TASK-1269
title: mutation testing
status: done
assignee: [claude]
created_date: '2026-06-09 04:25'
updated_date: '2026-07-02 18:24'
labels:
  - user_value
dependencies: []
references:
  - lib/commands/coverage-gate.js
priority: low
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add mutation testing to parallix to improve the testing harness. I.e. not when parallix is used to develop some other repo, but mutation testing on the test for parallix testing itself.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Mutation testing runs scoped to the mission diff (changed files/functions), not the whole repo
- [x] #2 Enforcement is a ratchet: a mission cannot lower the mutation score on the files it touches
- [x] #3 Mutation testing placement in the lifecycle respects the TASK-1133 runtime budget (diff-scoped in-gate, or moved to pre-integrate/nightly with rationale)
- [x] #4 Documents why line-coverage (current 90% gate) is insufficient and how mutation score complements it
- [x] #5 A regression test demonstrates a surviving-mutant case failing the ratchet
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Bug-reduction analysis (initiative #4). The motivation is concrete: the current coverage gate enforces 90% LINE coverage (lib/commands/coverage-gate.js), but line coverage is the weakest possible signal — current research shows AI-generated test suites reach only ~20% mutation score, i.e. ~80% of injected bugs survive despite high line coverage (arxiv 2510.09907; earezki.com "Tests Are Everything in Agentic AI"). High velocity + line-coverage-only = "tests pass but validate nothing."

Recommended shape:
- Add StrykerJS (or equivalent) mutation testing, but SCOPE it to the mission diff (changed files/functions), not the whole repo — full-suite mutation testing is far too slow for the TASK-1133 sub-30s gate budget.
- Enforce as a RATCHET, not an absolute threshold: a mission may not LOWER the mutation score on the files it touches. This avoids forcing a big-bang backfill and keeps it diff-local.
- Consider running it post-review / pre-integrate rather than in the hot checkpoint loop if runtime is still too high.
- Strong pairing with TASK-1354 (regression-test-first): mutation score is what stops a "reproduction" test from being a trivially-passing shallow test.

Estimated 15-20% reduction on the weak-test / regression cluster.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Implemented diff-scoped mutation testing with ratchet enforcement, mirroring coverage-gate.ts's shape:

- lib/core/mutation-scoper.ts: computes changed files (base...head) mapped from tracked .ts to runtime .js paths, plus their transitive local require()/import callees (regex-based, not full TS compiler services per the mission's stop rule).
- lib/commands/mutation-gate.ts: runs StrykerJS (@stryker-mutator/core, added as devDependency) via its `command` test runner against `node --test`, matching test files by naming convention to keep runs fast (~27s for a 2-file diff, well under the 60s budget). Enforces a ratchet against config/mutation-baseline.json (schema: filePaths.<path>.{score,timestamp}) — a mission may not lower a touched file's mutation score. --dry-run, --base/--head, --baseline-path, --threshold flags. Baseline seeds incrementally per file on first touch (documented deviation from CP-4's literal "all lib/ files" wording, which conflicted with the mission's own full-repo-mutation out-of-scope declaration).
- Found and fixed a real bug during the CP-5 regression test: nested `node --test` under Stryker's command runner inherited NODE_TEST_CONTEXT from the parent test process, silently making every mutant look "Survived". Fixed the same way coverage-gate.ts already guards against it (strip NODE_TEST_CONTEXT/NODE_OPTIONS from the child env).
- test/mutation-gate-ratchet.test.js: real end-to-end regression test — strong test scores 100 and seeds the baseline, then a shallow/weak test (the exact "AI-generated shallow test" pattern this mission targets) regresses the score and the ratchet rejects it with exit 1.
- docs/adr/adr-mutation-testing.md: line-coverage-vs-mutation-score rationale (cites arxiv 2510.09907), lifecycle placement (pre-integrate, not per-checkpoint, per TASK-1133's budget), and all design tradeoffs above.
- scripts/verify-local.sh mutation-gate subcommand + config/integration-pipelines.json `mutation` gate at order 40. Documented limitation: it doesn't yet auto-fire via integrate.ts's changed-area matcher (mutation isn't a recognized area) because this mission's Restricted Areas forbid touching integrate.ts — it's runnable standalone today, and wiring it into the automatic pipeline is a natural follow-up.

All coverage-gate.ts, verification.ts, integrate.ts, test/ structure, prompts/, AGENTS.md, and doc-standards.md were left untouched per Restricted Areas. Full test suite (1824 tests) and static-analysis/docs gates pass.
<!-- SECTION:FINAL_SUMMARY:END -->
