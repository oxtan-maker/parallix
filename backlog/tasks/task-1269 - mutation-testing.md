---
id: TASK-1269
title: mutation testing
status: backlog
assignee: []
created_date: '2026-06-09 04:25'
updated_date: '2026-06-26 18:00'
labels: []
dependencies: []
references:
  - lib/commands/coverage-gate.js
priority: low
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Add mutation testing to parallix to improve the testing harness
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Mutation testing runs scoped to the mission diff (changed files/functions), not the whole repo
- [ ] #2 Enforcement is a ratchet: a mission cannot lower the mutation score on the files it touches
- [ ] #3 Mutation testing placement in the lifecycle respects the TASK-1133 runtime budget (diff-scoped in-gate, or moved to pre-integrate/nightly with rationale)
- [ ] #4 Documents why line-coverage (current 90% gate) is insufficient and how mutation score complements it
- [ ] #5 A regression test demonstrates a surviving-mutant case failing the ratchet
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
