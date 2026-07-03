---
id: TASK-1409
title: stat fixes
status: done
assignee: [codex]
created_date: '2026-07-03 05:34'
labels: ["user_value", "bug"]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Based on when I copied stat.csv for parallix (data set for the week 

task-1354
task-1355
task-1358
task-1378
task-1372
task-1384
task-1269
task-1385
task-1394
task-1398
task-1400
task-1407
task-1360
task-1362
task-1363
task-1365
task-1366
task-1367
task-1376
task-1377
task-1379
task-1381
task-1368
task-1373
task-1382
task-1369
task-1371
task-1364
task-1370
task-1374
task-1288
task-1358
task-1395
task-1397
task-1269
task-1380
task-1385
task-1387
task-1388
task-1389
task-1390
task-1401
task-1405
task-1406
task-1403)

I see that this should be the honest agent performance w.r.t. implementation on active stage numbers:

claude-opus-4-8	5
claude-sonnet-4-6	1
claude-sonnet-5	6
cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit	32
mistral 1

ensure stats breakdown on active is properly represented in all tables in stats
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [x] #2 Lint and static analysis report clean on every changed file
- [x] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [x] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [x] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
