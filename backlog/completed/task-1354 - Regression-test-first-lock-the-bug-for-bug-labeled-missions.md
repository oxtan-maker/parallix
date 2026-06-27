---
id: TASK-1354
title: Regression-test-first ("lock the bug") for bug-labeled missions
status: done
assignee: [claude]
created_date: '2026-06-26 17:59'
labels:
  - ai_sdlc
dependencies: []
references:
  - prompts/draft.md
  - prompts/execute.md
  - lib/tools/gatekeeper.js
  - lib/commands/handoff.js
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bug-reduction initiative #3. Fixes currently don't always stick — TASK-1317 was minted twice and the same "task-id recycling collision" class recurred (TASK-1319/1322), the signature of fixing forward without a locking test. Require any mission labeled `bug` to commit a FAILING reproduction test before the fix, and prove red→green mechanically.

Mechanism: the draft prompt (prompts/draft.md) instructs bug missions to author a reproduction test first; the execute prompt requires it committed before the fix; and the handoff/gatekeeper gate proves the test fails at the mission parent commit and passes at HEAD. A bug mission cannot hand off without a red→green proof.

Note (per operator): this is substantially a draft-prompt change — the reproduction-first contract is authored at draft time — but enforcement must live in the gate (prompts alone are not trusted; cf. the hallucinated-gate class TASK-1306/1335). Estimated 10-15% reduction concentrated on recurring/expensive bugs. Pair with mutation-score ratchet (TASK-1269) so the repro can't be a trivially-passing shallow test.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The draft prompt requires bug-labeled missions to specify a failing reproduction test as the first checkpoint
- [ ] #2 The execute prompt requires the reproduction test committed before the fix commit
- [ ] #3 The handoff/gatekeeper gate verifies the reproduction test fails at the mission parent commit and passes at HEAD, and blocks handoff otherwise
- [ ] #4 Non-bug missions and repos without a declared gate are unaffected
- [ ] #5 A regression test covers both the red→green pass case and the missing-repro block case
<!-- AC:END -->
