# CP-2: DB-owned adhoc identity, shared slug validation, DB-authoritative reads

## Work summary

Hardened the DB-owned adhoc identity landed in CP-1 so it survives the
architecture guardrails and is exercised by the stubbed lifecycle net:

- **Repository key routed out of the SQLite package.** `allocateAdhocIdentity`
  (`src/adapters/sqlite/adhoc-counter.ts`) no longer imports
  `src/adapters/git/repository-identity.js`. The per-repository key is now
  resolved by the CLI caller (`draft-stats.ts` via
  `resolveCanonicalRepositoryId`) and passed in, so the `sqlite` package keeps
  its single sanctioned mechanism dependency (`storage`).
- **Owned architecture exception.** Added an application→adapter edge exception
  for `execute-mission-service.ts → mission-paths.js` in
  `src/adapters/architecture/boundary-guards.ts` (`ownerTaskId: TASK-2468`,
  `removalMission: missions/task-2468`) so the shared-validator import is
  attributed and removable rather than silently permanent.
- **Persistence inventory.** Registered the adhoc counter read/write boundary
  in `test/fixtures/durable-state-inventory.ts`
  (`adhoc-counter-read`, `adhoc-counter-write`, `database-owned-domain-state`).
- **Default-suite registration.** Added
  `test/task-2468-adhoc-lifecycle-repro.test.ts` to the default-suite allowlist
  so the regression net runs in the default suite (no real model).

The adhoc identity is minted from a per-repository, atomically incremented
counter (`0018-adhoc-mission-counter.sql`), scoped to a repository, with no
content hash: slug, mission id, branch (`mission/<slug>`), and worktree suffix
stay one derivable identity. `isMissionSlugCandidate`
(`src/adapters/filesystem/mission-paths.ts`) recognizes
`parallix-adhoc-<NNNN>`; `px active` accepts it via the shared validator instead
of a `task-` prefix assumption.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| DB-owned adhoc identity minted per repository, no content hash | `src/adapters/sqlite/adhoc-counter.ts`, `src/adapters/sqlite/migrations/0018-adhoc-mission-counter.sql` | PASS |
| Shared slug validator recognizes adhoc identity; `px active` accepts it | `src/adapters/filesystem/mission-paths.ts` `isMissionSlugCandidate`, `src/application/execute-mission-service.ts` | PASS |
| Free-text draft reaches `active` without a Backlog task file (red→green) | `test/task-2468-adhoc-lifecycle-repro.test.ts`, `npm test` | PASS |
| Stubbed lifecycle recognizes the new adhoc identity (three-intake net) | `test/e2e-mission-lifecycle.test.ts`, `"adhoc-only intake: a free-text draft reaches an approved review with no Backlog task file"` | PASS |
| DB-authoritative review read resolves the adhoc mission | `test/e2e-mission-lifecycle.test.ts`, `px review <slug> --status` resolves `phase: approved` | PASS |
| Architecture + persistence inventory guardrails clean | `src/adapters/architecture/boundary-guards.ts`, `test/fixtures/durable-state-inventory.ts`, `test/dependency-graph.test.ts` | PASS |
| Static-analysis gate clean | `./scripts/verify-local.sh static-analysis` (ESLint, `npm run typecheck`, test-hygiene, test typecheck) | PASS |

## Next action
CP-3: consolidate intake-independent prompt rendering with an intake-specific
substitution block and add prompt-parity coverage, then cover Backlog-mirror
degradation (missing/moved mirror file mid-mission) in the stubbed net, and
verify explicit `px draft task-<N>` still rejects a missing/ambiguous task file.
