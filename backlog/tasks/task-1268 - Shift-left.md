---
id: TASK-1268
title: Shift left
status: backlog
assignee: []
created_date: '2026-06-09 04:22'
updated_date: '2026-06-26 18:00'
labels: []
dependencies: []
references:
  - lib/core/verification.js
  - lib/commands/integrate.js
  - lib/review/review-commands.js
  - lib/commands/handoff.js
priority: low
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
In order to save tokens, shift the integration quality gate that runs tests (on staging depedning on what changed) to before each review round, with mechanical send back to agent if gate does not pass (specific prompt for this)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The gate runs mechanically before each review round and its exit code on a pinned tree is the sole trusted signal that verification passed (agent textual claims are never trusted)
- [ ] #2 On gate failure the workflow auto-bounces to the implementer with a dedicated send-back prompt without consuming a reviewer cycle
- [ ] #3 Gate scope is selected from what changed (diff-scoped area) rather than always running 'all'
- [ ] #4 Closes the fail-open paths identified in TASK-1306 and TASK-1335: no phase can advance on an unproven gate
- [ ] #5 Regression tests cover gate-passes-advances and gate-skipped/failed-bounces-back
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Bug-reduction analysis (initiative #2). This directly attacks the largest historical bug cluster: hallucinated/fail-open gates where an agent claims tests ran when they didn't (TASK-1306 "fail integrate closed when gate not actually run", TASK-1335 "broken trees cannot reach main").

Key insight: most of the machinery already exists — `captureVerifiedTreeProof` / `assertVerifiedTreeProof` in lib/core/verification.js, used at integrate.js:686 and lib/tools/forgejo.js:429. The gate already runs at checkpoint (checkpoint.js:42), handoff (handoff.js:190), review --verify (review-commands.js:406), and integrate. What is missing is enforcement and shift-left:

1. The verification PROOF (gate exit code on a pinned commit/tree) becomes the ONLY source of truth for "tests passed" — the agent's textual claim is never trusted at any phase.
2. Run the gate mechanically BEFORE each review round, not just at integrate, and only when review-relevant files changed (the "on staging depending on what changed" idea = diff-scoped area selection; note the {{area}} machinery exists but is currently unused, defaultArea "all").
3. On gate failure, auto-bounce to the implementer with a fixed send-back prompt — no reviewer cycle consumed, no LLM tokens spent on a mechanical failure.

This both reduces bugs (~20-25% of the historical cluster) AND saves tokens (the original goal) by failing mechanically instead of via an LLM reviewer.
<!-- SECTION:NOTES:END -->
