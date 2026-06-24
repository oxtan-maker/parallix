# Mission: Repair incorrect mission stats classification and phase telemetry display (task-1342)

## Goal
Fix the stats pipeline so `px stats` reports internally consistent mission counts and `px stats <mission>` no longer attributes OpenAI token telemetry to Claude phases that cannot provide token usage. The mission must cover the specific mixed-agent scenario described in the backlog task, where one mission is touched by Claude, qwen/opencode, and Codex across phases or retries, and the final tables still remain numerically correct and semantically accurate.

## Why Now
The current stats output is misleading in two user-visible ways. First, the weekly mission totals do not reconcile with the displayed classification subtotals, which makes the headline numbers untrustworthy. Second, mission phase telemetry can show Claude as the implementer while also showing OpenAI token usage that actually belongs to another agent or retry path. This undermines confidence in `px stats` as an operational tool for reviewing mission throughput, agent usage, and cost/usage attribution.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: non-reconciling weekly totals, corrupted per-mission phase attribution, mixed-agent mission handling bug

## Scope
- Trace how mission classification is written and how weekly totals are aggregated for `px stats`.
- Identify why `# missions` can exceed `# user value missions + # AI SDLC missions` in the weekly summary.
- Trace how per-phase telemetry is written, merged, and rendered for `px stats <mission>`, including missions where one agent starts, another retries, and a third completes or reviews.
- Fix the smallest set of stats-writing, stats-reading, or presentation code needed so classification counts reconcile and phase rows do not misattribute unsupported token telemetry to Claude.
- Add or update automated tests that reproduce:
  - a weekly summary case where total mission count and classified subtotals previously diverged
  - a mixed-agent mission telemetry case where Claude was shown with OpenAI token usage or duplicated usage totals
- Preserve the backlog task file and leave its `assignee` field unchanged.
- Keep the backlog task labels set to exactly `["user_value"]`.

## Out of Scope
- Redesigning the entire stats CSV schema unless a minimal schema adjustment is strictly required for the fix.
- Backfilling or rewriting historical stats rows outside what tests or isolated fixtures need.
- Changing how upstream agent CLIs expose usage data.
- Broad telemetry refactors unrelated to classification aggregation or mixed-agent phase attribution.
- Editing unrelated mission workflow files, task routing, or agent selection logic unless a direct dependency of the stats bug is proven.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

1. The root cause of the weekly count mismatch is identified with specific file references and a concrete explanation of how `# missions` became inconsistent with `# user value missions` and `# AI SDLC missions`.
2. The root cause of the corrupted `px stats <mission>` phase table is identified with specific file references and a concrete explanation of how mixed-agent execution caused Claude to appear with OpenAI token usage or duplicated totals.
3. After the fix, weekly summary logic counts each mission in exactly one of the two supported labels for this report, so the displayed `# missions` value equals `# user value missions + # AI SDLC missions` for the covered regression scenario.
4. After the fix, a covered mixed-agent telemetry scenario renders phase rows without attributing OpenAI token usage to Claude when the underlying phase did not produce Claude token telemetry.
5. Automated regression coverage exists for both failure classes:
   - one test for weekly mission classification/count reconciliation
   - one test for mixed-agent per-mission phase telemetry attribution
6. `npm test` passes after the changes with no newly introduced failures.
7. The backlog task frontmatter contains exactly one mission-type label, and it is `user_value`.

## Risks and Assumptions
- Assumption: The current bug can be fixed inside this repository without changing external agent providers or historical raw logs.
- Assumption: Weekly summary classification is intended to treat `user_value` and `ai_sdlc` as exhaustive categories for missions included in that subtotal report.
- Risk: The mismatch may come from older rows or partially migrated labels, so the code may need to define how unlabeled or malformed rows are handled without silently hiding them.
- Risk: Mixed-agent telemetry may be assembled from multiple fallback paths, making it easy to fix one display symptom while leaving duplicate aggregation underneath.
- Risk: The test suite may rely on fixtures that do not currently model Claude-plus-OpenAI mixed attribution, requiring new focused fixtures rather than small test edits.

## Checkpoints
- CP 1: Map the stats data flow for weekly classification counts and per-mission phase telemetry, then isolate the two concrete failure modes.
- CP 2: Reproduce both bugs in automated tests or fixture-driven coverage before changing production logic.
- CP 3: Implement the minimal fix so classification totals reconcile and mixed-agent phase attribution is no longer corrupted.
- CP 4: Run `npm test`, confirm the new regressions are covered, and verify the backlog label remains exactly `["user_value"]`.

## Gates
- [ ] Weekly mission total reconciliation bug is reproduced and fixed.
- [ ] Mixed-agent mission telemetry attribution bug is reproduced and fixed.
- [ ] Automated regression coverage exists for both behaviors.
- [ ] `npm test` passes.
- [ ] Backlog labels remain exactly `["user_value"]`.

## Restricted Areas
- Do not edit the backlog task `assignee` field.
- Do not rename, move, or delete `/home/magnus/code/parallix-task-1342/backlog/tasks/task-1342 - stats-bug.md`.
- Do not introduce any mission-type frontmatter field beyond the existing `labels` array.
- Do not broaden the mission into a full stats subsystem redesign.
- Do not change agent-specific telemetry collection code unless the investigation shows the stats bug cannot be fixed downstream in aggregation or presentation.

## Stop Rules
- Stop if the only credible fix requires unsupported historical backfill of existing production stats rows rather than correcting current read/write behavior.
- Stop if classification reconciliation depends on undocumented product decisions about whether unlabeled missions should count toward the weekly headline total; in that case, document the ambiguity and wait for direction.
- Stop if fixing the mixed-agent display bug would require inventing token telemetry for providers that do not expose it, rather than correcting attribution and presentation.
- Stop after the smallest change set that satisfies all success criteria; do not continue into unrelated cleanup or refactoring.
