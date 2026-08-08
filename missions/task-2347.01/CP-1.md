## CP-1 — Lock the bug (reproduction test, no fix)

Author `test/task-2347-01-repository-identity-repro.test.ts` with 5 test cases
covering cross-repository contamination, round-trip repository id, same
idempotency key across repos, and legacy sentinel exclusion.

### Tests and red evidence

All 4 substantive assertions are RED at parent commit `ed52d6abf`:

1. **Cross-repo contamination** — `cumulativeFlow` last point is 2 (alpha + beta
   WIP) instead of expected 1 (alpha only). `medianStateTimes` value is 165
   (45 + 120 merged) instead of 45 (alpha alone).
2. **Round-trip repository id (non-null from)** — `entryToEvent` returns
   `repositoryId: '' as never` instead of `'alpha'`.
3. **Round-trip repository id (null from)** — same `'' as never` defect.
4. **Same idempotency key across two repos** — `findAll()` returns entries
   without `repositoryId` property; filter finds 0 rows per repo.
5. **Legacy sentinel exclusion** — passes as placeholder (no migration yet,
   becomes meaningful after CP-2 adds legacy backfill).

### Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test exists and fails at parent commit `ed52d6abf` | `test/task-2347-01-repository-identity-repro.test.ts`, `"metrics built for alpha exclude lane events recorded for beta"` — WIP 2 !== 1 | RED (locked) |
| Cross-repo contamination: lane events | `test/task-2347-01-repository-identity-repro.test.ts:178` — `cumulativeFlow` last value 2 !== 1 | RED (locked) |
| Cross-repo contamination: usage outcomes | `test/task-2347-01-repository-identity-repro.test.ts:189` — `medianStateTimes` 165 !== 45 | RED (locked) |
| Round-trip repository id (non-null from) | `test/task-2347-01-repository-identity-repro.test.ts:209` — `'' !== 'alpha'` | RED (locked) |
| Round-trip repository id (null from) | `test/task-2347-01-repository-identity-repro.test.ts:227` — `'' !== 'alpha'` | RED (locked) |
| Same idempotency key across repos | `test/task-2347-01-repository-identity-repro.test.ts:256` — 0 !== 1 | RED (locked) |
| Legacy sentinel exclusion | `test/task-2347-01-repository-identity-repro.test.ts:271` — placeholder, no migration yet | PASS (placeholder) |

Next action: CP-2 — add migration `0011-board-lane-events-repository-id.sql` with `repository_id` column, composite indexes, and legacy backfill.
