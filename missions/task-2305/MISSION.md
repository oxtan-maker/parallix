# Mission: Ink TUI wave 3: keyboard navigation, selection, mission detail, and PTY smoke harness (task-2305)

## Goal
Make the read-only Ink Kanban board keyboard-navigable, show the selected mission through the shared mission-detail projection, and establish a deterministic PTY smoke harness that later TUI waves can reuse without performing workflow or repository side effects.

## Why Now
Wave 2 provides read-only lanes and cards; Wave 3 is the dependency that turns that display into an operable board before attention-queue, execution, and analytics work begins. The PTY harness must be introduced now so Waves 4–7 can exercise real terminal behaviour using one bounded, safe mechanism.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: keyboard selection state and focus rendering; lane/window navigation semantics; mission-detail projection integration; reusable real-PTY launch/navigation/resize/exit coverage; headless and non-TTY compatibility.

## Scope
- Define and implement keyboard selection movement across lanes and cards, including empty-lane and boundary behaviour, horizontal wrapping, vertical movement, and the visible-card window for an overflowing lane.
- Render an unambiguous focused selection in both wide and narrow board layouts, and keep the selected mission represented solely as TUI view state.
- Render the selected mission’s detail panel from `src/application/projections/mission-detail.ts`, including explicit unavailable or stale-source states.
- Handle keys reserved for later workflow actions by rendering an explicit “not yet available” affordance without invoking an action.
- Add component-level tests for selected mission id and visible-window navigation semantics, plus coverage proving navigation has no board-command, workflow, filesystem, or Git write effect.
- Add a reusable, timeout-bounded PTY smoke harness and a real-terminal smoke test covering launch, navigation, resize, clean exit, and terminal-state restoration.
- Keep the PTY harness isolated from agents, Forgejo, workflow execution, and repository mutation; retain headless CLI and non-TTY Ink-isolation compatibility.

## Out of Scope
- Attention-queue behaviour reserved for TASK-2306 (Wave 4).
- Running, approving, cancelling, or otherwise executing workflow commands, reserved for TASK-2307 (Wave 5).
- Board analytics reserved for the later analytics wave.
- Changes to mission-detail projection semantics unrelated to making its existing data render in the TUI.
- Network-backed Forgejo integration, agent launches, and persistent repository writes from the PTY harness or navigation keys.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Keyboard input moves a selected mission deterministically across lanes and cards; tests cover horizontal wrapping or the defined horizontal boundary, vertical movement, empty lanes, and an overflowing lane’s selected id plus visible window.
- Both wide and narrow layouts visibly distinguish the focused selected mission from unselected cards, with component tests asserting the focus state rather than relying only on snapshots.
- The selected mission detail panel consumes the shared `mission-detail` projection and renders an explicit unavailable or stale-source state when that projection cannot provide current data.
- Tests prove that every navigation key changes only view state and does not issue a board command or workflow call, launch an agent, contact Forgejo, or write to the filesystem or Git repository.
- Each key reserved for a later action displays an explicit unavailable affordance and does not silently no-op or execute a workflow action.
- A reusable PTY smoke test drives a real terminal through launch, keyboard navigation, terminal resize, and clean exit; it enforces an explicit timeout and verifies terminal state restoration.
- PTY-harness tests prove the harness neither launches agents nor contacts Forgejo nor mutates the repository.
- The headless CLI compatibility suite and the non-TTY Ink-isolation test remain green.
- `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` complete successfully on the final tree, with no focused or unannotated skipped tests added.

## Risks and Assumptions
- Ink focus, resize, and cursor restoration can vary by terminal emulator; use a real PTY with deterministic dimensions, explicit timeout, and assertions on restored terminal state rather than timing-sensitive snapshots.
- Navigation rules can become ambiguous around empty lanes and ends of lanes; document the chosen boundary/wrap rule in test names and assert selected id and visible window for each case.
- The shared mission-detail projection may report absent or stale data differently from live board data; preserve the projection boundary defined by ADR 0051 and render its state explicitly rather than querying infrastructure from the TUI.
- Assumption: Wave 2’s read-only board supplies stable lane/card data and Wave 3 may add view-state wiring without expanding the application-command boundary.
- Assumption: existing test infrastructure can spawn a local PTY; if the CI runner cannot provide one, stop before substituting a fake terminal for the required real-PTY smoke coverage.

## Checkpoints
- CP 1: Map the Wave 2 board’s current data and rendering flow, define the navigation state model and boundary rules, and identify the existing non-TTY and headless compatibility tests plus the mission-detail projection integration point.
- CP 2: Implement and component-test selection movement, scrolling window, focus indication, detail-panel rendering, unavailable affordances, and the no-side-effects navigation boundary.
- CP 3: Build the reusable real-PTY harness and smoke coverage for launch, navigation, resize, clean exit, timeout, and terminal restoration; prove the harness has no agent, Forgejo, or repository-write capability.
- CP 4: Run the required verification gates, inspect changed tests for focused/unannotated skips, update graph metadata if source code changed, and record criterion-by-criterion final evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concrete summary of work done and a non-generic `Next action:` line at the bottom
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough: it is a weak-agent failure mode. It may appear only as supplemental context paired with at least one accepted reference above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not add attention-queue, workflow execution, approval, cancellation, analytics, or any other later-wave action.
- Do not bypass `src/application/projections/mission-detail.ts` by querying infrastructure, Forgejo, or Git directly from the Ink TUI; respect ADR 0051’s UI-neutral application boundary.
- Do not allow navigation or reserved-key handling to issue board commands, workflow calls, filesystem writes, Git writes, agent launches, or network calls.
- Do not make the PTY harness depend on a real Forgejo instance, agent process, or mutable repository fixture.
- Do not replace component semantic assertions with snapshots alone, or replace the required real-PTY smoke test with a simulated terminal-only test.

## Stop Rules
- Stop and request direction if the required navigation behaviour conflicts with Wave 2’s established selection/data model or requires changing the shared mission-detail projection contract.
- Stop and request direction if real-PTY testing cannot be made deterministic, timeout-bounded, and terminal-restoring in the supported test environment; do not weaken it to a fake-only smoke test.
- Stop and request direction if satisfying detail rendering requires a direct UI-to-infrastructure call, Forgejo access, agent launch, or repository mutation.
- Stop and request direction if a reserved future-action key cannot show an unavailable affordance without adding workflow execution capability.
