---
id: TASK-2626
title: blocked agents get started even when they are blocked
status: done
assignee: [custom]
created_date: '2026-10-01 13:18'
labels: []
dependencies: []
ordinal: 149008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Running qwen to write the mission contract...
[INFO] Selected agent for step "draft": qwen
[INFO] Launching: qwen -p <prompt: 8748 chars> --output-format text
[INFO] Agent working directory: /mnt/data/code/parallix-task-2622.19
Warning: running headless with --yolo / approval-mode=yolo and no sandbox. All tool calls (shell, write, edit) auto-execute at this process's privilege level. Enable a sandbox via --sandbox / QWEN_SANDBOX, or set QWEN_CODE_SUPPRESS_YOLO_WARNING=1 to silence this notice.
[API Error: 403 Access to model denied. Please make sure you are eligible for using the model.]
[WARN] Model entitlement failure for qwen; model entitlement denied (scoped, no family block). Check the configured Qwen model and account entitlement, then retry.
[INFO] Selected agent for step "draft": vibe (attempt 2)
[INFO] Launching: vibe --prompt <prompt: 8748 chars> --trust --yolo --output text --workdir /mnt/data/code/parallix-task-2622.19 --add-dir /tmp
[

In this case web ui reported (correctly) that vibe was blocked for a month before this
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
