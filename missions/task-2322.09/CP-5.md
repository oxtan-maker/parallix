# CP 5: Fast unit tests for SessionMarker repository and adapter

## Summary

Created `test/session-marker-repository.test.ts` with 25 tests across 10 suites covering all SC9 scenarios. All tests use isolated database fixtures (temporary SQLite files) with no Forgejo calls, agent launches, or CLI subprocesses. Every test completes in under 5ms.

Test coverage:
- **Resume** (4 tests): same family matches, different family rejects, no marker returns false, different role returns false
- **Failover** (2 tests): save replaces existing marker, other (mission, role) pairs unaffected
- **Duplicate marker** (2 tests): idempotent save, UNIQUE constraint prevents duplicates
- **Stale update** (2 tests): last write wins, updated_at set on each save via ON CONFLICT
- **Restart** (2 tests): marker persists across DB close/reopen, survives worktree cleanup (SC8)
- **Database-unavailable** (3 tests): explicit errors for find, save, and adapter when DB closed — no file fallback (SC6)
- **Session identity round-trips** (2 tests): all fields preserved, null sessionId handled correctly (SC7)
- **Clear behavior** (2 tests): delete specific (mission, role), clear all (SC8)
- **Migration 0004 schema** (2 tests): role CHECK constraint rejects invalid values, all three known roles accepted (SC3)
- **Import** (4 tests): dry-run without writes, atomic commit, conflict detection with both-sides reporting, unknown role skipping (SC5)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Resume: same family matches, different family rejects | `test/session-marker-repository.test.ts` — `"shouldResume returns true when mission, role, and agent all match"`, `"shouldResume returns false when agent family differs"` | PASS |
| Failover: marker replaced on new launch | `test/session-marker-repository.test.ts` — `"save replaces existing marker for same (mission, role)"` | PASS |
| Duplicate marker: upsert replaces | `test/session-marker-repository.test.ts` — `"save is idempotent for the same (mission, role)"`, `"UNIQUE constraint prevents duplicate rows"` | PASS |
| Stale update: concurrent write handling | `test/session-marker-repository.test.ts` — `"last write wins for concurrent saves on same (mission, role)"` | PASS |
| Restart: marker survives process exit | `test/session-marker-repository.test.ts` — `"marker persists across database close/reopen"` | PASS |
| Database-unavailable: explicit error, no file fallback | `test/session-marker-repository.test.ts` — `"findByMissionAndRole throws when database is not open"`, `"SqliteSessionMarkerAdapter throws when database is closed (no file fallback)"` | PASS |
| Session identity round-trips (SC7) | `test/session-marker-repository.test.ts` — `"all identity fields round-trip through SQLite adapter"` | PASS |
| Worktree cleanup does not erase marker (SC8) | `test/session-marker-repository.test.ts` — `"marker survives worktree directory removal (SC8)"` | PASS |
| Clear behavior observable (SC8) | `test/session-marker-repository.test.ts` — `"delete removes specific (mission, role) marker"`, `"clear removes all markers"` | PASS |
| No Attempt-shaped type introduced (SC10) | `test/domain-attempt-guard.test.ts` — 11/11 tests pass | PASS |
| All 25 tests pass | `node --test test/session-marker-repository.test.ts` — 25/25 pass, 0 fail | PASS |
| Static analysis gate passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene, test typecheck all PASS | PASS |

Next action: Verify all mission Gates pass and prepare for handoff. Run `./scripts/verify-local.sh all` for the full verification suite.
