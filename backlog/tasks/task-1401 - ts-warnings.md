---
id: TASK-1401
title: ts warnings
status: backlog
assignee: []
created_date: '2026-07-02 04:23'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
the js->ts missions did not result in clean ts, examples:

Command: ./scripts/verify-local.sh static-analysis
=== Static Analysis Gate ===
[1/3] Running ESLint...

/home/magnus/code/parallix-task-1400/lib/agents/agents.ts
  595:12  warning  'err' is defined but never used. Allowed unused caught errors must match /^_/u  no-unused-vars

/home/magnus/code/parallix-task-1400/lib/commands/config.ts
  7:12  warning  'msg' is defined but never used. Allowed unused args must match /^_|^name$/u   no-unused-vars
  8:14  warning  'msg' is defined but never used. Allowed unused args must match /^_|^name$/u   no-unused-vars
  9:13  warning  'code' is defined but never used. Allowed unused args must match /^_|^name$/u  no-unused-vars

/home/magnus/code/parallix-task-1400/lib/commands/coverage-gate.ts
  304:13  warning  'code' is defined but never used. Allowed unused args must match /^_|^name$/u  no-unused-vars

/home/magnus/code/parallix-task-1400/lib/commands/draft.ts
  491:14  warning  'error' is defined but never used. Allowed unused caught errors must match /^_/u  no-unused-vars

/home/magnus/code/parallix-task-1400/lib/commands/rebase.ts
  35:55   warning  'code' is defined but never used. Allowed unused args must match /^_|^name$/u  no-unused-vars
  38:417  warning  'code' is defined but never used. Allowed unused args must match /^_|^name$/u  no-unused-vars

/home/magnus/code/parallix-task-1400/lib/commands/resolve-conflict.ts
  50:55  warning  'code' is defined but never used. Allowed unused args must match /^_|^name$/u  no-unused-vars
  51:71  warning  'code' is defined but never used. Allowed unused args mu

fix all warnings and ensure the linter (if possible) promotes warnings to errors so they don't reappear.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
