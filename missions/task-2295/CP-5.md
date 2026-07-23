# CP-5: Genuine recovery/rollback proofs and takeover corrections

## Summary

This checkpoint records the corrective work done on takeover after the mission reached MAX_ATTEMPTS. Three classes of defect flagged across the review rounds were addressed at the architecture level rather than patched:

1. **Theatrical consumer wiring removed.** The parallel `SqliteAgentSelectionSnapshotPort` → `PreparedAgentSelection` → `ActiveService._agentSelection` selector never influenced the real health-probing selector and could override it with an unhealthy agent. It was deleted. SQLite now feeds the *real* consumer through a composition-root blocklist overlay (see CP-3). `ActiveService` was restored to its `main` shape.
2. **Genuine adapter recovery (SC8).** `SqliteDatabaseAdapter` gained `checkIntegrity()`, `backup()`, and `recoverFromBackup()`. Recovery detects a corrupted image via `PRAGMA integrity_check`, restores the most recent backup, reopens, and re-verifies — proven by restoring committed data after real on-disk corruption. The migration runner's pre-migration backup now delegates to `backup()` (duplication removed).
3. **Genuine rollback / repository-wins (SC10).** Tests now build a real conflicting SQLite projection and prove (a) the SQLite blocklist governs only the operator-local blocklist field while repo-owned step eligibility is untouched, and (b) with the adapter disabled the untouched `readAgentConfig` file reader supplies the blocklist.

Additionally, `usage_statistics` numeric columns were corrected from `TEXT` to `INTEGER`/`REAL` to conform to the domain model (recorded in CP-4).

### Files
- `src/adapters/sqlite/database-adapter.ts` — `checkIntegrity()`, `backup()`, `recoverFromBackup()`
- `src/adapters/sqlite/migration-runner.ts` — pre-migration backup delegates to `db.backup()`
- `test/sqlite-recovery-cp5.test.ts` — 11 tests (recovery, rollback, repository-wins, concurrency, checksum, importers, busy-timeout)
- Deleted: `src/adapters/sqlite/snapshot-adapter.ts`

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC8: Adapter recovers committed data after real corruption | test `"adapter recovers committed data from backup after the database file is corrupted"` in `test/sqlite-recovery-cp5.test.ts`; `src/adapters/sqlite/database-adapter.ts` `recoverFromBackup()` | PASS |
| SC8: Recovery reports failure with no backup | test `"recoverFromBackup reports failure when no backup is available"` in `test/sqlite-recovery-cp5.test.ts` | PASS |
| SC8: Corruption is detected, not swallowed | `checkIntegrity()` returns `false` on a malformed image; asserted in the recovery test | PASS |
| SC10: Repository/Git authority wins over SQLite projection | test `"repository authority wins: SQLite only governs the blocklist field, never repo-owned step eligibility"` in `test/sqlite-recovery-cp5.test.ts` | PASS |
| SC10: Rollback returns to untouched file readers | test `"rollback: with the adapter disabled, the untouched file reader supplies the blocklist"` exercises `readAgentConfig` (fs.readFileSync) → `eligibleAgentsForStep` | PASS |
| No async cascade into hot consumers (SC3) | see CP-3; `test/sqlite-async-cascade-cp3.test.ts` | PASS |
| Theatrical selector removed | `src/adapters/sqlite/snapshot-adapter.ts` deleted; `src/platform/runtime/lib/application/active-service.ts` matches `main` | PASS |
| SC11: Full suite + static analysis green | `./scripts/verify-local.sh all` — 1016 tests PASS; `./scripts/verify-local.sh static-analysis` — ALL STAGES PASSED | PASS |

### Next action:
Re-request review for task-2295 (round 6); surface the corrected architecture and the new TASK-2301 (library-backed migration decision) to the reviewer.
