# Mission: Fix active-stage stats breakdown so all stats tables represent it honestly (task-1409)

## Goal

Make the stats reporting views represent active-stage implementation performance honestly and consistently across all stats tables, using the copied `stat.csv` week snapshot in the backlog task as the source scenario. The mission must preserve the existing model-based breakdown where that is already correct. It must identify where the current reports distort, omit, or inconsistently transform the active-stage breakdown and fix that behavior so the rendered tables match the stored ground truth.

## Why Now

The backlog task provides a concrete week snapshot and says this is the honest implementation-performance distribution for the active stage:

```text
claude-opus-4-8                  5
claude-sonnet-4-6                1
claude-sonnet-5                  6
cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit 32
mistral                          1
```

That evidence is narrower than the earlier drafted mission claimed. The task does not say the bug is specifically "agent family vs model name", and the current codebase tests already show that model-based grouping is intentional in the affected summary tables. The model column is therefore not the bug to "fix". What the task does say is that the active-stage stats breakdown is not properly represented "in all tables in stats". This mission therefore starts by reproducing the mismatch from a fixture and only then fixes the concrete reporting logic responsible, without rewriting correct model-based behavior.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: Medium
- Selection note: activate as-is
- Main drivers: user-visible stats correctness; bug already evidenced by copied CSV-derived counts; reporting logic is localized and testable with fixtures

## Scope

- **In scope:**
  - Reproduce the active-stage reporting mismatch from a fixture derived from the backlog task's week snapshot.
  - Audit the stats report surfaces that summarize or display mission/activity breakdowns, including weekly, date-range, and single-mission stats views, and determine which of them misrepresent active-stage data.
  - Fix the report logic so active-stage implementation rows are represented consistently with the stored stats rows and with each other.
  - Update or add tests for every affected report surface.
  - Preserve current model-based grouping where existing tests and output prove it is already correct.

- **Out of scope:**
  - Inventing a new stats schema or adding new CSV columns unless the bug cannot be fixed without it.
  - Changing telemetry capture for draft/review/integration stages unless the reproduction proves the defect is in recording rather than reporting.
  - Reworking unrelated stats behavior such as closed-mission filtering, cost math, or review-round derivation.
  - Broad UX redesign of `px stats`; only correctness changes justified by the reproduction are allowed.
  - Replacing correct model-column behavior with agent-family grouping, or rewriting table semantics without reproduction-backed evidence.

## Success Criteria

1. A reproduction test built from the backlog task's active-stage scenario fails on the parent commit and passes after the fix.
2. The weekly stats report represents the active-stage breakdown honestly for the fixture data; it must not collapse, omit, or overcount the stored active-stage rows.
3. The date-range stats report represents the same fixture data consistently with the weekly report.
4. Any single-mission or per-phase stats table affected by the same root cause is updated so its active-stage row(s) are consistent with the corrected summary views.
5. Existing model-based report behavior that is already correct remains unchanged unless the reproduction proves that exact behavior is part of the bug.
6. Existing stats tests continue to pass after updating expectations to the corrected behavior.
7. `./scripts/verify-local.sh static-analysis` — pre-existing ESLint errors in other files; stats.ts clean (not declared as a gate due to pre-existing failures)

## Risks and Assumptions

- **Risk:** The backlog evidence proves a reporting mismatch but does not prove the exact failing function. Mitigation: lock the bug with a fixture before choosing the implementation path.
- **Risk:** More than one table may be wrong for different reasons. Mitigation: keep the reproduction centered on shared active-stage truth and update only the affected report paths.
- **Risk:** A drafter may misread the copied counts as evidence that model names are wrong. Mitigation: treat the copied values as valid model-level ground truth unless a test demonstrates otherwise.
- **Assumption:** The copied backlog numbers came from stored stats rows, not from an external post-processing step unavailable in this repo. If that assumption is false, stop and clarify before changing code.
- **Assumption:** The defect is most likely in stats rendering/aggregation, not in raw telemetry capture. If the reproduction points at write-time corruption instead, pause and re-scope the mission.

## Checkpoints

- **CP 1: Lock the bug.** Add a failing reproduction test at `test/stats-active-breakdown.test.js` that seeds stats rows for the backlog task's active-stage scenario and asserts the weekly/range output reflects the expected breakdown. The test must prove the current output is dishonest relative to the fixture.

Reproduction-Test: test/stats-active-breakdown.test.js

- **CP 2: Identify the real failure mode.** Trace which report helper(s) transform the active-stage rows incorrectly. Capture whether the issue is wrong filtering, wrong deduplication, wrong omission, wrong stage selection, or another representation bug. Do not treat model grouping itself as the bug unless the reproduction proves it.

- **CP 3: Fix the affected report path(s).** Implement the smallest code change that makes the affected tables represent the fixture honestly, and update any labels that no longer match the corrected behavior.

- **CP 4: Extend regression coverage.** Add or update tests for every report surface affected by the fix so the same mismatch cannot silently reappear in weekly, range, or mission-phase output.

- **CP 5: Run gates.** Run the required verification, including the `lib/` static-analysis gate.

## Gates

- [x] npm test

## Restricted Areas

- Do not change stats storage schema unless the reproduction proves representation cannot be fixed in reporting alone.
- Do not modify unrelated telemetry collectors for other agent families without direct evidence from the reproduction.
- Do not change backlog/task-state behavior or mission lifecycle commands.
- Do not broaden the mission into a general stats redesign.
- Do not change `summarizeAgentWindow` from model-first grouping to implementer/family grouping unless a reproduction test proves the current model grouping is itself incorrect.

## Stop Rules

- Stop if the active-stage mismatch cannot be reproduced from repo-local fixture data.
- Stop if the required fix depends primarily on undocumented assumptions about the copied `stat.csv` format rather than code-visible behavior.
- Stop if fixing the bug requires changing multiple independent subsystems outside stats reporting/aggregation; that indicates the mission needs re-scoping.
- Stop if the correct behavior is ambiguous after inspecting current outputs and tests; document the ambiguity and resolve it before implementation.
