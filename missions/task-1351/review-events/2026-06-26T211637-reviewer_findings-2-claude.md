---
event_type: reviewer_findings
timestamp: 2026-06-26T21:16:37.808Z
round: 2
phase: reviewing
actor: claude
slug: task-1351
---

# Review Findings — task-1351 (Attempt 2): Fix opencode launcher model handling (-m flag)

## Summary

Attempt 2 resolves both round-1 blocking findings. The `workflow.config.json`
diff is now exactly the single authorized change (add the `custom` model entry);
the unauthorized `stateMap` removal and broken indentation are both reverted.
The core fix is unchanged, correct, and independently verified. All mission
success criteria are met and the full suite passes (1671 passing, 0 failing,
22 skipped). Approving.

## Round-1 findings — resolution

- **F1 (Medium) — `stateMap` key removal: RESOLVED.** `workflow.config.json:7`
  now reads
  `"tasks": { "provider": "backlog-md", "storage": "backlog", "stateMap": "config/state-map.json" }`.
  The key is restored.
- **F2 (Low) — broken indentation: RESOLVED.** `"adapters":` is back at the
  2-space indent (`workflow.config.json:6`), consistent with the file.
- **F3 (observational) — checkpoint disclosure:** moot now that the collateral
  changes are gone; the config diff matches the checkpoint description (custom
  entry restored).

The only remaining `workflow.config.json` change is the authorized one:
```
-    "agents": { "models": { "codex": "gpt-5.3" } },
+    "agents": { "models": { "codex": "gpt-5.3", "custom": "cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit" } },
```

## Verification

- **Core logic correct.** `lib/agents/opencode.js:111-122` `translateOpencodeModel`:
  known provider prefixes pass through; single/no-slash identifiers get `vllm/`
  prepended; null/undefined/empty pass through. Wired at `opencode.js:138`.
- **Identifier format verified against the real binary** (carried from round 1):
  `opencode models vllm` → `vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`.
- **Regression tests present** (`test/opencode.test.js:132-162`) plus consistent
  updates to pre-existing tests (`test/opencode.test.js:114`,
  `test/agents.test.js:1802`).
- **Gate passes.** `npm test` → 1671 passing, 0 failing, 22 skipped.
- **Final checkpoint (CP-3) Goal Check** cites real, resolvable file:line and
  test names; all rows verified.

## Note (non-blocking) — branch is behind main

`git diff main..HEAD` shows deletions of `missions/task-1352/*` and edits to a
few docs. These are **not** changes made by this mission — they are
branch-staleness artifacts. The branch diverged at merge-base `fb563a58`; `main`
has since advanced (e.g. `8b8bdfb0 mission/task-1352`, `ddf61077 Update task
TASK-1358`). No commit on `mission/task-1351` touches those paths
(`git log main..HEAD -- missions/task-1352/` is empty). Normal merge/rebase at
integration time resolves this; not a blocker. Reviewing the true mission diff
(`merge-base..HEAD`) shows only the opencode fix, tests, config line, and
mission artifacts.

## Verdict
All success criteria satisfied, verification credible, diff safe to integrate.
Approve.

---
`[workflow-round:2, workflow-phase:reviewing]`