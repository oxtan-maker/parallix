# Mission: Establish project Definition-of-Done defaults to enforce bug-reduction guardrails (task-1357)

## Goal

Define and commit a minimal, project-wide baseline set of Definition-of-Done defaults via `definition_of_done_defaults_upsert` that enforce bug-reduction guardrails across all missions. The committed set must be verifiable (no aspirational items), with each item annotated as gate-enforced or manual-checklist based on currently-available enforcement.

## Why Now

Parallix ships with a no-op Definition-of-Done default (`definition_of_done: []` in `backlog/config.yml`) so that when parallix is used to configure other products, it does not leak parallix's own quality expectations into those products. Parallix itself is the exception: when configuring itself, it should use DoD defaults. The project currently has zero DoD defaults (confirmed via `definition_of_done_defaults_get`), so every mission improvises its own completion checklist, meaning bug-reduction guardrails that should be universal are left to individual agent discretion. Three enforcement gates are already in flight (TASK-1268 shift-left verification, TASK-1353 deterministic static analysis, TASK-1354 regression-test-first for bug missions), and this mission sequences the DoD defaults to activate only when the corresponding gates are live, preventing the DoD from becoming an unverifiable wishlist.

## Refinement Signals

- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: Zero existing DoD defaults; urgent need for universal quality floor; three enforcement gates (TASK-1268, TASK-1353, TASK-1354) nearing completion and ready to drive DoD activation sequencing.

## Scope

- Audit current state: confirm zero DoD defaults via `definition_of_done_defaults_get`, review proposed items from backlog task description.
- Evaluate each proposed DoD item against three criteria: (a) universally applicable to all missions, (b) enforceable today (gate-enforced) or verifiable manually (manual-checklist), (c) minimal enough to avoid overloading every task.
- Classify proposed items:
  - Gate-enforced (enforcement tool exists): verification gate proof, lint/static analysis clean, no `.only`/unannotated `.skip` tests.
  - Manual-checklist (tool in-flight or absent): reproduction test for bug-labeled missions (awaiting TASK-1354), goal check table with real evidence (already in execute-prompt; promote to DoD default as manual-checklist until automation exists), docs-updated-on-behavior-change (promote to default as manual-checklist).
- Consult with teammates on the classified set (async review via PR or comment thread).
- Commit the agreed set via `definition_of_done_defaults_upsert`.
- Document which items are gate-enforced vs manual-checklist in a short companion note alongside the commit.
- Verify by creating a new task and confirming DoD defaults populate automatically via `backlog_task_create`.

## Out of Scope

- Building the enforcement gates themselves (TASK-1268, TASK-1353, TASK-1354 are separate tasks).
- Per-task DoD customization (`definitionOfDoneAdd`) — those remain mission-specific.
- Removing or modifying existing per-task DoD items.
- Changing the `definition_of_done_defaults_upsert` or `definition_of_done_defaults_get` tool implementations.
- Modifying the task creation workflow beyond verifying that defaults propagate.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC1: `definition_of_done_defaults_get` returns a non-empty array after the commit (falsifiable: returns empty or throws).
- SC2: The committed array contains between 4 and 8 items inclusive (falsifiable: count != 4..8).
- SC3: Every item in the array is a non-empty string of length 1–500 characters with no commas (falsifiable: any item violates these constraints).
- SC4: At least one item is labeled gate-enforced and at least one is labeled manual-checklist in the companion note (falsifiable: note lacks both labels).
- SC5: A newly created task (via `backlog_task_create` with no `disableDefinitionOfDoneDefaults`) inherits all items from `definition_of_done_defaults_get` as its initial DoD checklist (falsifiable: new task's DoD differs from defaults).
- SC6: No item in the defaults is phrased as a future-state aspiration (contains words like "when built", "once gate lands", "pending") — all items are actionable today (falsifiable: grep finds aspirational phrasing in any item).

## Risks and Assumptions

- Risk: Over-inclusive defaults slow down every new task. Mitigation: cap at 8 items; each item must pass the universal-applicability test.
- Risk: Enforcement gates (TASK-1268, TASK-1353, TASK-1354) slip past this mission's completion. Mitigation: classify dependent items as manual-checklist; revisit when gates land.
- Assumption: The companion note describing gate-enforced vs manual-checklist status lives in the same commit as the DoD defaults (e.g., as a comment in the config or a short docs file).
- Assumption: `definition_of_done_defaults_upsert` accepts up to 100 items (per schema); we target 4–8.
- Assumption: New tasks automatically inherit DoD defaults unless `disableDefinitionOfDoneDefaults: true` — verified by SC5.

## Checkpoints

- CP 1: Classification complete — each proposed item tagged as gate-enforced, manual-checklist, or deferred, with rationale.
- CP 2: Team review complete — classified set reviewed and approved (or modified) by stakeholders.
- CP 3: Committed and verified — `definition_of_done_defaults_upsert` called, `definition_of_done_defaults_get` confirms, new task inherits defaults.

## Gates

- [x] ./scripts/verify-local.sh docs

## Restricted Areas

- Do not modify any tool implementation (backlog, config, or workflow code).
- Do not alter existing tasks' DoD fields or acceptance criteria.
- Do not touch the enforcement gate implementations (TASK-1268, TASK-1353, TASK-1354 source code).
- Do not create new milestones or modify existing ones.
- Do not commit documentation outside the companion note for this mission.

## Stop Rules

- Stop if the proposed set exceeds 8 items after team review — revert to the smallest universally-applicable subset.
- Stop if any stakeholder raises a blocking concern about a default item's applicability — remove that item and proceed with the remainder.
- Stop if `definition_of_done_defaults_upsert` rejects the set due to schema violations — fix and retry, but abort if more than 2 retries fail.
- Stop if the verification step (SC5) fails and the root cause is a workflow bug (not a misconfiguration) — escalate rather than workaround.
