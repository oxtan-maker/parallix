# CP 6 — final certification of the ADR 0053 Review cutover

## Summary of work done

Boundary enforcement, recovery, documentation, and the gates, verified against
the tree rather than asserted.

**Boundaries.** `test/task-2322.12-stray-persistence.test.ts` is the standing
guard: presentation stays behind application ports, SQLite adapters do not build
the composition root, no cut-over review path declares durable file IO again,
nothing reads the review-event export back, and no deferred-migration marker
survives under `src/`. Each check names the offending file, so a future mission
that trips one gets an actionable failure.

**Recovery.** All nine SC7 scenarios exercise the real database through
`SqliteMissionStore`, and each asserts the standing invariant that no scenario
falls back to a file.

**Documentation.** ADR 0053's Review row now states that the cut-over is done,
names `<PARALLIX_HOME>/parallix.db` as the sole live authority for rounds, phase,
disposition, retry counters, stage launches and events, and names what remains
outside it: the write-only Markdown export, the single-use `/tmp` agent
artifacts, and the review provider as a projection. `src/domain/README.md` says
the same in the domain's own terms, without restating the ADR's decision table.

**SC3 (round-5 finding).** `stats.ts` no longer imports the review modules'
readers at all. `deriveImplementerAndFixRounds` loads the `Review` aggregate
through `SqliteMissionStore` directly (`loadMissionReview`), and the round
conversation, current round number, and fix-round count are read off the
aggregate. Two consequences followed and were carried through rather than
patched around:

- The old `source: 'review-state'` branch is gone. It was only reachable when a
  review-state read produced an implementer that the round history did not, and
  a mission with a `Review` always has at least one round — so the aggregate
  branch above it already owns every case it covered.
- `deriveFixRoundsFromReviewStateHistory` — the fallback for a mission with no
  `Review` in the database — no longer needs a round number handed to it from
  review state. It reads the highest round out of the same commit history it
  already parses, which is the only round record such a mission has.

The guard test now rejects `readReviewState` and `readReviewRounds` alongside
`readAllEvents`, so the finding's false positive cannot recur.

**Suite repairs.** The branch had 70 failing tests outside the default gate
(review, handoff, integrate, artifacts, px-runner, mission-store) left by the
async cut-over of the review modules. They are fixed, not skipped: tests await
the now-async calls, the identity a handoff runs under comes from the Backlog
task instead of a deleted JSON file, and two production defects the tests
exposed are repaired — `transitionTaskFn` is normalized before `.catch()`
(`review-commands.ts:1144`), and a reloaded review round no longer carries
`undefined`-valued optional keys that made a round-trip non-identical
(`mission-serialization.ts:336`).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: inventory has no TASK-2322.12 entry | `test/task-2322.12-stray-persistence.test.ts`, `"SC1: no inventory entry still defers to the TASK-2322.12 cutover"` | PASS |
| SC2: no review-module durable file IO for review state/events/identity | `test/task-2322.12-stray-persistence.test.ts`, `"SC2/SC3: no review module or statistics path declares database-owned file IO for Review"` | PASS |
| SC3: statistics read review data from SQLite only | `src/platform/runtime/lib/commands/stats.ts:1618` (`loadMissionReview` via `SqliteMissionStore`; no `readReviewState`/`readReviewRounds`/`readAllEvents` import), `test/task-2322.12-stray-persistence.test.ts`, `"SC3: statistics do not import the review modules' event or state readers"` | PASS |
| SC3: the statistics projection actually resolves an implementer and fix-round count from the aggregate | `test/stats.test.ts`, `"recordIntegrationStats reads backlog classification and Review aggregate final implementer/fix rounds"` — asserts `source === 'review-aggregate'` against a seeded four-round `Review` | PASS |
| SC3: a mission with no `Review` still resolves from commit history alone | `test/stats.test.ts`, `"recordIntegrationStats counts only final implementer rounds after handoff when the mission has no Review"` | PASS |
| SC4: no `interfaces/` file reaches SQLite or SQL | `test/task-2322.12-stray-persistence.test.ts`, `"SC4: no src/interfaces file imports SQLite, the adapter factory, or raw SQL"` | PASS |
| SC5: no `adapters/sqlite/` file imports the composition root | `test/task-2322.12-stray-persistence.test.ts`, `"SC5: no src/adapters/sqlite file imports the production composition root"` | PASS |
| SC6: undeclared durable IO fails the build | `test/persistence-inventory-guardrail.test.ts`, `"SC1 reverse: all durable-IO files under src/ are present in the inventory"` | PASS |
| SC7: nine recovery scenarios, none with a file fallback | `test/task-2322.12-review-recovery.integration.test.ts`, `"TASK-2322.12 CP5: review-loop state survives every recovery scenario (SC7)"` — 9/9 pass | PASS |
| SC8: CLI/TUI/board read through application contracts | `test/sqlite-mission-store.integration.test.ts`, `"keeps application and UI code behind ports and leaves production authority unchanged"` | PASS |
| SC9: ADR and domain README name the authority and the remaining boundaries | `docs/adr/0053-operational-persistence-and-authority-boundaries.md`, `src/domain/README.md` | PASS |
| SC10: no deferred migration, shadow write, or bidirectional sync marker | `test/task-2322.12-stray-persistence.test.ts`, `"SC10: no deferred migration or shadow-write marker remains under src/"` | PASS |
| Gate: `./scripts/verify-local.sh all` | exit 0 — 1593 pass / 0 fail (re-run after the round-5 SC3 fix) | PASS |
| Gate: `./scripts/verify-local.sh static-analysis` | exit 0 — ESLint, typecheck, test-hygiene, test typecheck ALL STAGES PASSED | PASS |
| Integration suite (outside the gate) restored | `npm run test:integration` — 1522 pass / 0 fail, from 102 failing at this branch's previous HEAD | PASS |

Next action: hand the cutover back to the reviewer for the round-5 decision.
