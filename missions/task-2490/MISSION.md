# Mission: Bake px handoff into px review --start and retire the standalone command (task-2490)

## Goal
Bake the handoff transition into `px review <slug> --start` so starting a review
performs the sync/push and review-transition that `px handoff` currently does,
then remove the standalone `handoff` command. The review lifecycle owns the
transition directly; there is no separate, easy-to-skip handoff step.

## Why Now
`px handoff` and `px review <slug> --start` both perform the sync/push and the
backlog `active -> review` transition. Having two entry points to the same
transition invites the redundant, easy-to-skip path: an agent can forget to
hand off, or hand off twice. This pairs with TASK-2482 (retire the unused
`px checkpoint` command); both retire commands that the review lifecycle can own
directly. The handoff workflow already lives as an application-owned
`HandoffCommandUseCase` reachable through ports, so the transition is movable
without re-architecting the workflow.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: redundant lifecycle transition, two-entry-point hazard, TASK-2482 pairing

## Scope
- Wire the sync/push and `active -> review` transition from `px review <slug> --start`
  (`src/adapters/review/review-commands.ts` `verifyReview`/`submitForReview` and the
  review command dispatch) so a review no longer depends on a separate handoff step.
- Preserve, through the `--start` path, every behavior of
  `src/application/handoff-command-use-case.ts` `performHandoff`: verify-handoff
  gate, the behind-main rebase repair, NEL capture, gatekeeper pre-review,
  declared `## Gates` execution, checkpoint Goal-Check validation, the review
  assignment, and the Forgejo PR create/update.
- Remove `handoff` from every registration/advertising surface so it is no
  longer registered, advertised, suggested, or executable:
  - `src/interfaces/cli/runtime.ts` — `KNOWN_COMMANDS` and `printUsage`
    (`handoff [<slug>] [--no-gate] [--no-recover] [--force]` line);
  - `src/composition/create-cli.ts` — the command binding;
  - `src/adapters/review/review-cli-flags.ts` — the lazy `getHandoff()` loader of
    `src/adapters/cli/commands/handoff.js`;
  - `src/adapters/cli/commands/handoff.ts` and `src/interfaces/cli/handoff.ts`
    (adapter + CLI interface) when no remaining caller imports them.
- Preserve existing callers of the handoff capability, routed through the
  review-start transition:
  - `submitForReview` (`src/adapters/review/review-commands.ts`) which calls
    `performHandoff`;
  - `src/adapters/review/review-loop.ts` and
    `src/composition/application-services.ts` (rebound / gate-repair callers);
  - the `px active` post-execute handoff repair from TASK-1037
    (`docs/agents.md` §Automatic post-execute handoff repair).
- Update live agent guidance so no document instructs agents to invoke
  `px handoff` separately from starting a review: `prompts/execute-core.md`,
  `prompts/review-core.md`, `docs/agents.md`. Historical mission records stay
  unchanged.
- Add focused regression tests and run required repository verification,
  including static-analysis for code changes.

## Out of Scope
- Any change to the handoff workflow's internal sequencing, gate-repair, or
  behind-main rebase logic beyond what is required to expose it through the
  review-start path.
- Retiring `px checkpoint` (TASK-2482) — paired, not in this mission.
- New commands, flags, or configuration.
- Behavioral change to `px review --push`, `--submit-review`, `--continue`,
  `--resume`, or any non-handoff review path.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and
> enumerates the specific elements that must survive.

- SC1 `px review <slug> --start` performs the sync/push and `active -> review`
  transition that `px handoff` previously performed, so starting a review no
  longer depends on a separate handoff step. Evidence: the review `--start`
  dispatch path calls `performHandoff` (or the equivalent port) before the
  reviewer launches; a focused test asserts the transition occurs.
- SC2 `handoff` is no longer registered, advertised, suggested, or executable as
  a standalone command: `src/interfaces/cli/runtime.ts` `KNOWN_COMMANDS` no
  longer contains `'handoff'`, `printUsage` no longer prints the
  `handoff [<slug>] [--no-gate] [--no-recover] [--force]` line, `create-cli.ts`
  no longer binds it, and `px handoff` fails as an unknown command. Its
  gate-repair and behind-main rebase behavior is preserved through the `--start`
  path.
- SC3 Existing callers still function routed through the review-start transition:
  `submitForReview` (`src/adapters/review/review-commands.ts`),
  `src/adapters/review/review-loop.ts`, `src/composition/application-services.ts`,
  and the `px active` post-execute handoff repair (TASK-1037) compile and their
  regression tests pass with no missing-handoff binding.
- SC4 Live documentation and agent guidance no longer instruct agents to invoke
  `px handoff` separately from starting a review: `prompts/execute-core.md`,
  `prompts/review-core.md`, `docs/agents.md`. Historical mission records remain
  unchanged.
- SC5 Focused regression checks pass and required repository verification,
  including static-analysis for code changes, passes.

## Risks and Assumptions
- The handoff workflow is large and reaches many ports; moving its entry point
  must not drop a collaborator. Assumption: because `submitForReview` already
  calls `performHandoff`, the wiring is additive/re-routing rather than a rewrite.
- `src/adapters/review/review-cli-flags.ts` `getHandoff()` lazily imports
  `src/adapters/cli/commands/handoff.js`; removing that adapter risks breaking
  every lazy importer. Trace all importers before deletion.
- `px active` post-execute handoff repair (TASK-1037) depends on the handoff
  capability; removing it must not strand that repair path.
- The `--start` path currently runs verification and launches the reviewer; the
  handoff's rebase-onto-primary and checkpoint-validation steps must slot in
  without duplicating the review's own verification.
- ADR 0053 makes the Review aggregate the sole write authority; the transition
  must persist through the same durable boundaries handoff uses.

## Checkpoints
- CP 1: Trace the handoff-workflow port and `handoff-command-use-case`; map every
  caller and every `handoff` registration/advertising surface.
- CP 2: Wire the sync/push and review-transition into `px review <slug> --start`;
  remove the standalone `handoff` command from all surfaces; preserve existing
  callers.
- CP 3: Update live docs/agent guidance; add focused regression tests.
- CP 4: Run verification gates and capture proof.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/...` ``, `` `px review <slug> --verify` ``, `` `./scripts/verify-local.sh all` ``, or `` `node parallix ...` ``
  2. **Test names** — must match a test name in the repo (e.g. the focused regression test you author)
  3. **Test file paths** — e.g., `test/...` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0053` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. A bare `ls src/interfaces/cli/` dump or "the command is gone" prose is not enough: cite the exact file (and, when useful, the symbol) that proves it — e.g. "`src/interfaces/cli/runtime.ts` `KNOWN_COMMANDS` no longer contains `'handoff'`".
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| `handoff` removed from registry | `src/interfaces/cli/runtime.ts` `KNOWN_COMMANDS` | PASS |
| Focused regression: review --start performs transition | `test/...`, "<exact test name>" | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Historical mission records under `backlog/completed/`, `backlog/archive/`, and any
  dated mission directories: read-only.
- The internal sequencing of `performHandoff` (verify-handoff gate, rebase
  repair, NEL capture, gatekeeper, checkpoint validation) — preserve, do not
  rewrite.
- The `px checkpoint` command and TASK-2482 surface.

## Stop Rules
- Stop before implementing if the handoff entry-point cannot be reached through
  the review-start path without rewriting the workflow; re-scope the mission.
- Stop if removing `handoff` would strand any of the callers in SC3 — route
  them through the review-start transition instead.
- Stop if static-analysis or the verification gate does not pass on the final
  tree; do not proceed to checkpoint authoring with a failing tree.
- Do not push the mission branch to `origin`; only `main` goes to `origin`.
