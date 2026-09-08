# CP-1: Adhoc lifecycle reproduction test (red → green)

## Work summary

Added `test/task-2468-adhoc-lifecycle-repro.test.ts`, the red-to-green anchor
for task-2468. It runs the real CLI end to end against stub `codex`/`opencode`
binaries on a fixture PATH (no real model): it drafts a free-text adhoc mission,
discovers the materialized identity under `missions/`, and asserts `px active`
succeeds without a Backlog task file.

- On the parent commit the `task-` prefix guard in `px active` refused the
  adhoc identity with `slug must begin with task-`, so the assertion was RED.
- Once the DB-owned adhoc identity and the shared-validator guard landed, the
  same test is GREEN.

Core identity work landed with this checkpoint:

- `src/adapters/filesystem/mission-paths.ts` — `isMissionSlugCandidate` now
  recognizes `parallix-adhoc-<NNNN>` (plus legacy `adhoc-`/`task-`), and
  `inferSlug` directory-name match does too.
- `src/application/execute-mission-service.ts` — the `px active` guard now uses
  the shared `isMissionSlugCandidate` instead of `slug.startsWith('task-')`.
- `src/adapters/sqlite/migrations/0018-adhoc-mission-counter.sql` — new
  repository-scoped `adhoc_mission_counters` table.
- `src/adapters/sqlite/adhoc-counter.ts` — `allocateAdhocIdentity`, atomic
  per-repository counter minting `parallix-adhoc-<NNNN>` (no content hash).
- `src/adapters/cli/commands/draft-stats.ts` + `draft-setup.ts` — free-text
  draft allocates the DB-owned identity; `syntheticTaskId` no longer hashes an
  adhoc slug (derivable identity).
- `test/execute-mission-characterization.test.ts` — refusal message updated and
  a new assertion that a `parallix-adhoc-` identity is accepted, not refused.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Red→green repro test exists and passes | `test/task-2468-adhoc-lifecycle-repro.test.ts`, `npm test -- --unit-test-headroom` | PASS |
| Red on parent commit (task- guard refused) | `test/task-2468-adhoc-lifecycle-repro.test.ts` asserts `px active <adhoc-slug>`; parent printed `slug must begin with task-` | PASS |
| Shared validator accepts adhoc identity | `test/execute-mission-characterization.test.ts`, `"execute workflow: a DB-owned adhoc identity is accepted, not refused by a task- prefix assumption"` | PASS |
| Static-analysis gate clean | `./scripts/verify-local.sh static-analysis` (ESLint, `npm run typecheck`, test-hygiene, test typecheck) | PASS |
| DB-owned counter migration present | `src/adapters/sqlite/migrations/0018-adhoc-mission-counter.sql`, `src/adapters/sqlite/adhoc-counter.ts` | PASS |

## Next action
Continue CP-2: make mission status and implementer/assignment read from DB
authority rather than the task file, keep one-way Backlog.md mirroring where a
task file exists, and preserve explicit `px draft task-<N>` missing/ambiguous
failures.
