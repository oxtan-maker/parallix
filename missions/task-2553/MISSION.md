# Mission: Preserve web-board Cancel clicks (task-2553)

## Goal
Ensure Cancel actions on web board cards open the cancellation confirmation
instead of being swallowed by card focus.

## Why Now
A pointer click on Cancel focuses and rerenders its card before the click can
open the confirmation, leaving missions impossible to cancel from the board.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: preserve pointer activation without changing cancellation or
  drag behavior

## Scope
- Prevent board-card focus from swallowing an enabled Cancel button's pointer
  click.
- Cover cancellation confirmation activation in intake and flight lanes.

## Out of Scope
- Changing cancellation API or lifecycle deletion behavior.
- Changing drag-and-drop behavior beyond regression coverage.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: Clicking an enabled Cancel control on cards in both refined and active
  lanes opens that card's cancellation confirmation without dispatching the
  deletion request.
- SC2: Mouse-down on a board action control prevents the parent card focus
  transition before the action click runs.
- SC3: Existing board drag target dispatch behavior remains covered by the
  board interaction suite.
- SC4: `./scripts/verify-local.sh static-analysis` exits zero on the final
  tree.

## Risks and Assumptions
- Assumption: preventing the button's mouse-down default prevents card focus
  while preserving its click and keyboard activation.

## Checkpoints
- CP 1: Prevent action-button mouse-down from focusing the parent card and
  cover Cancel confirmation activation in both board card types.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [x] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Cancellation API and lifecycle deletion behavior.

## Stop Rules
- Stop after the Cancel confirmation behavior and its regression coverage are
  verified; do not expand into unrelated board interactions.
