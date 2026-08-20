# CP 9 — Contradiction + dead-code sweep

## Summary

Searched and classified every pattern in the backlog's contradiction list
over the committed tree, deleted the remaining orphans, and confirmed the
final semantics. The sweep is repo-wide over `src/` (and `test/` for orphan
references); every hit is either zero or classified below.

## Sweep results

| Pattern | Result | Classification |
|---|---|---|
| `requireStatus(mission, ['review', 'integration'` | zero hits of the old integrate preflight form | gone; `requireStatus` survives only in `src/domain/mission-workflow.ts` as the domain state-machine guards (e.g. `['backlog', 'refined', 'active']` → active), which is its rightful home |
| the three transition commands in integrate.ts | `type: 'override'`: zero. Direct `type: 'integrate'` status stamps: zero. `type: 'approve'`: two hits — `recordHumanOverrideDecision` persists the explicit human override as a genuine `ReviewerDecision` through the Review domain (line 923), and recovery's approve transition runs at `reviewRound.decision.decidedAt` (line 1025) | exactly the Part E/Part F semantics: approve exists only as a Review-authoritative transition, never a status stamp; completion flows through `MissionIntegrationService.decideIntegration` |
| `decidedAt` in integrate.ts | four hits, all approval-derived: `overrideApprovedAt` (the provider approval's own timestamp) and `reviewRound.decision.decidedAt` (transition stamp + idempotency key + recovery return) | no fabricated timestamps in the integrate path |
| `new Date().toISOString()` in integrate.ts | zero hits | the override no longer stamps itself; it carries the approval's `submitted_at` |
| fabricated `decidedAt:` stamps elsewhere in src | three sites classified: `src/adapters/review/review-commands.ts` (a human `px review` decision made *now* — genuine decision moment), `src/adapters/review/review-artifacts.ts` (the review loop records a request-changes decision at observation time — established review-loop semantics), `src/adapters/backlog/concrete-review-read-adapter.ts` (read-only projection approximating legacy phase-based ReviewState for display) | none stamps the integrate/recovery approval boundary; the two review-loop writers are pre-existing decision-recording semantics and the adapter never writes — out of this mission's scope |
| the four named inference helpers | zero hits in `src/` and `test/` (`deriveImplementerAndFixRoundsFromPrComments`, `deriveFinalImplementerFromBranchHistory`, `deriveFixRoundsFromReviewStateHistory`, `deriveFixRoundsFromTaskText`) | deleted before this mission (CP 2 inventory); no orphaned test references |
| `branch-history` / `pr-comments` / `backlog-fallback` | zero hits in `src/` | gone with the helpers |
| optional/`null` MissionStore in the stats derivation path | zero hits: `createStatsWorkflowAdapter(missionStore: MissionStore)` is required, `create-cli.ts` throws on missing mission services, `deriveImplementerAndFixRounds` keeps its invariant error | SC13 holds end to end (CP 6); the classified out-of-scope historical forms are `stats-backfill.ts` and the presentation/backfill services (CP 2) |

## Orphan cleanup done here

- `test/lib/module-mock.ts`: fixed five lint violations (unused proxy-handler
  arg names, loose `!=` null check) surfaced while editing the facade for
  CP 6 — ESLint is now clean on every file this mission changed.

## Final semantics confirmed

- Approval authority: one `ReviewerDecision` on the Review aggregate; the
  explicit human override becomes one at its own timestamp; nothing else.
- Boundary stamping: every review→integration transition carries
  `decidedAt` of that decision; recovery replays it, never re-stamps it.
- Completion: only `integration → done` via `decideIntegration` with the
  landed commit timestamp; review→done is rejected by the state machine.
- Stats derivation: authoritative Review aggregate via a required
  MissionStore; unknown stays unknown; zero inference readers remain.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Contradiction list swept, zero unclassified hits | sweep commands above (rerunnable: `grep -rn "requireStatus(mission, \['review', 'integration'" src/`, `grep -rn "type: 'override'" src/`, `grep -rn "deriveFixRoundsFromTaskText\|deriveFixRoundsFromReviewStateHistory\|deriveFinalImplementerFromBranchHistory\|deriveImplementerAndFixRoundsFromPrComments" src/ test/` — all zero); table classifies every non-zero pattern | PASS |
| No orphaned imports/tests for deleted helpers | zero test references to the four helpers; `npx eslint` clean on all mission-changed files; test typecheck clean (`npx tsc --noEmit --project tsconfig.test.json`) | PASS |
| Required-store wiring final | `grep -rn "createStatsWorkflowAdapter(null)" src/ test/` → zero; `src/adapters/cli/commands/stats.ts` adapter signature, `src/composition/create-cli.ts` stats wiring | PASS |
| Full verifier still green | `npm test` → 1938/1938 pass (CP-6 committed tree; this checkpoint changes only `test/lib/module-mock.ts` lint hygiene, re-verified with `test/stats.test.ts` 48/48 + test typecheck); `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED | PASS |

Next action: CP 10 — Full verification: `git diff --check`, `./scripts/verify-local.sh all`, and a `.only`/bare `.skip` scan over the tests this mission changed.
