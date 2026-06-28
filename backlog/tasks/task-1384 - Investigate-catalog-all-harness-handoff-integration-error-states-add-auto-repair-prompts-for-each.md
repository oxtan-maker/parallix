---
id: TASK-1384
title: >-
  Investigate & catalog all harness handoff/integration error states; add
  auto-repair prompts for each
status: backlog
assignee: []
created_date: '2026-06-28 11:30'
labels:
  - harness
  - reliability
  - investigation
dependencies: []
references:
  - 'lib/commands/handoff.js:429'
  - 'lib/commands/repair-handoff.js:105'
  - 'lib/commands/active.js:453'
  - backlog/tasks/task-1381 - I-keep-getting-strange-errors-in-px.md
  - backlog/completed/task-1348 - local-blocklist-does-not-get-updated.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Problem

The automated mission harness (px handoff → gatekeeper → declared gates → integrate) has multiple terminal error states where it **blocks and strands the run**, forcing the human to manually prompt to continue. The auto-repair engine (`lib/commands/repair-handoff.js:105-127`) only recognizes **two** repairable classes — dirty working tree and branch-behind-remote — and bails on everything else with "Handoff error is not automatically repairable".

### Triggering incident (task-1372)
Handoff failed on a declared gate that was authored as prose, not a command:
```
[FAIL] Declared gate "npm run typecheck (tsc --noEmit) reports zero errors" failed:
       bash: -c: syntax error near unexpected token '('
```
The gate runner (`lib/commands/handoff.js:runDeclaredGates`, ~line 429) strips the `- [ ]` checkbox and executes the **entire remaining line verbatim** via `bash -c`. The `(` was a bash syntax error; even prose-only gates like `npm test passes with zero new failures` silently ran `npm test` with garbage trailing args. The underlying work (typecheck/tests) was actually green — only the gate text was malformed. Fixed in-mission by rewriting MISSION.md gates as runnable commands.

Same run also surfaced:
```
[px] ERROR: target directory '/tmp/integrate-v2-root' not found.
```
from the outer `px integrate` orchestrator (not in this repo's lib/scripts). Previously seen in task-1348 and task-1381.

## Goal
Produce a complete catalog of harness error/blocking states across the handoff → integrate pipeline, classify each as auto-repairable vs. requires-human, and drive child tickets that add an automatic error-fixing prompt/relaunch path for each repairable class so the harness self-heals instead of stranding the run.

## Known error states to catalog (seed list — expand during investigation)
1. **Declared gate failure — malformed gate (prose, not command).** `bash -c` syntax error or wrong-args false pass. See `handoff.js:runDeclaredGates`. Needs: validate gates at authoring/handoff time + fail with an actionable message + repair path.
2. **Declared gate failure — genuine (test/typecheck/lint red).** Currently non-repairable; should relaunch the implementer agent with the gate output as a fix prompt.
3. **`integrate-v2-root` target directory not found.** `px integrate` expects `/tmp/integrate-v2-root`. Recurs (task-1348, task-1381). Needs root-cause + create-or-skip handling.
4. **Gatekeeper: missing mandatory artifacts** (MISSION.md / CP-*.md / nel-record). Blocks handoff; should prompt agent to generate missing artifacts.
5. **Generic "not automatically repairable" fall-through** in `repair-handoff.js` — only dirty + behind covered. Everything else strands.
6. **Stale push / non-fast-forward** (already partly handled — confirm coverage).

## Acceptance
- A documented catalog (this ticket's final summary or a doc) of every harness terminal error state with: trigger, source location, current behavior, and target auto-repair behavior.
- Child tickets created for each repairable class with a concrete auto-repair/relaunch prompt design.
- Cross-linked with task-1381 and task-1348.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Complete catalog of harness terminal error states documented with trigger + source location + current vs target behavior
- [ ] #2 Each auto-repairable error class has a child ticket with a concrete relaunch/fix-prompt design
- [ ] #3 Cross-linked to task-1381 and task-1348
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
