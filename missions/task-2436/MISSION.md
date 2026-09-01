# Mission: Add guarded browser controller actions (task-2436)

## Goal

Turn the browser board from a read-only projection into a safe controller for server-projected typed actions: users can invoke advertised actions by pointer, keyboard, or valid drag intent, and see only refreshed authoritative state after an outcome.

## Why Now

The board already projects missions and available actions, but without guarded interaction it cannot serve as the operational surface promised by the controller design. Adding local lifecycle transitions or generic drag movement would undermine the server's authority and make stale/conflicting operations unsafe, so the first interactive release must establish the typed-action boundary correctly.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: browser board/controller interaction wiring, pending/error outcome states, typed drag-intent resolution, keyboard/focus behavior, and interaction/accessibility coverage

## Scope

- Add browser-board affordances that dispatch only actions advertised in the current server projection; retain the server action kind and mission identity as typed request data rather than deriving them from display text.
- Dispatch an enabled projected action immediately. Its accessible name and pending/outcome state identify the exact action and mission; the browser never derives a command from display text.
- A handoff request needs only mission identity: the server derives the handoff evidence, records it, and starts review as the command-line flow does.
- Keep unavailable actions non-dispatchable for pointer and keyboard input, including when an unavailable control has focus.
- Model pending, failed, cancelled, and stale-conflict outcomes without changing the card's lane locally. A stale conflict must refresh the authoritative snapshot and require a new user action; it must never silently retry.
- Add drag/drop as a second invocation affordance for the action projected for the target lane. The server projection owns the action-to-target relation; accepted drops dispatch exactly the same typed action as its button and do not move the card locally. Mark unsupported targets non-droppable and explain the reason.
- Synchronize attention-rail and board selection and provide keyboard-only navigation for rail/board focus, card and action selection, FLOW toggle, shipped toggle, and applicable help controls. Restore focus after outcome refresh and action completion.
- Match the components in scope to `/tmp/Parallix Kanban Board Controller.zip` while retaining the authoritative-projection behavior above.
- Make the card's current state legible from projected facts: show the active worker in the header when work is live, blink that live indicator, render only the received checkpoint slots in green, and use the approved review visual language: completed slots green, current review slot amber, future slots dark. The current review label is `round N/5`.
- Cap review automation at five rounds when parallix starts a review itself. A human-initiated continuation raises the limit to one round beyond the persisted round, so a continuation at round N runs with a limit of N+1 and each restart grants one further round; this applies to both CLI and browser starts. An explicit `--max-attempts` remains authoritative over both.
- Extend interaction and accessibility tests, including request call counts and typed payload fields, for click, keyboard, drag intent, immediate invocation, cancellation, conflict, and failed operations.

## Out of Scope

- Any browser-side lifecycle authority, including generic `move`, `setStatus`, state-override, forced, or optimistic lane-mutation paths.
- Client-side transition tables that determine whether a drop is legal independently of the current server-projected actions.
- Automatic retry of integration, review, conflict, or other effectful actions.
- An environment-override “retry agent” action unless a separately reviewed typed capability is added to the server projection.
- Changes to server lifecycle policy beyond the server projecting the typed action and target-lane intent the browser consumes.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: Invoking an enabled projected action by click or keyboard makes exactly one typed mutation request containing the projected action kind and mission identity; its pending/outcome state identifies the exact projected action and mission.
- SC2: Disabled or unavailable actions make zero mutation requests when clicked, focused and activated by keyboard, or reached through board/rail selection.
- SC3: A failed or cancelled request displays its typed outcome while the card remains in the lane from the last authoritative snapshot.
- SC4: A stale-conflict outcome preserves the failed operation visibly, refetches the authoritative snapshot, makes zero automatic retries, and requires a new user action before another request.
- SC5: A drag to a target lane is accepted only when the current server projection advertises the corresponding typed action; accepted drag dispatches the same action immediately as its button, while invalid targets make zero mutation requests and expose a non-droppable explanation. An active mission with a matching approved review may target integration; the server persists any required review and integration transitions.
- SC6: No card changes lanes before a refreshed authoritative snapshot projects it there; the final browser diff contains no generic move, status-set, state-override, or local lifecycle-mutation fallback.
- SC6a: A live card header identifies the same active worker as its activity fact, has a reduced-motion-safe blinking live indicator, renders no unreceived checkpoint slot, and shows review progress with completed slots green, the current review slot amber, and future slots dark.
- SC7: Attention-rail and board selection remain synchronized without duplicate dispatch, and keyboard-only operation covers rail/board focus, card/action selection, FLOW toggle, shipped toggle, and applicable help.
- SC8: After outcome refresh and action completion, focus returns to the documented initiating control or an equivalent available board control.
- SC9: Interaction tests assert mutation request count and typed payload fields for click, keyboard, valid/invalid drag intent, conflict, and failure; an automatic review start caps at five rounds, while a human-initiated continuation of a persisted round N runs with a limit of N+1 on both the CLI and the browser handoff-resume path, and an explicit `--max-attempts` overrides both; accessibility/focus coverage passes.
- SC10: `./scripts/verify-local.sh all` succeeds on the completed mission tree.

## Risks and Assumptions

- Risk: The current projection may not provide an action for a target lane. Mitigation: reject the drop and show its reason; target/action mapping stays server-owned.
- Risk: Snapshot refresh timing can make pending UI look like a lane change. Mitigation: render pending operation state separately and replace lifecycle display only from a refreshed projection.
- Risk: Keyboard shortcuts can duplicate dispatch or strand focus after a refresh. Mitigation: test invocation counts and focus restoration for each terminal path.
- Assumption: Server-projected actions include stable typed identifiers and target-lane intent sufficient to resolve drag intent without parsing display labels.
- Assumption: `/tmp/Parallix Kanban Board Controller.zip` is available to the implementation agent as the approved visual reference.

## Checkpoints

- CP 1: Map the current board projection, action-bar/controller boundary, mutation client, and interaction-test fixture. Define the typed-action invocation and authoritative snapshot replacement boundary before adding browser interactions. Record the target test files and the exact projected fields used for drag intent.
- CP 2: Implement guarded immediate action invocation for pointer and keyboard paths. Cover enabled, unavailable, pending, failure, and stale-conflict behavior, including request counts/payloads and authoritative-lane preservation.
- CP 3: Implement server-projected drag intent, selection synchronization, keyboard navigation, toggles/help behavior, and predictable focus restoration. Add valid/invalid drop and accessibility/focus coverage; compare scoped components against the approved controller mockup.
- CP 4: Audit the final browser diff for prohibited local lifecycle authority and generic mutation fallbacks. Run the required verification gate and complete the goal-check evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Lead every evidence row with durable evidence Parallix verifies today: an exact test name, ADR reference, test file path, or recognized repository command/path such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- Use the exact heading `## Goal Check` followed by the exact three-column table header `| Criterion | Evidence | Status |`.
- Include at least one durable, verifiable evidence row for every success criterion. File:line references are accepted when needed but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted command, test name, test path, or ADR reference above.
- Include a concise summary of work done and end with a non-generic `Next action:` line.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Action dispatches one typed request | `test/tui-action-bar.test.ts`, exact action-dispatch test name | PASS |
| Browser state remains projection-authoritative | `test/fixtures/board-projection.ts`, exact stale-conflict test name | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates

`verify-local.sh all` runs the documentation check and the default test suite
only. The integration gate additionally runs static analysis (ESLint, the
emission typecheck, test-hygiene, and the `tsconfig.test.json` test typecheck)
and the integration suite, so both are declared here — a mission that runs only
`all` cannot see a type error in a test file or a failure in an
integration-only test.

- [x] ./scripts/verify-local.sh all
- [x] ./scripts/verify-local.sh static-analysis
- [x] npm run test:integration

## Restricted Areas

- Server lifecycle and mutation-policy code are contract providers: do not introduce browser-side alternatives, generic transitions, or a local force path.
- The action projection's display strings are presentation only: do not parse them to select, authorize, or dispatch an action.
- Existing board-projection fixtures and browser/controller tests must preserve their role as the authority boundary; extend them rather than replacing the projection with handcrafted client lifecycle state.
- `/tmp/Parallix Kanban Board Controller.zip` is a visual reference, not authorization to add capabilities that are absent from the server projection.

## Stop Rules

- Stop and request product/server-contract direction if no stable typed action identifier and target-lane intent are available for drag resolution; do not infer either from labels, lane names, or display text.
- Stop and request direction if implementing the mockup would require a generic move, set-status, retry-agent, state-override, force, or optimistic lane-transition path.
- Stop and request accessibility direction if the intended keyboard shortcut conflicts with an established global shortcut or cannot restore focus to a meaningful available control after the refresh path.
- Do not silently retry stale conflicts.
