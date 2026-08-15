# Mission: Restore reviewer fallback when all agents exhausted (task-2377)

## Goal
Restore the reviewer fallback path so that when every eligible reviewer agent fails to launch, the implementer is tried as a last-resort self-reviewer instead of hard-failing with `REVIEWER_LAUNCH_FAILURE`. This matches the documented single-family escape hatch: when no different-family reviewer is available, the implementer reviews its own work.

## Why Now
Users hit `REVIEWER_LAUNCH_FAILURE` escalation even when the implementer is still runnable. The traceback shows all agents (codex, qwen, claude, vibe) exhaust with the same error, yet the implementer — which ran successfully in the implement step — is pre-excluded from the fallback pool and never gets a chance. The `resolveReviewerIdentity` function in `review-agent-fallback.ts` has single-family-fallback logic for _selection_, but `startAgent` in `agents.ts` throws "All eligible agents exhausted" before the implementer can be tried at launch time.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: One-function fix in `startAgent` fallback loop; existing single-family-fallback pattern in `review-agent-fallback.ts` provides the spec; reproduction test and unit test are scoped

## Scope
- `src/adapters/agents/agents.ts` — `startAgent` function: when agent pool is exhausted (all non-excluded agents tried and failed), try excluded agents as last resort before throwing "All eligible agents exhausted"
- `test/task-2377-repro.test.ts` — regression reproduction test that verifies the implementer is tried when the reviewer pool exhausts
- Backlog task labels: add `bug` and `ai_sdlc`

## Out of Scope
- `resolveReviewerIdentity` in `review-agent-fallback.ts` — its single-family-fallback path is for selection, not launch-time exhaustion; no change needed there
- Blocklist behavior change for self-review (TASK-2369 already handles blocklist skip on launch failure)
- Forgejo-specific fallback paths
- Custom agent launcher resolution

## Success Criteria
- SC1: `startAgent` tries excluded agents as last resort when the non-excluded agent pool is exhausted, instead of throwing immediately
- SC2: The implementer (pre-excluded via `exclude: [implementer]`) is tried when all other agents fail, and the review proceeds with self-review
- SC3: The "All eligible agents exhausted" error is only thrown after both non-excluded and excluded agents have been tried
- SC4: Existing behavior unchanged: excluded agents are NOT tried when a non-excluded agent succeeds; the fallback-to-excluded only triggers on pool exhaustion
- SC5: Existing single-family-fallback log message ("Single-family fallback: reviewer=...") is emitted when the implementer is selected as the last-resort reviewer
- SC6: Reproduction test `test/task-2377-repro.test.ts` fails on parent commit (red) and passes after fix (green)
- SC7: `./scripts/verify-local.sh static-analysis` passes clean on changed files

## Risks and Assumptions
- Risk: Trying excluded agents changes the fallback order for callers that use `exclude` for reasons other than family separation. Mitigation: excluded agents are only tried after ALL non-excluded agents have been tried and failed — same order as today, just extended.
- Risk: The implementer's worktree may be in a different state (e.g., read-only mount) at review time. Mitigation: this is the same scenario the bug report describes — the implementer DID run successfully, so its worktree was writable. The read-only error in the traceback was in the `.workflow/vibe-home/logs/` path, not the worktree.
- Assumption: The `exclude` list is primarily used to prevent same-family self-review; when all other families fail, self-review is acceptable per ADR 0037 and `review-agent-fallback.ts` single-family-fallback.
- Assumption: The `startAgent` function is the single entry point for agent launching in the review step; no other code path bypasses this fallback.

## Checkpoints
- CP 1: Author reproduction test `test/task-2377-repro.test.ts` that simulates reviewer pool exhaustion (all non-excluded agents fail) and asserts the implementer is tried as last resort. Test must fail on parent commit (red) and pass after fix (green).
- CP 2: Fix `startAgent` in `src/adapters/agents/agents.ts` to try excluded agents after non-excluded pool exhausts. Verify reproduction test turns green. Run `./scripts/verify-local.sh static-analysis`.

Reproduction-Test: test/task-2377-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2377-repro.test.ts` ``, `` `./scripts/verify-local.sh static-analysis` ``
  2. **Test names** — e.g., `"startAgent tries excluded agents after pool exhaustion"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2377-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0037` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Reproduction test fails before fix | `npm test -- test/task-2377-repro.test.ts` on parent commit | PASS |
| startAgent tries excluded agents on exhaustion | `test/task-2377-repro.test.ts`, `"startAgent tries excluded agents after pool exhaustion"` | PASS |
| Static analysis clean | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `src/adapters/review/review-agent-fallback.ts` — `resolveReviewerIdentity` single-family-fallback path is correct for selection; do not modify
- `src/application/handoff-command-use-case.ts` — handoff self-review fallback (line ~319) is a separate code path; do not modify
- `test/task-2335-reviewer-family-repro.test.ts` — existing single-family-fallback test; do not modify (new test complements it)

## Stop Rules
- Do not touch `resolveReviewerIdentity` — the bug is in `startAgent`, not selection
- Do not add new configuration or flags — the fix is a behavioral repair of an existing documented escape hatch
- If the fix requires changes beyond `startAgent` in `agents.ts` and the reproduction test, re-scope the mission before proceeding
