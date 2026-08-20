# CP 7 — Review metric certification (R10–R13)

## Summary

Ran the certification suite proving that `reviewFixRounds` and implementer
attribution derive from the authoritative Review aggregate alone — known
zero, known nonzero, and unknown — while misleading external artifacts are
present and never consulted. No code changes were required: the semantics
were fixed by TASK-2376/2378 and the obsolete readers were deleted before
this mission (proven structurally in CP 2 and wiring-wise in CP 6).

### Certified semantics

- **Known zero (R10):** a first-pass approval yields `reviewFixRounds=0` as a
  *known* value from the Review aggregate — never conflated with unknown.
- **Known nonzero (R11):** two request-changes cycles yield a known
  `reviewFixRounds=2` counted from `reviewEvents`.
- **Unknown:** a Review with no fix-round signal (no events, no decisions)
  yields `prFixRounds=null` — the measurement contract's unknown, never a
  fabricated zero (task-2347.10 certification).
- **Missing authority (R13):** without a MissionStore the derivation throws
  the invariant error before any lookup — no PR lookup, no branch history, no
  task-text lookup, no fabricated value.
- **Misleading artifacts present, never consulted (R12):** with a backlog
  task claiming `assignee: [codex]` and "Review round 5" and a real git
  history on disk, the result is the Review aggregate's own values
  (`implementer=terra`, `prFixRounds=1`). The PR-comment / branch-history /
  review-state-history / task-text readers that could have consulted those
  artifacts no longer exist (CP 2 inventory; repo-wide search: zero
  production definitions or callers).

### Result

All 31 certification tests across the five suites pass (run command in the
Goal Check below), including R10–R13 themselves.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Known zero derives from the Review aggregate (R10) | `test/task-2376-lifecycle-timing.test.ts` "R10: first-pass approval yields known reviewFixRounds=0"; `test/task-2347.10-repro.test.ts` "deriveImplementerAndFixRounds returns 0 for approved-first-time mission (task-2347.10)" — both pass | PASS |
| Known nonzero derives from the Review aggregate (R11) | `test/task-2376-lifecycle-timing.test.ts` "R11: two request-changes cycles yield known reviewFixRounds=2"; `test/task-2347.10-repro.test.ts` "deriveImplementerAndFixRounds counts two fix rounds from reviewEvents (task-2347.10)" — both pass | PASS |
| Unknown stays unknown — never a fabricated zero | `test/task-2347.10-repro.test.ts` "deriveImplementerAndFixRounds returns unknown when no reviewEvents and no decision (task-2347.10)" (`prFixRounds === null`); `test/task-2369-regressions.test.ts` R5/R6 known-zero-vs-unknown guards — pass under `npm test` | PASS |
| Misleading external artifacts present and never consulted (R12) | `test/task-2376-lifecycle-timing.test.ts` "R12: external artifacts with misleading values do not affect authoritative result" — passes; misleading backlog (`codex`, "Review round 5") and git history seeded, Review aggregate values win; CP-2 inventory proves the four inference readers are absent | PASS |
| Missing authority cannot activate inference (R13) | `test/task-2376-lifecycle-timing.test.ts` "R13: missing MissionStore cannot activate heuristic inference" — passes: invariant error thrown before any lookup | PASS |
| Live adapter path certified | `test/task-2378-authoritative-stats.test.ts` "live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate" — passes | PASS |
| Full verifier still green | `npm test` → 1938/1938 pass (committed CP-6 tree); `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED | PASS |

Next action: CP 8 — Lifecycle statistics proof (Part M): run the persisted projection of the 10:00/10:30/14:00/14:15 fixture and assert review dwell = 30m, integration dwell = 225m, with the surrounding R1/R2/R3/R8 timing and completion semantics certified alongside.
