# Mission: Rebuild `px active` around execution trust, not workflow narration (task-2476)

## Goal
Make the default `px active` execution-to-handoff output tell an operator one trustworthy story: identify the mission and actual implementer, show real streamed implementation work, report meaningful repository verification, and explicitly begin independent review. The first-value demo must prove verification against the greeting behavior it displays.

## Why Now
The current first-value recording exposes preflight and handoff mechanics instead of outcomes, repeats agent information, and presents an unconditional-success demo verifier as verification evidence. It also labels a `hello.sh` change as `docs`, which is not trustworthy without a semantic justification. TASK-2471 showed that merely hiding logs does not repair this information model.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: operator-facing active/handoff projection, shared agent-launch behavior, deterministic demo verification, focused regression coverage, and real cast/GIF replay closure

## Scope
- Default `px active` presentation from active preflight through autonomous-review start.
- Presentation of execution-agent selection, actual fallback-agent selection, live agent streaming, implementation completion, repository verification, and review transition.
- The first-value demo verifier, verification-area presentation, cast, rendered GIF, and focused active/handoff tests needed to support this behavior.
- Real-agent replay using an isolated `PARALLIX_HOME`, including iterative remediation of every in-scope defect found in the raw cast or rendered GIF.

## Out of Scope
- Reviewer findings or verdict output after review begins (TASK-2477).
- Implementer handling of reviewer findings (TASK-2478).
- `px integrate` presentation (TASK-2479).
- Redesign of TASK-2471’s draft summary, except a necessary shared-launch regression fix.
- Changes that weaken verification, lifecycle, persistence, recovery, or failure visibility.
- A general reporting framework when a local active/handoff change suffices.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

1. A final real `px active` recording identifies the mission and the actual implementing agent before streamed agent work begins.
2. On the normal selected-agent path, the recording announces the implementer once; a selected-to-fallback-agent change remains explicitly visible when it occurs.
3. The final recording preserves live implementation-agent streaming and explicitly states implementation completion, successful repository verification, and the start of independent review.
4. Normal successful output contains no numbered handoff steps, nested status prefixes (`[INFO] [INFO]` or `[INFO] [PASS]`), or operator-facing proof-hash, SQLite-transition, task-synchronization, graph-absence, disabled-provider, NEL-persistence, or routine-PWD narration.
5. Failure, repair instruction, rebase conflict, missing-artifact, and fallback/degraded conditions remain visible rather than being hidden by log-level changes.
6. The demo verifier fails against the seeded broken `hello.sh` state and passes only after the shown greeting behavior is corrected; it does not use `exit 0`, `true`, or another unconditional-success command.
7. The final demo does not present `docs` as verification evidence for the `hello.sh` change unless the implementation establishes that classification as semantically correct.
8. The final `docs/assets/first-value-demo.cast` is produced by a real configured-agent run on the final tree, and its rendered GIF has been visually inspected after the final recording.
9. Focused active/handoff tests and `./scripts/verify-local.sh all` pass on the final tree.
10. The final checkpoint contains `## Demo Replay Findings` with every defect observed during the real replay, its disposition, and durable evidence for the final clean replay.

## Risks and Assumptions
- Real configured agents and the recording renderer may expose timing, PTY, environment, or provider behavior absent from unit tests; treat the raw cast and GIF as acceptance evidence and repeat the replay loop until all in-scope findings are resolved.
- Existing focused tests may encode implementation narration; update assertions only when they conflict with the required operator story, never to hide a genuine warning or lifecycle failure.
- Verification-area inference may be shared with other workflows; change only the presentation or inference needed to make the demo truthful, preserving existing lifecycle semantics.
- The demo repository remains disposable and can deterministically demonstrate a broken greeting followed by a repaired greeting.

## Checkpoints
- CP 1: Replay the existing `docs/assets/first-value-demo.cast` and rendered GIF before code changes. Record each active/handoff defect, then add focused characterization coverage for the required operator story and the observed defects.
- CP 2: Rework the active story to present mission, actual implementer, live work, and implementation completion. Retain loud failure behavior and explicit selected-to-fallback-agent reporting.
- CP 3: Rework verification and handoff to present real repository verification, its result, and independent-review start. Replace the demo’s unconditional verifier and capture its broken-state failure and repaired-state pass.
- CP 4: Run `scripts/record-first-value-demo.sh` with real configured agents and isolated `PARALLIX_HOME`; inspect the raw cast, render and inspect the GIF, document every finding and disposition, repair all in-scope findings, and repeat until the final replay has none.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section using exactly this table header: `| Criterion | Evidence | Status |`
- At least one durable evidence row per success criterion, led by exact test names, ADR references, test file paths, or recognized repository commands and paths such as `npm ...`, `node ...`, `git ...`, `px ...`, and `./...`. File:line references are accepted parenthetically but discouraged because line numbers rot.
- For replay closure, cite `docs/assets/first-value-demo.cast`, the rendered GIF path, `scripts/record-first-value-demo.sh`, the exact focused test names or test paths, and the commands used for the red and green verifier states.
- Raw `stat`/`ls` output or generic prose alone is not evidence; pair any shell output with an accepted command, path, exact test name, or ADR reference above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/record-first-value-demo.sh
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change reviewer-finding, reviewer-verdict, reviewer-response, or integration presentation owned by TASK-2477 through TASK-2479.
- Do not remove or demote genuine warnings, failures, repair instructions, rebase conflicts, missing-artifact reports, or fallback/degraded status solely to improve normal-path output.
- Do not fake agent streaming, inject canned PTY output, or replace behavioral verification with an unconditional-success verifier.
- Do not alter workflow ownership, mission lifecycle, persistence, or recovery semantics except where a minimal active/handoff presentation change requires it.

## Stop Rules
- Stop and request direction if satisfying the operator story requires redesigning the general reporting architecture rather than a local active/handoff change.
- Stop and request direction if a truthful verification-area label for the demo requires a cross-workflow policy change outside `px active`.
- Stop and request direction if real configured agents, an isolated `PARALLIX_HOME`, or the cast/GIF renderer cannot run after documenting the exact failure with durable command or path evidence.
- Do not close the mission while the raw cast or rendered GIF has an unresolved in-scope warning, contradiction, duplicate, malformed prefix, wrong identity, false verification claim, wrong area, renderer issue, or hidden lifecycle failure.
