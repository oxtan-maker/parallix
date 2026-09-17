# CP 1 — Failing reproduction test (red at parent commit)

## Summary
Authored the focused regression test that locks the task-2536 defect before any
fix. `test/task-2536-ambiguous-launch-no-global-block.test.ts` drives the real
`startAgent` retry path with every external boundary injected as a seam
(`launchAgentFn`, `updateAgentBlockFn`, `isAgentBlockedFn`, `selectAgentFn`)
plus the site-1 (`detectLimitHitFn`) quota seam — no real `px`, CLI, or SQLite
launch. It reproduces the 06:13 conflict: an ambiguous Codex launch (`status: 1`,
generic stderr, no quota/429/resource_exhausted signal), then asserts no
`agent_blocklist` row is written and the retry terminates on the next family.

Round-1 F3 note: the mission Goal's "check whether the family still has live work
before writing any block" clause is NOT modelled by this test by design — the
ambiguous case is resolved by not persisting a block at all, and the genuine-
quota case is intentionally exempt (see /tmp/task-2536-round-resolution.md). The
previously-implied live-work coverage claim has been removed from the header and
this table.

Run at the parent commit the test is RED: the ambiguous launch writes a global
block (`blockCalls === ['codex']`), exactly the defect.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Ambiguous launch reproduction exists and is red at parent | `test/task-2536-ambiguous-launch-no-global-block.test.ts` — run `npx tsx --test --experimental-test-module-mocks test/task-2536-ambiguous-launch-no-global-block.test.ts` → `actual: [ 'codex' ]` block written | RED (expected) |
| Regression mocks all agent/process boundaries | seams `launchAgentFn`/`updateAgentBlockFn`/`isAgentBlockedFn`/`selectAgentFn` in `test/task-2536-ambiguous-launch-no-global-block.test.ts`; `detectLimitHitFn` is the site-1 quota seam only (narrowed ambiguous branch uses module-level `detectLimitHit`); no `installPathLaunchers` / real SQLite | PASS |
| Live-work clause not modelled (F3 pushback) | Goal clause handled by not-blocking the ambiguous case + quota exemption; documented in test header and `/tmp/task-2536-round-resolution.md` | ACCEPTED (pushback) |
| Regression finishes within unit budget | `npx tsx --test --experimental-test-module-mocks test/task-2536-ambiguous-launch-no-global-block.test.ts` reported `duration_ms 290` | PASS |

## Next action
CP 2: narrow `shouldPersistLaunchFailureBlock` in `src/adapters/agents/agents.ts`
(see F1/F2/F3 resolutions recorded in `/tmp/task-2536-round-resolution.md`).
so an ambiguous non-zero exit stays local; persist a family block only on a
positive provider-wide availability/quota classification via `detectLimitHit`.
