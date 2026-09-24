---
id: TASK-2550
title: The automatic revbounce requires human in the loop
status: backlog
assignee: []
created_date: '2026-09-21 13:44'
labels: []
dependencies: []
ordinal: 90008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Example
...

ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 47839.938562
Repository gate (integration): workflow passed.
Repository gate (integration): running agent-smoke...
  Command: node --import tsx test/e2e-real-agent-smoke.test.ts
  Checkout: /mnt/data/code/parallix-task-2547
[benchmark] runner=pi phase=draft duration_ms=73895 provider=pi model=AtomicChat/Ornith-1.5-35B-A3B-GGUF:Q4_K_M input_tokens=14329 tool_calls=11
[benchmark] runner=pi phase=active duration_ms=140923
﹣ real-agent smoke rejects an unsupported Codex override model (0.571271ms) # SKIP
✔ real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7) (233604.527081ms)
﹣ real Codex gpt-5.6-luna launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7) (0.110008ms) # SKIP
ℹ tests 3
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 2
ℹ todo 0
ℹ duration_ms 233612.162156
Repository gate (integration): agent-smoke passed.
[PASS] PRE-REVIEW GATE FAILURE repaired: the failing check re-ran and passed (attempt 1/1).
[PASS] Integration gate quality-gate repaired by custom and re-ran green (2/2 integration-gate rebounds spent).
[FAIL] The integration-gate repair changed task-2547 from the approved revision da85fd50ba6e5b2f62e099d5049b69b367090876 to 43ae53dfc93589ad1bb762a56ec9f38fe087f81e. The approval covers a revision that is no longer what would land, so the merge is not allowed on it.
[FAIL] task-2547 must go back through review: run px review task-2547 --start and have the repaired revision 43ae53dfc93589ad1bb762a56ec9f38fe087f81e re-reviewed before integrating again.
[FAIL] Aborting before merge.
magnus@debian:/mnt/data/code/parallix-task-2547$ px integrate
[FAIL] Mission task-2547 has a stored approval without the required provider approval. Refresh provider review state before integration.

---

In this scenario I would expect the rebounce to restart the review automatically and once approved continue the integration (this was started from a px integrate command)
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
