# CP-1 — Inventory and contract boundary

## Summary

TASK-2220 is complete on this branch: integration commit `e625cadd9` is an ancestor of
`HEAD`, and its review-state implementation uses `writeFileAtomic` with structured,
fail-closed persistence outcomes. That contract does not conflict with TASK-2222.

The code-adjacent inventory classifies nine examined machine-written path families into
exactly one of the mission's five classes. The bounded migration tranche is session metadata
and NEL records. Review state remains owned by TASK-2220; the agent blocklist already uses the
approved JSON writer; user-authored Backlog Markdown, mutation outputs, workflow configuration,
and token files remain unmigrated for the reasons recorded in the inventory.

The CP-2 contract is one approved durable JSON entry point, `writeJson`, backed by
`writeFileAtomic`. The primitive must create parents, write UTF-8 in the destination directory,
preserve an existing destination's permission mode, atomically rename, remove its own temporary
file on every failure, and propagate filesystem errors. `writeJson` must serialize with exactly
one final newline. Injection is confined to the storage primitive's filesystem seam and caller
function seams; no second persistence API is authorized.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| TASK-2220 complete and compatible | `lib/review/review-state.ts:14`; `git merge-base --is-ancestor e625cadd9 HEAD` | PASS |
| SC1 five-class inventory covers required families | `lib/core/durable-state-inventory.ts:1`; `lib/core/durable-state-inventory.ts:17` | PASS |
| Session metadata classified and selected | `lib/core/durable-state-inventory.ts:19`; `lib/tools/sessions.ts:34` | PASS |
| NEL records classified and selected | `lib/core/durable-state-inventory.ts:26`; `lib/commands/handoff.ts:1082` | PASS |
| Generated mutation configuration excluded | `lib/core/durable-state-inventory.ts:61`; `lib/commands/mutation-gate.ts:243` | PASS |
| Token-bearing files retain dedicated restrictive policy | `lib/core/durable-state-inventory.ts:68`; `lib/tools/setup-review.ts:818` | PASS |
| Approved API boundary recorded | `lib/core/storage.ts:149`; `lib/core/storage.ts:157` | PASS |
| Governing dependency and fail-closed records | ADR 0036; ADR 0048 | PASS |

Next action: extend `lib/core/storage.ts` for mode-preserving, injectable atomic replacement and add the CP-2 fault-injection matrix in `test/storage.test.js`.
