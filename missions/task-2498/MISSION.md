# Mission: card shows implementer as live agent while a review runs code before the reviewer launches (task-2498)

## Goal
Fix two board defects that appear during the null-agent code-run phase of `px review --continue`, when the review loop has published a `review/running/agent=null` current-work fact but has not yet launched the reviewer:

1. The flight card shows the implementer family (`custom`, the mission assignee) as the live agent. `web/src/flight-column.tsx` computes `const agent = liveAgent ?? card.agent`, so a `null` live agent falls back to the mission assignee — who owns the mission, not who is running.
2. The per-family running-agent count reports `0` for every family while the `null`-agent bracket is the newest fact, because `loadRunningSessions` (`src/adapters/backlog/concrete-agent-read-adapter.ts`) attributes a session to a family only from the reconciled current-work agent, and a `null` agent yields no family.

After the fix: a card whose newest current-work fact names a `null` agent and whose assignee is `custom` renders its agent pill as "no implementer" (faint), never `custom`; and `loadRunningSessions` attributes that running `px review` session to the mission's assigned agent family so the per-family count is non-zero.

## Why Now
The regression was observed live on the operator DB: the `px review --continue` run for task-2495 produced three consecutive current-work facts — `review/running/null`, `review/running/claude`, `review-response/running/custom` — so the reported family flipped with whichever event was newest, and the card showed `custom` via the assignee fallback even while code was running before the reviewer launched. The two defects are independent code paths (one web-render, one adapter projection) that both misread the same `null`-agent fact, so they must be fixed together to stop the flicker.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: regression on operator DB, two independent read-path defects from one `null`-agent current-work fact

## Scope
- `web/src/flight-column.tsx`: stop falling back to `card.agent` (the assignee) when a working card's live agent is explicitly `null`; render "no implementer" instead while keeping the assignee shown on idle cards.
- `src/adapters/backlog/concrete-agent-read-adapter.ts` (`loadRunningSessions`): attribute a running `px review` session whose reconciled current-work fact names a `null` agent to the mission's assigned agent family, so the per-family running count is non-zero.
- A regression test under `test/` that fails at the mission's parent commit (red) and passes once both fixes land (green).
- Test-only or documentation updates required to keep `./scripts/verify-local.sh all` green.

## Out of Scope
- Any change to the review-loop current-work publication policy in `src/application/review-command-use-case.ts` or `src/application/recording/current-work-recorder.ts` (the `null`-agent bracket is intentional and out of scope).
- Changes to `AGENT_COMMAND_ROLES`, session-marker logic, or `reconcileCurrentWork` freshness.
- Any other board surface (TUI/Ink, CLI) beyond the web flight card and the running-session count.
- Fixing the family *flicker* across the three facts; the mission only removes the wrong `null`-agent display, not the legitimate family that follows.

## Success Criteria
> **Falsifiability rule:** Each criterion is falsifiable; no unattached subjective adjectives or vague quantifiers.

- SC1: A web board card whose `currentWork` is a `working` fact with `agent: null` and whose `agent` (assignee) is `custom` renders its agent pill as "no implementer" and never renders the family string "custom" in that pill.
- SC2: The same card, when idle (`currentWork: null`), still renders the assignee family "custom" in its pill (idle display is unchanged).
- SC3: `ConcreteAgentReadAdapter.loadRunningSessions` returns a session `{ missionId, family: 'custom' }` for a live `px review --continue` session whose reconciled current-work fact names a `null` agent and whose mission assignee is `custom`.
- SC4: `projectAgentAvailability` / the running-session counts report a non-zero per-family count for that family (the unattributed-count path no longer absorbs the session).
- SC5: Existing attribution behaviour is preserved: a live `px review` session whose reconciled current-work fact names a non-null agent (e.g. `claude`) still attributes to that agent, and a live session outranks a stale marker (the assertions in `test/task-2393-current-work-attribution-repro.test.ts` still pass).
- SC6: `./scripts/verify-local.sh all` passes on the final tree (lint, typecheck, test-hygiene clean).

## Risks and Assumptions
- The assignee is used as the attribution family only for the genuinely-`null` current-work agent during a running review; the mission assumes the mission assignee is a valid, resolvable agent family for the running session. If `loadAssignedAgent` returns `null`, the session stays unattributed (no crash).
- Changing `loadRunningSessions` attribution must not regress the "never fabricate a family" rule: attribution only applies when a live session exists and the assignee resolves.
- The flight-card fix must preserve the idle-card assignee display; a naive `agent = liveAgent` would hide the assignee on idle cards. The fix keys off whether the card is working (`spinning` / `activity.work.kind === 'working'`).
- Assumption: the reproduction fixture (null working fact + custom assignee) faithfully models the operator-DB fact sequence.

## Checkpoints
- CP 1: Author the failing reproduction test that locks both defects (red), then run it to capture the red proof.
- CP 2: Fix defect 1 in `web/src/flight-column.tsx` (no assignee fallback while working with a null live agent) and run the reproduction test (green) plus the web board render tests.
- CP 3: Fix defect 2 in `src/adapters/backlog/concrete-agent-read-adapter.ts` (`loadRunningSessions` attributes the null-agent review session to the assignee family) and run the reproduction test plus `test/running-sessions.test.ts` and `test/task-2393-current-work-attribution-repro.test.ts`.
- CP 4: Final verification gate `./scripts/verify-local.sh all` green; write the checkpoint Goal Check with durable evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2498-...test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., the reproduction-test `test(...)` title string (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2498-...test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0041` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Raw `node --test` output or `git diff`/`git log` output alone is NOT sufficient evidence: a raw `stat`/`ls`/`git diff` blob or generic prose like "the test now passes" fails the checkpoint. Pair shell output with one of the accepted references above (the failing/passing test's exact name and file path, or the `./scripts/verify-local.sh all` command that produced the green result).
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Reproduction test locks the bug and goes red→green | `test/task-2498-...test.ts`, `"review null-agent code-run phase shows no implementer, not assignee"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/application/review-command-use-case.ts` and `src/application/recording/current-work-recorder.ts` — the `null`-agent bracket and review-loop publication policy are out of scope; do not edit.
- `src/adapters/agents/running-sessions.ts` (`AGENT_COMMAND_ROLES`, `parsePxInvocation`, `detectRunningMissionSessions`) — do not edit; attribution fix lives in the read adapter, not the process-table detector.
- No source edits outside `web/src/flight-column.tsx`, `src/adapters/backlog/concrete-agent-read-adapter.ts`, and the new test file under `test/`.

## Stop Rules
- Stop before touching any file outside the restricted areas.
- Stop if the attribution fix would require changing `AGENT_COMMAND_ROLES`, `reconcileCurrentWork`, or the review-loop publication policy — re-read the mission and expand scope only by asking the user.
- Stop if the reproduction test cannot go red at the parent commit (a test that is already green is not a reproduction).
- Never push the mission branch to `origin`; the `review` remote is the only push target for review.

<!-- DOD:BEGIN -->
- Reproduction-Test: test/task-2498-review-null-agent-board.test.ts
<!-- DOD:END -->
