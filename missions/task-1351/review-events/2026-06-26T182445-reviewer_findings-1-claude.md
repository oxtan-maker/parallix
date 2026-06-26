---
event_type: reviewer_findings
timestamp: 2026-06-26T18:24:45.639Z
round: 1
phase: reviewing
actor: claude
slug: task-1351
---

# Review Findings — task-1351: Fix opencode launcher model handling (-m flag)

## Summary

The core fix is correct, well-targeted, and independently verified. A new
`translateOpencodeModel()` helper normalizes config model identifiers to the
`provider/model` format opencode's `-m` flag requires, prepending `vllm/` to
prefix-less identifiers. All mission success criteria are met and the full
suite passes (1671 passing / 22 skipped, 0 failing).

However, the diff to `workflow.config.json` contains **two collateral,
out-of-scope, undisclosed changes** in a file the mission's Restricted Areas
section explicitly fences off. These need to be reverted before integration.

## What was verified (passing)

- **Core logic is correct.** `lib/agents/opencode.js:111-122` — known provider
  prefixes pass through; single-slash / no-slash identifiers get `vllm/`
  prepended; null/undefined/empty pass through. Wired in at
  `lib/agents/opencode.js:138` (`args.push('-m', translateOpencodeModel(model))`).
- **Investigation evidence (CP-1) independently reproduced.** Ran the real
  binary: `opencode models vllm` → `vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`.
  Confirms the claimed correct identifier format and the missing `vllm/` prefix
  diagnosis.
- **Regression tests present and meaningful.** `test/opencode.test.js:132-162`
  cover translation, pass-through, null-safety, and the end-to-end `-m` arg.
  Pre-existing tests updated consistently (`test/opencode.test.js:114`,
  `test/agents.test.js:1802`).
- **Custom entry restored.** `workflow.config.json:8` —
  `"custom": "cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit"`.
- **Gate passes.** `npm test` → 1671 passing, 0 failing, 22 skipped.
- **Checkpoint Goal Check tables** cite real file:line and test names that
  resolve correctly.

## Findings

### F1 (Medium) — Out-of-scope removal of `stateMap` config key (Restricted Area)
`workflow.config.json` diff removes
`"stateMap": "config/state-map.json"` from the `tasks` adapter:
```
-    "tasks": { "provider": "backlog-md", "storage": "backlog", "stateMap": "config/state-map.json" },
+    "tasks": { "provider": "backlog-md", "storage": "backlog" },
```
- This is a Restricted Area: MISSION.md line 68 — "Do not change the
  `workflow.config.json` adapter schema or add new config keys." Removing an
  existing key is an adapter-config change the mission did not authorize.
- It is **not disclosed** in any checkpoint (CP-2/CP-3 claim only the `custom`
  entry was restored).
- **Impact is functionally benign but not zero-risk:** with the key removed,
  `resolveStateMapPath()` (`lib/core/state-map.js:14-26`) falls through to
  `SHIPPED_STATE_MAP_PATH`, which resolves to the same `config/state-map.json`
  (confirmed present). So current behavior is preserved *only as long as that
  shipped file stays identical to the intended repo-relative one*. The change
  silently converts an explicit configuration into reliance on a fallback
  default — a maintainability/regression-surface regression with no benefit to
  the mission.
- **Action:** revert this line to restore the `stateMap` key; keep only the
  authorized `custom` addition.

### F2 (Low) — Broken indentation in `workflow.config.json`
The `"adapters":` key lost its 2-space indentation and now sits at column 0,
inconsistent with the rest of the file:
```
-  "adapters": {
+"adapters": {
```
JSON still parses, but this is an avoidable hand-edit formatting regression in a
checked-in config file. **Action:** restore the 2-space indent.

### F3 (Low / observational) — Checkpoint Goal Check omits collateral changes
CP-2 and CP-3 Goal Check tables describe the `workflow.config.json` change as
restoring the `custom` entry only. They do not disclose the `stateMap` removal
(F1) or the indentation change (F2). The checkpoint evidence is therefore
incomplete relative to the actual diff. Not independently actionable beyond
F1/F2, but noted because it weakens checkpoint trustworthiness.

## Notes (non-blocking)
- `translateOpencodeModel` defaults *any* unrecognized prefix-less identifier to
  the `vllm/` provider. That is the right call for this self-hosted setup and
  matches the mission's risk mitigation, but it is an implicit assumption worth
  a one-line comment caveat if other providers are ever added. The existing
  block comment at `opencode.js:102-110` is adequate for now.

---
`[workflow-round:1, workflow-phase:reviewing]`