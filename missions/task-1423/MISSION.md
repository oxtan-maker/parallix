# Mission: Add explicit agent override flags to draft and active (task-1423)

## Goal
Make the operator-facing `draft` and `active` commands support the same kind of explicit per-invocation agent pinning that `review` already exposes, so a human can choose the draft agent or implementer from the CLI without relying on the global `WORKFLOW_AGENT` environment variable.

## Why Now
`px review` already accepts explicit reviewer/implementer overrides, which gives the operator deterministic control over a single run. `draft` and `active` are earlier lifecycle stages and currently need the same control surface for parity and debugging: when a mission needs a specific family for drafting or implementation, the operator should be able to express that at the command line instead of mutating global environment state. The change is narrow, lives at the command boundary, and should reuse the existing `startAgent` fallback/blocklist semantics instead of inventing new selection behavior.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: workflow parity with `review`, per-run operator control, reuse of existing agent-selection/fallback semantics

## Scope
- `lib/commands/draft.ts`: accept an explicit draft-agent CLI override, validate missing-value cases, and thread the chosen family into the existing draft launch path.
- `lib/commands/active.ts`: accept an explicit implementer CLI override, validate missing-value cases, and thread the chosen family into the existing execute launch path.
- Preserve existing bookkeeping after launch: the backlog assignee / implementer recording must still reflect the agent family that actually ran after any fallback, not merely the requested family.
- Update command-facing coverage in the existing draft/active lifecycle tests so the override path is exercised directly.
- Update operator documentation that describes agent selection precedence so `draft` and `active` examples are explicit and consistent with the implemented flags.

## Out of Scope
- Changes to the autonomous review loop, `px review` flag names, reviewer-state persistence, or any `lib/review/**` behavior beyond using it as the parity reference.
- Changes to the underlying `selectAgent` / `startAgent` selection algorithm, blocklist policy, model resolution, or limit-hit fallback rules.
- New environment variables, new config schema, or a broader redesign of how agent overrides are expressed across the product.
- Changes to mission-state transitions unrelated to recording the actual launched family in existing draft/active code paths.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `px draft <slug> --agent <family>` bypasses draft-step random selection for that invocation and passes `<family>` into the draft launch path; omitting the value after `--agent` exits non-zero and prints usage text containing `px draft <slug> --agent <family>`.
- `px active <slug> --implementer <family>` bypasses active-step random selection for that invocation and passes `<family>` into the execute launch path; omitting the value after `--implementer` exits non-zero and prints usage text containing `px active <slug> --implementer <family>`.
- If the requested family cannot actually run because existing launcher logic reroutes it (for example blocklist or limit-hit fallback), the task bookkeeping still records the family that actually launched: draft updates assignee via `recordDraftImplementer`, and active updates implementer/status via the existing launch/fallback recording path.
- Automated tests cover both command surfaces, including one direct draft test and one direct active test that assert the override flag reaches the launcher without depending on `WORKFLOW_AGENT`; any lifecycle/e2e test updates must continue to prove the explicit override survives a normal mission run.
- Operator docs state the supported draft and active override commands and explicitly say the CLI flags take precedence over config-driven random selection and over `WORKFLOW_AGENT`.
- No behavioral regression is introduced on the review surface: `px review --reviewer/--implementer` usage, review-loop identity persistence, and review-state semantics remain unchanged.

## Risks and Assumptions
- Assumption: explicit CLI overrides must continue to flow through the existing `startAgent` safety rules, meaning a pinned family can still be rerouted if it is blocked, unsupported, or hits a limit.
- Assumption: the intended command names are `--agent` for `draft` and `--implementer` for `active`, matching the current docs/examples rather than inventing review-style aliases.
- Risk: argument parsing in `draft.ts` must not break synthetic draft inputs or the existing slug/intent resolution path.
- Risk: active-path bookkeeping is stateful; a naive override change could record the requested family even when `startAgent` falls back to a different family.
- Risk: the repository may already contain part or all of this behavior. If so, the mission should close the remaining gap with tests/docs only rather than broadening scope.

## Checkpoints
- CP 1: Trace the existing override contract in `review`, then audit `draft.ts`, `active.ts`, and current tests/docs to confirm the exact parity gap and the intended flag names.
- CP 2: Implement or complete the `draft` override path, including missing-value handling, launcher wiring, and assignee recording after fallback.
- CP 3: Implement or complete the `active` override path, including missing-value handling, launcher wiring, and implementer recording after fallback.
- CP 4: Update operator-facing docs and automated tests, then run the mission gates.

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- `lib/review/**` and review prompts are reference material only for this mission; do not refactor or extend them as part of the draft/active change.
- `lib/agents/agents.ts` selection, blocklist, and fallback semantics must remain behaviorally unchanged unless a narrow bug fix is strictly required to honor the existing command contract.
- Backlog/task status mapping, integration flow, and stats/reporting outside the existing draft/active launch bookkeeping are not part of this mission.

## Stop Rules
- Stop if inspection shows `px draft --agent` and `px active --implementer` already work end-to-end with matching tests/docs, because the backlog task would then be satisfied already and needs closure or retargeting rather than more code.
- Stop if satisfying the request would require changing the established override semantics in `startAgent`/`selectAgent` (for example bypassing blocklists or disabling fallback), because that is a larger policy change than this mission allows.
- Stop if the only viable implementation would require renaming the public flags or introducing new config/env surfaces beyond the explicit CLI overrides described above.
