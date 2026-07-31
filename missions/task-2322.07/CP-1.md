# CP-1: Preflight import gate and composition-root cutover

Implemented the preflight import gate inside `createMissionApplicationServices()` and cut over the composition root from `CompatibilityMissionStore` to `SqliteMissionStore`. The function opens the operator-local SQLite database, applies pending migrations, runs `MissionCompatibilityImporter.apply()` as a one-time-per-root preflight gate, and constructs all Mission use cases over `SqliteMissionStore`. All callers handle the async boundary.

Command paths (status, handoff, integrate) no longer read or write legacy file authorities (task frontmatter, `CP-N.md`, `review-state.json`, `nel-record.json`) for Mission domain state. Handoff records the verified checkpoint and commits the SQLite transition **before** any external Backlog effect; integrate does the same before promoting the Backlog task, and both fail closed when the store is unavailable. `CompatibilityMissionStore` is deleted, and the ADR0053 inventory has no `TASK-2322.07` entries left.

Round 4 also fixed three defects that the previously claimed evidence had hidden: the SQL migrations were never copied into `.test-runtime` (so the importer saw no tables under test), a mission worktree and its base checkout resolved to different `repositoryId`s (so every post-handoff import looked like a divergence conflict), and `integrate` swallowed unexpected errors into `process.exit(0)` with no output.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: SqliteMissionStore constructed in composition root | `src/platform/runtime/lib/composition/application-services.ts:215` | PASS |
| SC1: authority field equals 'sqlite' | `src/platform/runtime/lib/composition/application-services.ts:224` | PASS |
| SC1: MissionApplicationServices.store typed as SqliteMissionStore | `src/platform/runtime/lib/composition/application-services.ts:40` | PASS |
| SC2: Preflight import gate runs importer.apply() | `src/platform/runtime/lib/composition/application-services.ts:204` | PASS |
| SC2: Import report conflicts block construction | `src/platform/runtime/lib/composition/application-services.ts:205-212` | PASS |
| SC2: Gate is a one-time cutover gate, not a steady-state reconciler | `src/platform/runtime/lib/composition/application-services.ts:191-196` | PASS |
| SC3: status.ts reads the SQLite-backed projection with no legacy fallback | `src/platform/runtime/lib/commands/status.ts:213-240` | PASS |
| SC3: handoff.ts records the verified checkpoint through the Mission store | `src/platform/runtime/lib/commands/handoff.ts:626-648` | PASS |
| SC3: handoff.ts commits the SQLite transition before the Backlog transition | `src/platform/runtime/lib/commands/handoff.ts:667-687` | PASS |
| SC3: handoff.ts NEL review rounds use the real MissionLoadResult discriminant | `src/platform/runtime/lib/commands/handoff.ts:1197` | PASS |
| SC3: handoff.ts NEL persisted via the Mission store, no nel-record.json | `test/handoff.test.ts`, `"captureNelAtHandoff records the NEL through the Mission store and writes no nel-record.json"` | PASS |
| SC3: integrate.ts commits the SQLite transition before Backlog promotion | `src/platform/runtime/lib/commands/integrate.ts:1271-1300` | PASS |
| SC3: No CompatibilityMissionStore anywhere in src/ | `grep -rn "CompatibilityMissionStore" src/` matches only an inventory comment | PASS |
| SC4: External task material enters only through the intake boundary | `src/platform/runtime/lib/composition/application-services.ts:50` | PASS |
| SC5: integrate fails closed when the Mission store is unavailable | `src/platform/runtime/lib/commands/integrate.ts:713-716`, `:1277-1280` | PASS |
| SC5: handoff fails the command when the transition cannot commit | `src/platform/runtime/lib/commands/handoff.ts:681-685` | PASS |
| SC5: unexpected integrate failures abort visibly instead of exiting 0 | `src/platform/runtime/lib/commands/integrate.ts:1044-1056` | PASS |
| SC4/SC5: draft materializes the Mission through the intake boundary before touching the Backlog task | `src/platform/runtime/lib/commands/draft.ts:270-333` | PASS |
| SC4/SC5: draft intake ordering is asserted, not assumed | `test/draft.test.ts`, `"runDraftCommand materializes the Mission in SQLite before transitioning the Backlog task"` | PASS |
| SC1/SC4: composition exposes the canonicalized repository identity it bound the use cases to | `src/platform/runtime/lib/composition/application-services.ts:49`, `:218` | PASS |
| SC4: draft keys the Mission to the primary checkout, not the `<repo>-<slug>` worktree | `src/platform/runtime/lib/commands/draft.ts:303-309` | PASS |
| SC4: intake repository identity is asserted, including the negative case | `test/draft.test.ts`, `"runDraftCommand keys the intake request to the identity the composition root resolved"` | PASS |
| SC4: services expose `repositoryId` for intake callers | `test/e2e-mission-sqlite-cutover.test.ts`, `"composition root: createMissionApplicationServices uses SqliteMissionStore"` | PASS |
| SC5: draft fails closed on an unavailable Mission store and leaves the Backlog task untouched | `test/draft.test.ts`, `"runDraftCommand fails closed and leaves the Backlog task untouched when Mission intake is unavailable"` | PASS |
| SC5: draft fails closed when the SQLite store cannot be constructed | `test/draft.test.ts`, `"runDraftCommand fails closed when the Mission store cannot be constructed"` | PASS |
| SC5: re-drafting a recorded Mission is idempotent (`conflict` is not a failure) | `test/draft.test.ts`, `"runDraftCommand treats an already-recorded Mission as idempotent and continues the draft"` | PASS |
| SC5: integrate aborts on a missing Mission aggregate before the Backlog promotion | `src/platform/runtime/lib/commands/integrate.ts:718`, `:1286` | PASS |
| SC5: missing/unavailable aggregates are covered by test, not just by code | `test/integrate.test.ts`, `"promoteTaskForIntegrationIfNeeded refuses to promote the Backlog task when the Mission aggregate is missing"` | PASS |
| SC6: E2E suite covers cold start, restart, stale writers, transitions, review/integration, legacy mutation | `test/e2e-mission-sqlite-cutover.test.ts` (11 tests) | PASS |
| SC6: full mission lifecycle E2E passes end to end | `` `node --import tsx test/e2e-mission-lifecycle.test.ts` `` — 6 pass, 0 fail | PASS |
| SC7: CompatibilityMissionStore deleted | `src/adapters/backlog/compatibility-mission-store.ts` removed (`git rm`) | PASS |
| SC7: ADR0053 inventory has zero TASK-2322.07 entries | `grep "cutoverTask: 'TASK-2322.07'" src/platform/runtime/lib/core/durable-state-inventory.ts` returns empty | PASS |
| SC7: remaining review-workflow file entries re-homed to their owning task | `src/platform/runtime/lib/core/durable-state-inventory.ts:249` (`cutoverTask: 'TASK-2322.12'`) | PASS |
| SC8: LegacyActiveAdapter.missionStore() resolves to SqliteMissionStore | `src/platform/runtime/lib/adapters/legacy-active-adapter.ts:198` | PASS |
| Migrations reach the test runtime | `scripts/build-test-runtime.ts:87-94` (copies `.sql` alongside the transpiled tree) | PASS |
| Declared gate | `` `./scripts/verify-local.sh all` `` — 1500 pass, 0 fail (exit 0) | PASS |
| Static analysis gate | `` `./scripts/verify-local.sh static-analysis` `` — ESLint, tsc, test-hygiene clean; test typecheck red on `test/unit-test-timeout-guard.test.ts` identically on `main` (pre-existing) | PASS (baseline) |
| Mandatory integration gate | `` `./scripts/verify-local.sh integrate` `` — build, integration-suite (1494 pass / 0 fail / 25 skipped), workflow (6/0), custom-agent-smoke (1/0) all PASS | PASS |

Round 5 fixes: Draft missions are materialized in SQLite via `MissionIntakeService.execute()` **before** the external Backlog task is transitioned (`src/platform/runtime/lib/commands/draft.ts:270-333`), and the intake result is now fail-closed — only an idempotent `conflict` (Mission already recorded) lets the draft continue; an unavailable database, a validation rejection, or a construction failure aborts the draft with exit 1 and leaves the task file untouched. Two defects in the first pass of this fix are also corrected: the result was inspected as `error.code`/`status === 'failure'` when `ApplicationOutcome` uses `error.kind` and `status === 'failed'` (so the idempotent path never matched), and a missing `MISSION.md` could abort intake — the title and labels are now read best-effort, since descriptive metadata must never be the reason a Mission is not materialized. `integrate.ts` fails closed on `kind === 'missing'` in both the main path (`:718`) and `promoteTaskForIntegrationIfNeeded()` (`:1286`), preventing file-only lifecycle state after cutover.

Gate note: `./scripts/verify-local.sh static-analysis` stage 4 (test typecheck) reports six `TS2339` errors in `test/unit-test-timeout-guard.test.ts`, a file this mission does not touch. The identical failure reproduces on `main` at `dcda37200`, so it is pre-existing baseline red per the mission stop rule, not a regression from this cutover.

Round 6 fix: The round-5 draft intake derived its own repository identity from `targetWorktree`, the `<repo>-<slug>` mission worktree, so a post-cutover draft persisted `Mission.repositoryId` as `<repo>-<slug>` while every other command resolves `<repo>`. This is the same cross-worktree identity mismatch round 4 fixed inside composition, reintroduced at a new call site. Rather than duplicate the canonicalization, `MissionApplicationServices` now exposes the `repositoryId` it bound the use cases to (`src/platform/runtime/lib/composition/application-services.ts:49`, `:218`) and the draft reads it back (`src/platform/runtime/lib/commands/draft.ts:309`), so the two cannot drift again.

Next action: Hand back to codex for round 7 review of the draft intake repository identity.
