# Mission: Fix classification label sync from mission worktree to base worktree (task-2312)

## Goal

Make the integration preflight reliably find classification labels (`ai_sdlc`, `user_value`, or `unknown`) on the backlog task file, so that missions no longer fail at the `[FAIL] Backlog classification` gate with "Missing or invalid classification".

## Why Now

Every mission over the last 2–7 days has been blocked at integration preflight because the draft agent writes classification labels into the mission worktree's copy of the backlog task file, but the integration preflight reads from the base worktree (primary repo on the base branch). The labels never reach the base worktree, so `getTaskClassification` returns `null` and the preflight aborts with:

```
[FAIL] Backlog classification: Missing or invalid classification for task-2311; expected exactly one of ai_sdlc, user_value, or unknown in the labels of /home/magnus/code/parallix/backlog/tasks/task-2311 - after-pi-tech-change-console-is-empty.md.
```

This is a systematic regression — not a one-off task-file issue — because the worktree split pattern guarantees the two copies diverge after the draft agent writes.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one new utility function in `backlog.ts`, one sync call in `draft.ts`, one regression test in `test/`

## Scope

- **`src/platform/runtime/lib/tools/backlog.ts`**: Add `setTaskLabels(taskFilePath, labels)` that writes a label array to the `labels` frontmatter field, supporting both inline (`labels: [a, b]`) and block (`labels:\n  - a`) YAML formats. Export the function.
- **`src/platform/runtime/lib/commands/draft.ts`**: After `normalizeDraftClassification` validates labels in the mission worktree, read those labels and write them to the base worktree's task file using `setTaskLabels`. Commit the change on the base worktree.
- **`test/`**: Add a regression test file (`test/task-2312-label-sync.test.ts`) that verifies:
  1. `setTaskLabels` writes inline format correctly
  2. `setTaskLabels` writes block format correctly
  3. `getTaskClassification` returns the expected value after `setTaskLabels` writes
  4. The draft post-validation sync writes labels to the base worktree

Reproduction-Test: test/task-2312-label-sync.test.ts

## Out of Scope

- Changes to `getTaskLabels` or `getTaskClassification` parsing logic (those are correct; the bug is a sync gap)
- Changes to `restoreAuthoritativeTaskLifecycle` (labels are not lifecycle fields)
- Changes to the integration preflight check itself
- Changes to the draft agent prompt or classification instructions
- Any work on `mission-start.ts` classification resolution (that was task-2200)

## Success Criteria

- SC1: `setTaskLabels` in `backlog.ts` writes the inline format `labels: [ai_sdlc, bug]` when the input array is `['ai_sdlc', 'bug']` and the file uses inline YAML.
- SC2: `setTaskLabels` writes the block format (`labels:\n  - ai_sdlc\n  - bug`) when the file already uses block YAML.
- SC3: `getTaskClassification` returns `'ai_sdlc'` for a file written by `setTaskLabels(['ai_sdlc', 'bug'])`.
- SC4: The draft command's post-validation step copies labels from the mission worktree task file to the base worktree task file.
- SC5: After the post-validation sync, `getTaskClassification` on the base worktree task file returns the same classification as on the mission worktree task file.
- SC6: The regression test file `test/task-2312-label-sync.test.ts` passes with `node --test test/task-2312-label-sync.test.ts`.
- SC7: `./scripts/verify-local.sh all` passes on the final tree.

## Risks and Assumptions

- **Risk**: The base worktree may not have the task file if the task was only created in the mission worktree (synthetic tasks). Mitigation: the bootstrap step copies the task to the mission worktree from the main repo, so the base worktree already has it.
- **Assumption**: `resolveBaseWorktree(slug, { rootDir: targetWorktree })` reliably resolves the base worktree path from the mission worktree. This is already used by `transitionTaskOnIntegrationBranch` and proven stable.
- **Assumption**: The inline YAML regex `^labels:[ \t]*\[.*\]$` matches the format the draft agent produces. This is the same format used by `getTaskLabels` and `bootstrapBacklogTask`.
- **Risk**: If the task file in the base worktree uses block format but the mission worktree uses inline (or vice versa), `setTaskLabels` should preserve the existing format. Mitigation: the new function detects the existing format and writes in the same style.

## Checkpoints

- CP 1: Author a failing reproduction test (`test/task-2312-label-sync.test.ts`) that locks the bug before any fix is written. The test must:
  - Create a temp repo with a task file in the "mission worktree" (labels set by draft agent) and a separate task file in the "base worktree" (labels empty `[]`).
  - Assert that `getTaskClassification` on the mission worktree file returns a valid classification.
  - Assert that `getTaskClassification` on the base worktree file returns `null` (red — this is the bug).
  - The test must fail at the parent commit and pass once the fix lands.

- CP 2: Implement `setTaskLabels(taskFilePath, labels)` in `src/platform/runtime/lib/tools/backlog.ts`. Export the function. Add unit tests for inline and block format writing.

- CP 3: Add the post-draft label sync in `src/platform/runtime/lib/commands/draft.ts`. After `normalizeDraftClassification` validates labels on the mission worktree, read labels with `getTaskLabels`, resolve the base worktree with `resolveBaseWorktree`, resolve the base worktree task file with `resolveTaskFile`, write labels with `setTaskLabels`, and commit with `commitTaskFileUpdate`.

- CP 4: Update the reproduction test from CP 1 to also verify the sync behavior (green). Run `./scripts/verify-local.sh all`.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| setTaskLabels writes inline format | `src/platform/runtime/lib/tools/backlog.ts:860`, `test/task-2312-label-sync.test.ts`, `"setTaskLabels writes inline format correctly"` | PASS |
| Post-draft sync copies labels to base worktree | `src/platform/runtime/lib/commands/draft.ts:355`, `test/task-2312-label-sync.test.ts`, `"draft post-validation sync writes labels to base worktree"` | PASS |
| Verification gate ran | `` `./scripts/verify-local.sh all` `` | PASS |

## Gates

- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- `src/platform/runtime/lib/commands/integrate.ts` — the preflight check logic is not modified; the fix is in the data path, not the validation path.
- `src/platform/runtime/lib/commands/mission-start.ts` — classification resolution there was fixed in task-2200; do not touch.
- `src/platform/runtime/lib/commands/stats.ts` — `resolveMissionClassification` is a consumer, not the source of the bug.
- `src/platform/runtime/lib/commands/review.ts` and `src/platform/runtime/lib/review/` — review flow is not in scope.
- `prompts/draft.md` — the classification instructions in the draft prompt are correct; the bug is in the sync step, not the prompt.

## Stop Rules

- If `resolveBaseWorktree` throws or returns a path that does not contain the task file, log a warning and continue without the sync (do not block the draft).
- If `setTaskLabels` fails (file not found, write error), log a warning and continue (the draft agent already validated the labels on the mission worktree).
- Do not modify `getTaskLabels` or `getTaskClassification` — the parsing logic is correct and tested.
- Do not add a new frontmatter field for mission type — labels are the only mechanism.
- If the base worktree task file does not have a `labels` field at all, `setTaskLabels` should insert it after the `created_date` field (same position as `bootstrapBacklogTask`).
