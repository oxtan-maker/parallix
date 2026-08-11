# Mission: Make the mission implementer own conflict resolution (task-2294.01)

## Goal
Pin conflict resolution to the mission's recorded implementer so both `px rebase` and `px resolve-conflict` launch the same agent family that owns the mission — never a separately configured eligibility pool.

## Why Now
Conflict handling calls `startAgent('conflict-resolution', ...)` which routes through `selectAgent` and reads the `conflict-resolution` step from `config/agents.json`. That step has its own eligibility list (`["claude", "codex", "vibe"]`). Launcher fallback can then silently swap the actor after a block, capacity failure, missing launcher, or usage limit. This contradicts the domain model: conflict resolution is implementation work owned by the mission implementer, while `conflict-resolution` is the work stage for usage attribution, not a separately assignable role. Child of TASK-2294 (canonical domain model).

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 2 command files (rebase-workflow.ts, resolve-conflict.ts), 1 config file (agents.json), 1 doc file (agents.md), 2 test files, 1 reproduction test, plus port/adapter seam updates

## Scope
- `src/adapters/cli/commands/resolve-conflict.ts` — resolve mission implementer from task file, pass `agent` override to `startAgent`, carry slug + role
- `src/application/rebase-workflow.ts` — resolve mission implementer before shared-file conflict launch, pass `agent` override to `port.startAgent`, carry slug + role
- `src/application/ports/rebase-workflow.ts` — ensure `AgentLaunchResult` and `startAgent` port signature accept the pinned agent and identity params (already accept `Record<string, unknown>`)
- `src/adapters/agents/agents.ts` — ensure `startAgent` honors `agent` override for conflict path without silently falling back to pool selection; fail explicitly when pinned agent unavailable
- `config/agents.json` — remove `conflict-resolution` step entry (eligibility, selection, weights)
- `docs/agents.md` — update conflict-resolution description to reflect implementer ownership; remove separately configurable pool language
- `test/resolve-conflict.test.ts` — add tests for implementer pinning, missing implementer, unavailable implementer
- `test/rebase-use-case.test.ts` — add test for implementer pinning on shared-file conflict path
- `test/task-2294.01-repro.test.ts` — regression reproduction test (bug-labeled mission)

## Out of Scope
- Changing the `conflict-resolution` work stage name in usage/telemetry (`src/domain/usage.ts`)
- Forgejo integration for conflict resolution (already out of scope per backlog)
- Introducing new agent families or launcher adapters
- Custom-agent capacity reservation for conflict path (existing `tryAcquireCustomCapacity` logic unchanged)
- The `handleHookFailureAutoBounce` path (already resolves implementer; this mission only covers the conflict-launch paths)

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `px resolve-conflict` resolves the mission implementer from the task file and passes it as `agent` to `startAgent`. Verified by test: `test/resolve-conflict.test.ts` asserts `agent` option equals the recorded implementer family.
- SC2: `px rebase` shared-file conflict path resolves the mission implementer from the task file and passes it as `agent` to `port.startAgent`. Verified by test: `test/rebase-use-case.test.ts` asserts `agent` option equals the recorded implementer family on the conflict launch.
- SC3: `config/agents.json` contains no `conflict-resolution` step entry (no `eligible`, `selection`, or `weights` key under `steps["conflict-resolution"]`).
- SC4: When the pinned implementer launcher is unavailable (missing binary or probe failure), `px resolve-conflict` exits non-zero with a message naming the implementer family and the launcher detail. Verified by test in `test/resolve-conflict.test.ts`.
- SC5: When the pinned implementer launcher is unavailable, `px rebase` shared-file conflict path exits non-zero with a message naming the implementer family. Verified by test in `test/rebase-use-case.test.ts`.
- SC6: When the mission has no recorded implementer (task file missing or no implementer field), `px resolve-conflict` exits non-zero with a message identifying the missing implementer. Verified by test in `test/resolve-conflict.test.ts`.
- SC7: Conflict resolution usage attributed with stage `"conflict-resolution"` and role `"implementer"`. The `startAgent` call passes `slug` and `role: "implementer"` alongside the pinned `agent`. Verified by test assertions on `startAgent` options.
- SC8: `docs/agents.md` describes conflict resolution as implementer-owned work. No prose presents `conflict-resolution` as a separately configurable workflow step with its own eligibility pool.
- SC9: `./scripts/verify-local.sh all` passes on the final tree.
- SC10: Reproduction test at `test/task-2294.01-repro.test.ts` fails on parent commit (red) and passes on final tree (green).

## Risks and Assumptions
- Risk: `startAgent` fallback loop may silently override the pinned `agent` after first failure iteration. Mitigation: ensure the agent-override path fails explicitly on first unavailability rather than entering the reroute loop.
- Risk: Existing tests mock `startAgentFn` with `{ agent: 'codex', result: { status: 0 } }` — they do not verify the `agent` option passed in. New assertions must read the options object.
- Assumption: `resolveTaskFile` + `getTaskImplementer` are available on the rebase workflow port (they are — already used by `handleHookFailureAutoBounce`).
- Assumption: `resolve-conflict.ts` can call `resolveTaskFile`/`getTaskImplementer` via the backlog adapter (same imports already exist in `rebase-workflow-adapter.ts`).
- Assumption: The `conflict-resolution` step removal from `agents.json` does not break callers that read `steps["conflict-resolution"]` — `selectAgent` falls back to `defaultPolicy` when a step key is missing.

## Checkpoints
- CP 1: Author reproduction test (`test/task-2294.01-repro.test.ts`) that asserts `startAgent` is called with the mission's recorded implementer as `agent` for both conflict entry points. Test must fail on parent commit (conflict path uses pool selection, not pinned agent) and pass after fix.
- CP 2: Implement implementer pinning in `px resolve-conflict` — resolve implementer, pass `agent` override, carry slug + role, fail explicitly on unavailable implementer.
- CP 3: Implement implementer pinning in `px rebase` shared-file conflict path — resolve implementer, pass `agent` override, carry slug + role, fail explicitly on unavailable implementer.
- CP 4: Remove `conflict-resolution` step from `config/agents.json` and update `docs/agents.md`.
- CP 5: Update tests, verify all gates, write checkpoint.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/domain/usage.ts` — do not rename `conflict-resolution` work stage or add new stages
- `src/application/services/agent-selection.ts` — `PreparedAgentSelection` class unchanged; conflict pinning bypasses pool selection via `agent` override
- `src/application/services/agent-block-service.ts` — blocklist persistence logic unchanged
- `src/application/rebase-command-use-case.ts` — use case shell unchanged; all policy in `rebase-workflow.ts`

## Stop Rules
- Do not introduce Forgejo as a dependency for conflict resolution. Mission identity resolves through the active mission-driver adapter.
- Do not add new agent families or launcher adapters.
- Do not change the `conflict-resolution` work stage name in `src/domain/usage.ts`.
- Do not modify `handleHookFailureAutoBounce` policy (already resolves implementer correctly).
- If `startAgent` agent-override semantics require changes larger than adding one explicit-fail branch, stop and raise.

Reproduction-Test: test/task-2294.01-repro.test.ts
