# Mission: add rebounce on hooks (task-2340)

## Goal
Add automatic bounceback (rebounce) for all user-provided git hooks (pre-commit, pre-push, post-commit, etc.) so that when a hook fails during rebase or integrate, parallix launches the implementer to fix the issue and proceeds without human intervention.

## Why Now
Rebase failures from user-provided hooks strand missions mid-flow. Task 2328 demonstrated this: a hook failure during rebase blocked the reviewer launch with only a "Hint: A git hook failed" message and no recovery path. The review loop already has auto-bounce for verification gate failures (`handleGateFailureAutoBounce` in `review-loop.ts`); hook failures lack equivalent recovery. Closing this gap prevents manual intervention for a common, fixable failure mode.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: extend existing auto-bounce pattern to hook failures; touches rebase and integrate paths; new test coverage for hook failure recovery

## Scope
- Detect user-provided git hook failures in `src/adapters/cli/commands/rebase.ts` (current: hint + exit)
- Detect user-provided git hook failures in `src/adapters/cli/commands/integrate.ts` (current: hint + exit)
- Auto-bounce to implementer with fix prompt when hook fails (mirrors `handleGateFailureAutoBounce` pattern)
- Retry the operation (rebase or integrate) after implementer fix; proceed if hooks pass
- Track retry count in review state metadata; strand after budget exceeded
- Unit tests for hook failure detection, bounce prompt, and retry flow
- Update `src/adapters/review/rebase.ts` to propagate hook failure classification (not just shared-file conflicts)

## Out of Scope
- Changing hook configuration or adding new hooks
- Auto-bounce for non-hook rebase errors (e.g., repository lock, invalid upstream)
- Modifying agent launchers' test hooks (those are internal override points, not user-provided git hooks)
- Post-integrate hook auto-bounce (covered by existing `post-integrate-hook.js` flow)

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `rebase.ts` classifies hook failures (output contains "pre-commit", "pre-push", or "hook") and returns a structured result with `hookFailure: true` instead of exiting with code 1
- SC2: `integrate.ts` classifies squash commit hook failures and returns a structured result with `hookFailure: true` instead of exiting with code 1
- SC3: Hook failure in rebase triggers auto-bounce to implementer with a fix prompt containing the hook output, retry attempt number, and max retries (2)
- SC4: Hook failure in integrate triggers auto-bounce to implementer with a fix prompt containing the hook output, retry attempt number, and max retries (2)
- SC5: After implementer fix, rebase/re-integrate is retried; if hooks pass, flow proceeds without human intervention
- SC6: Retry count stored in review state metadata key `hookFailureRetryCount`; mission strands after 2 retries with clear error message
- SC7: `rebase.ts` exports `classifyHookFailure(output)` function for unit testing; returns `{ isHookFailure: boolean, hookType: string | null }`
- SC8: `integrate.ts` exports `classifyHookFailure(output)` function for unit testing; returns `{ isHookFailure: boolean, hookType: string | null }`
- SC9: Unit tests cover: (a) hook failure detection for pre-commit output, (b) hook failure detection for pre-push output, (c) bounce prompt includes hook output, (d) retry count increments, (e) mission strands after max retries, (f) non-hook rebase errors do not trigger bounce

## Risks and Assumptions
- Hook output format is stable enough for string matching (pre-commit, pre-push, "hook" keyword) — same pattern already used in `rebase.ts` lines 186-187 and 280-281
- Implementer can fix hook failures (e.g., lint errors, formatting) — assumption holds for most pre-commit hooks
- Review state metadata schema accepts new `hookFailureRetryCount` key alongside existing `gateFailureRetryCount`
- The `handleGateFailureAutoBounce` pattern in `review-loop.ts` is the reference implementation; hook bounce follows same structure
- Non-hook failures (repository lock, invalid upstream, status 128) are NOT auto-bounced — they remain HumanOnly

## Checkpoints
- CP 1: Implement `classifyHookFailure()` in `rebase.ts` and `integrate.ts`; add unit tests for detection logic (pre-commit, pre-push, generic hook output)
- CP 2: Add auto-bounce flow to `rebase.ts` hook failure path — implementer fix prompt, retry, retry count in metadata
- CP 3: Add auto-bounce flow to `integrate.ts` hook failure path — implementer fix prompt, retry, retry count in metadata
- CP 4: Update `rebaseBeforeReviewRound()` in `src/adapters/review/rebase.ts` to detect and propagate hook failure classification; add tests
- CP 5: End-to-end verification — `./scripts/verify-local.sh all` passes; review state metadata round-trips correctly

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
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. A raw `ls test/` listing alone does not prove a test was added; cite the test file path and test name.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| `classifyHookFailure` exported from `rebase.ts` | `src/adapters/cli/commands/rebase.ts:180` | PASS |
| Hook detection test for pre-commit output | `test/task-2340-hook-rebounce.test.ts`, `"classifyHookFailure detects pre-commit output"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- Do not modify agent launcher test hooks (`src/adapters/agents/claude.ts`, `pi.ts`, `codex.ts`, `opencode.ts`) — those are internal override points, not user-provided git hooks
- Do not modify `docs/adr/` files unless a new ADR is warranted (unlikely for this change)
- Do not change the existing `handleGateFailureAutoBounce` function in `review-loop.ts` — hook bounce is a parallel path, not a modification of gate bounce

## Stop Rules
- Stop if hook failure classification requires parsing hook output beyond string matching (pre-commit/pre-push/"hook" keyword) — that scope increase needs separate task
- Stop if review state metadata schema change for `hookFailureRetryCount` conflicts with existing migration logic — file as blocker
- Stop if implementer cannot be launched for hook fix (e.g., no agent available) — fall back to existing hint + exit behavior, do not block the rebase flow
