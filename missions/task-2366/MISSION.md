# Mission: Classify rebase failure as GateFailure so handoff relaunches agent (task-2366)

## Goal
Add a "Rebase failed" classification pattern to `classifyError` in `repair-handoff.ts` so that the generic "Rebase failed before handoff" error triggers an agent relaunch (`GateFailure` → `AutoSendBack`) instead of stranding the task as an infrastructure blocker requiring manual intervention.

## Why Now
Task-2365 handoff failed with "Rebase failed before handoff" when a verification gate (`persistence-inventory-guardrail.test.ts`) rejected the PR creation during `px handoff`. The error message fell through all `classifyError` patterns to the default `InfraBlocker`/`HumanOnly`, so no agent relaunch occurred. The operator got "Infrastructure blocker detected: … Forgejo credentials, connectivity, or rate limits" — a misleading diagnosis for what was actually a fixable code issue (missing file in persistence inventory).

The actual error was NOT a git hook failure: `rebaseBeforeReviewRound` runs `px rebase slug --push`, which calls `createPr`, which runs the verification gate. The gate failure error ("verification gate failed for /path with exit code 1") does not match `HOOK_FAILURE_RE` (no "hook", "pre-commit", "pre-push" keywords), so `hookFailure` was `false`. Adding a `hookFailure` check in the handoff use case would not have helped — the fix must be in the error classification layer.

This follows the same pattern as task-2215: an error message falling through to `InfraBlocker` that should map to a relaunchable class.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 1-file classification fix + 1 reproduction test; existing relaunch infrastructure reused

## Scope
- Add "Rebase failed" pattern to `classifyError` in `src/adapters/cli/commands/repair-handoff.ts` that maps to `FailureClass.GateFailure` / `DispatchAction.AutoSendBack`
- Write reproduction test under `test/` that asserts `classifyError("Rebase failed before handoff …")` returns `GateFailure` / `AutoSendBack` (test fails on parent commit, passes after fix)

## Out of Scope
- `HandoffRebasePort` interface changes (the `hookFailure` field already exists at runtime — no port update needed)
- Handoff use case logic changes (the error message is correct; classification is the gap)
- Review loop rebounce (already works via `review-loop.ts`)
- CLI `px rebase` command rebounce (has its own hook-failure auto-bounce)
- Adding `temp-root-registry.ts` to persistence inventory (that was the task-2365 code fix; this mission fixes the workflow gap it exposed)

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `classifyError` in `src/adapters/cli/commands/repair-handoff.ts` has a pattern matching "Rebase failed" that returns `FailureClass.GateFailure`
- SC2: The dispatch action for the "Rebase failed" pattern is `DispatchAction.AutoSendBack`
- SC3: `isRelaunchableError("Rebase failed before handoff …")` returns `true` (inherited from `GateFailure` classification)
- SC4: Reproduction test `test/task-2366-repro.test.ts` asserts `classifyError` maps "Rebase failed before handoff" to `GateFailure` / `AutoSendBack` (test fails on parent commit, passes after fix)
- SC5: `./scripts/verify-local.sh static-analysis` passes with no errors on changed files
- SC6: `./scripts/verify-local.sh all` passes (includes test-hygiene: no `.only`, no bare `.skip`)

## Risks and Assumptions
- The "Rebase failed" pattern is specific enough to avoid false positives — the only existing error message containing "Rebase failed" is the handoff use case's generic rebase error
- `GateFailure` → `AutoSendBack` dispatch is already wired in `repair-handoff.ts` to relaunch the agent via `isRelaunchableError`
- The pattern placement in `classifyError` (before the default `InfraBlocker` fallback) ensures the match is reached
- Existing classification patterns are not affected — the new pattern adds a new match, it does not modify existing ones

## Checkpoints
- CP 1: Author failing reproduction test (`test/task-2366-repro.test.ts`) that asserts `classifyError("Rebase failed before handoff …")` returns `GateFailure` / `AutoSendBack`. Test must fail on parent commit (red — currently returns `InfraBlocker` / `HumanOnly`) and pass after fix (green).
- CP 2: Add "Rebase failed" pattern to `classifyError` in `repair-handoff.ts`. Run `./scripts/verify-local.sh static-analysis`.
- CP 3: Verify full suite. Run `./scripts/verify-local.sh all`.

Reproduction-Test: test/task-2366-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `node --test test/task-2366-repro.test.ts` ``, `` `./scripts/verify-local.sh static-analysis` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"classifyError maps rebase failure to GateFailure"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2366-repro.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Repro test fails on parent commit | `test/task-2366-repro.test.ts`, `"classifyError maps rebase failure to GateFailure"` | PASS (red) |
| classifyError has rebase failure pattern | `src/adapters/cli/commands/repair-handoff.ts` — `classifyError` | PASS |
| Static analysis clean | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/application/handoff-command-use-case.ts` (the error message is correct — the gap is in classification, not generation)
- `src/application/ports/handoff-workflow.ts` (no port interface change needed)
- `src/adapters/review/review-loop.ts` (review loop rebounce already works)
- `src/application/rebase-workflow.ts` (CLI rebase hook-failure auto-bounce is separate)
- `src/adapters/review/rebase.ts` (rebase function already returns `hookFailure` — no change needed)

## Stop Rules
- If the "Rebase failed" pattern risks matching other unrelated error messages, narrow the regex (e.g., require "Rebase failed before handoff" as the full phrase)
- If more than 2 files outside tests are modified, re-evaluate scope — the fix should be one pattern in `classifyError` plus one test
