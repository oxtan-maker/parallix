# CP 2 — expired compatibility code paths deleted

## Summary of work done

The four file-backed Review paths that survived the earlier rounds are gone.
There is no longer a second place a review round, a review event, or an
implementer identity can live.

**Review state.** `ReviewState.save()`
(`src/platform/runtime/lib/review/review-state.ts:411`) persists to SQLite with
CAS retry; `readReviewState`/`readReviewRounds` read the aggregate. Nothing
writes `review-state.json`. A mission handed off before the cut-over would
otherwise fail closed forever, so `backfillReviewFromLegacyState`
(`review-state.ts:250`) migrates one, once, when an operator asks:
`px review <slug> --backfill-review`. It is the only remaining read of that
file, and it is declared as `explicit-one-way-legacy-input`
(`durable-state-inventory.ts:251`).

**Review events.** `createEvent` (`review-events.ts:450`) stores the event on
the Review aggregate and fails loudly when the mission has no Review — it no
longer falls back to writing a `.md` file. The Markdown under
`missions/<slug>/review-events/` is now an *export* of the stored event
(`exportEventFile`, `review-events.ts:549`): written so humans and agents can
read a mission's history from its directory, never read back by production.
`readAllEvents` (`review-events.ts:672`) reads SQLite only; the file reader and
its parser are deleted.

**Statistics.** `stats.ts` no longer imports the review event store at all.
`deriveImplementerAndFixRounds` (`stats.ts:1593`) takes rounds and fix-round
counts from the Review aggregate; the two `.md`-reading derivations are gone.
`defaultPrFixRounds` (`stats.ts:1991`) carries the count forward from the
measurement store (SQLite) instead of re-reading event files, and the
render-time override that existed only to correct stale file-derived counts is
removed.

**Artifacts.** `review-artifacts.ts` reads the configured artifact directory and
nothing else; the dead `fallbackToTmp`/`explicitTmpDir` plumbing is removed from
the module and from `review-loop.ts`.

**Inventory.** The four `TASK-2322.12` entries are replaced by two truthful
ones: the one-way legacy import above, and the review-event Markdown export
classified as `generated-artifact` (`durable-state-inventory.ts:264`).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: no inventory entry defers to this cutover | `test/task-2322.12-stray-persistence.test.ts`, `"SC1: no inventory entry still defers to the TASK-2322.12 cutover"` | PASS |
| SC2: review modules perform no durable file IO for review state, events, or identity | `test/task-2322.12-stray-persistence.test.ts`, `"SC2/SC3: no review module or statistics path declares database-owned file IO for Review"` | PASS |
| SC2: the event export is never read back | `test/task-2322.12-stray-persistence.test.ts`, `"SC2/SC3: no production file reads the review-event export"` | PASS |
| SC2: an event with no stored Review fails instead of writing a file | `test/review-events.test.ts`, `"createEvent fails loudly when the mission has no Review in the database"` | PASS |
| SC2: reads come from the aggregate, not the export | `test/review-events.test.ts`, `"readAllEvents reads the stored events, not the exported files"` | PASS |
| SC3: statistics do not import the review event reader | `test/task-2322.12-stray-persistence.test.ts`, `"SC3: statistics do not import the review modules' event or state readers"` | PASS |
| SC3: fix rounds come from the Review aggregate | `test/stats.test.ts`, `"deriveImplementerAndFixRounds counts the rounds the reviewer sent back to the final implementer (task-1318)"` | PASS |
| Pre-cutover missions have a migration path | `test/review-backfill.test.ts`, `src/platform/runtime/lib/review/review-state.ts:250` | PASS |
| No `/tmp` artifact fallback remains | `test/review-artifacts.test.ts`, `"consumeReviewerArtifacts does not recover artifacts written to /tmp when the artifact dir is elsewhere"` | PASS |
| Every durable-IO file under `src/` is declared or excluded | `test/persistence-inventory-guardrail.test.ts`, `"SC1 reverse: all durable-IO files under src/ are present in the inventory"` | PASS |

Next action: certify SC4–SC10 and the gates in CP-6.
