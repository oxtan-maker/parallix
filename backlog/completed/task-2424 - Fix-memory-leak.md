---
id: TASK-2424
title: Fix memory leak
status: done
assignee: [codex]
created_date: '2026-08-28 03:42'
labels: [user_value, bug]
dependencies: []
ordinal: 122917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
after running the px ui for a while it crashes

<--- Last few GCs --->

[168582:0x17fda000] 16112692 ms: Scavenge 4088.9 (4097.8) -> 4088.4 (4102.1) MB, pooled: 0 MB, 6.62 / 0.00 ms  (average mu = 0.274, current mu = 0.365) allocation failure; 
[168582:0x17fda000] 16113653 ms: Mark-Compact (reduce) 4092.2 (4102.3) -> 4087.7 (4094.9) MB, pooled: 0 MB, 602.31 / 0.54 ms  (+ 290.7 ms in 58 steps since start of marking, biggest step 5.0 ms, walltime since start of marking 961 ms) (average mu = 0.336,
FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory
----- Native stack trace -----

 1: 0x73f8c4 node::OOMErrorHandler(char const*, v8::OOMDetails const&) [/home/magnus/.nvm/versions/node/v24.15.0/bin/node]
 2: 0xc06f90  [/home/magnus/.nvm/versions/node/v24.15.0/bin/node]
 3: 0xc0707f  [/home/magnus/.nvm/versions/node/v24.15.0/bin/node]
 4: 0xeaa885  [/home/magnus/.nvm/versions/node/v24.15.0/bin/node]
 5: 0xeaa8b2  [/home/magnus/.nvm/versions/node/v24.15.0/bin/node]
 6: 0xeaabaa  [/home/magnus/.nvm/versions/node/v24.15.0/bin/node]
 7: 0xebb8aa  [/home/magnus/.nvm/versions/node/v24.15.0/bin/node]
 8: 0xebfc50  [/home/magnus/.nvm/versions/node/v24.15.0/bin/node]
 9: 0x1953f71  [/home/magnus/.nvm/versions/node/v24.15.0/bin/node]
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
