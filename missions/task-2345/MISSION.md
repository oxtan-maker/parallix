# Mission: Reconcile launcher block seam with the SQLite blocklist (task-2345)

## Goal

Make `agents.local.json` (operator override) and the SQLite blocklist (runtime blocks) converge into a single block-authority function so the launcher and the board agree on whether a family is blocked at any instant.

## Why Now

After `task-2336`, the board shows SQLite-sourced block state (countdown + reason) while the launcher's `defaultIsAgentBlockedNow` reads only `agents.local.json`. The operator sees one truth on the board and the harness acts on another — a launcher may pick a family the board labels blocked, or skip a family the board shows as available. This was explicitly deferred from `task-2336` (see `missions/task-2336/MISSION.md`, Out of Scope).

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: two-file core change (`src/adapters/agents/agents.ts`, `src/adapters/agents/agent-config.ts`), one new test file, docs update, existing test touches for seam alignment

## Scope
- Introduce a single block-authority function that merges SQLite blocks (runtime, written by `updateAgentBlockChecked`) and `agents.local.json` blocks (operator override) with a defined precedence order
- Wire `defaultIsAgentBlockedNow` (launcher seam) through this authority so it consults SQLite in addition to the config file
- Wire `ConcreteAgentReadAdapter.loadAgentAvailability` (board seam) through the same authority
- Preserve `agents.local.json` override semantics: an explicit unblock (`"blocked": false`) in the local file must clear a SQLite block for that family
- Update `docs/agents.md` to document which store is authoritative and how overrides interact
- Author a red-to-green reproduction test that captures the board/launcher disagreement before the fix

## Out of Scope
- The blocklist table schema and `SqliteBlocklistRepository` internals
- Limit detection and block TTL policy (`shouldPersistLaunchFailureBlock`, block rounding)
- The board agent strip rendering delivered by `task-2336`
- Adding a CLI command for listing or clearing blocks
- Changing the `agents.local.json` file format or migration logic

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A block persisted via `updateAgentBlockChecked` makes `defaultIsAgentBlockedNow` return `true` for that family, asserted in a test (red before fix, green after)
- SC2: A block declared only in `agents.local.json` and a block held only in the SQLite blocklist produce the same `true` result from the block-authority function, asserted in a test
- SC3: An explicit `"blocked": false` in `agents.local.json` overrides a SQLite block for that family, returning `false` from the block-authority function, asserted in a test
- SC4: `ConcreteAgentReadAdapter.loadAgentAvailability` and `defaultIsAgentBlockedNow` return the same blocked/not-blocked answer for the same family at the same instant, asserted in a test
- SC5: `docs/agents.md` section `## Local blocklist overrides` states which store is authoritative and how `agents.local.json` overrides interact with it
- SC6: `./scripts/verify-local.sh all` passes on the final tree
- SC7: No new `.only` or bare `.skip` tests introduced in changed files

## Risks and Assumptions
- SQLite read is async; the launcher call site (`defaultIsAgentBlockedNow`) is synchronous. The fix must either make the launcher seam async or introduce a sync SQLite read path. If the launcher seam cannot go async without breaking too many callers, a cached/sync SQLite peek is the fallback.
- `agent-config.ts` currently has zero `async` functions (verified by `test/sqlite-async-cascade-cp3.test.ts`). Introducing async there propagates to all callers of `readAgentConfig`/`isAgentBlocked`.
- The `isAgentBlockedFn` callback is injected into `startAgent` options and mocked in many tests; changing its signature (sync → async) requires touching those test sites.
- Existing tests that mock `isAgentBlockedFn: () => false` remain valid after the change because the mock replaces the function entirely.

## Checkpoints
- CP 1: Author red-to-green reproduction test (`test/task-2345-repro.test.ts`) that asserts `defaultIsAgentBlockedNow` returns `false` for a family blocked only in SQLite (write via `updateAgentBlockChecked`, read via config-only path). Test fails on parent commit, passes after fix.
- CP 2: Implement single block-authority function that merges SQLite + `agents.local.json` with override precedence. Wire launcher and board through it.
- CP 3: Update `docs/agents.md` and verify all acceptance criteria. Run `./scripts/verify-local.sh all`.

Reproduction-Test: test/task-2345-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2345-repro.test.ts` ``, `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"block persisted via updateAgentBlockChecked makes launcher seam return true"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2345-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Repro test captures board/launcher divergence | `test/task-2345-repro.test.ts`, `"block in SQLite only makes launcher seam return true"` | PASS |
| Block authority merges both stores | `src/adapters/agents/agents.ts` — `defaultIsAgentBlockedNow` now calls merged authority | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/adapters/sqlite/blocklist-repository.ts` — schema and repository internals are out of scope; do not modify table structure or repository methods
- `src/application/services/agent-block-service.ts` — block TTL, rounding, and `queryAll`/`block` logic are unchanged
- `src/adapters/agents/launcher-selection.ts` — `eligibleAgentsForStep` uses `isAgentBlocked` from `agent-config.ts`; if the authority changes, this file may need a pass-through import, but its selection logic is not the target of this mission
- `test/sqlite-async-cascade-cp3.test.ts` — existing assertion that `agent-config.ts` has zero async functions; if the fix introduces async there, update this test assertion rather than refactoring the entire async cascade

## Stop Rules
- Do not add a CLI command for listing or clearing blocks (out of scope)
- Do not change the `agents.local.json` file format, supported shape, or migration logic
- Do not modify the blocklist table schema or `SqliteBlocklistRepository` internals
- Do not change `shouldPersistLaunchFailureBlock` or block TTL/rounding policy
- If the launcher seam cannot go async without >5 test file changes, use a sync SQLite peek (cached result) and mark with `ponytail:` comment
