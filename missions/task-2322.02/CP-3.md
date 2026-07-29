# CP-3: Lock the checked-domain decision

## Summary

Implemented the CP 1 not-required `Attempt` branch. The checked domain keeps
`Attempt` excluded, while an architecture test now prevents an implicit
per-launch record from entering `src/domain`, `src/application`, or
`src/adapters`. The ADR and domain guide state that same decision, and the
inventory mapping remains the source for the types and invariants persistence
work may use.

Work done:

- Added `test/domain-attempt-guard.test.ts`. It scans declarations only, after
  stripping comments, for Attempt-shaped types, exported identifiers,
  identity fields, and SQL table references. Its fixtures reject real Attempt
  record/table declarations and accept local retry counters and comments.
- Updated ADR 0053’s `Attempt` row to record the excluded, test-enforced
  outcome, including the consumer evidence and the locking test.
- Updated `src/domain/README.md` to align its implementation-status statement
  with the checked CP 1 decision and CP 3 guard.
- Kept the CP 2 `persistence-domain-map` as the explicit total mapping from
  every database-owned inventory entry to a domain invariant or technical
  persistence metadata; no additional domain extension was justified by the
  traced consumers.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every database-owned inventory entry resolves exactly once to a domain invariant or technical metadata | `src/application/persistence-domain-map.ts:210`; `"SC1: every database-owned-domain-state entry has a resolution"` | PASS |
| All six consumer families are covered by checked source citations | `src/application/consumer-domain-requirements.ts:103`; `"SC2: the mapping covers exactly the six declared families"` | PASS |
| Consumer citations resolve and detect source drift | `test/domain-consumer-requirements.test.ts`; `"SC3: every consumer citation points at a line containing its anchor"` | PASS |
| The no-`Attempt` branch is locked with rejecting and accepting fixtures | `test/domain-attempt-guard.test.ts:115`; `"SC4 fixture: guard rejects an Attempt record type declaration"`, `"SC4 fixture: guard accepts a local retry counter and loop variable"` | PASS |
| ADR 0053 records the same excluded Attempt outcome as checked code | `docs/adr/0053-operational-persistence-and-authority-boundaries.md:98`; `"SC5: ADR 0053 records Attempt as excluded, matching the checked code"` | PASS |
| Domain documentation does not contradict the code | `src/domain/README.md:22`; `"SC5: src/domain/README.md contains no Attempt statement contradicting src/domain"` | PASS |
| No SQLite schema, migration, import, or production storage cutover was added | `test/domain-attempt-guard.test.ts`; `./scripts/verify-local.sh all` | PASS |
| Final verification gate passes without real Forgejo, agents, or expensive subprocesses in the new tests | `./scripts/verify-local.sh all`; `"SC4: no Attempt-shaped type, table, or record under src/domain, src/application, or src/adapters"` | PASS |

Next action: TASK-2322.03 and later persistence missions must use `src/application/persistence-domain-map.ts` and may not introduce an Attempt record without a new checked-domain decision.
