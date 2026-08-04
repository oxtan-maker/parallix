# Mission: Copy graphify graph into mission worktree at draft time (task-2333)

## Goal
Ensure `graphify-out/graph.json` is available in a fresh mission worktree at the drafting step by copying it from the primary (main) worktree, so that graphify query/path/explain tools work when the draft agent starts.

## Why Now
When a new worktree is created by `px draft`, the `ensureGraphifyWorkspace()` step only creates an empty `graphify-out/` directory. The actual graph file (`graph.json`) lives in the primary worktree and is not tracked in git (it is gitignored). This means the draft agent starts with no graph to query — graphify query/path/explain are all no-ops, and the agent loses the codebase context the graph would provide.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: single-function update in `src/adapters/cli/commands/draft.ts`; adds a copy step inside `ensureGraphifyWorkspace()`

## Scope
- Update `ensureGraphifyWorkspace()` in `src/adapters/cli/commands/draft.ts` to copy `graph.json` (and any other graphify-out contents) from the primary worktree into the mission worktree's `graphify-out/` directory.
- The copy must be guarded: if `graphify` is not installed on the user's machine (or the primary worktree's `graphify-out/graph.json` does not exist), the step degrades gracefully — the empty directory is still created and draft proceeds.
- The copy must resolve the primary worktree using the existing `getPrimaryWorktree()` / `resolveMainRepo()` helper so it works from any calling context.

## Out of Scope
- Building or updating the graph during draft (that is the responsibility of `graphify update .` or the graphify hook).
- Modifying the graphify CLI tool itself.
- Changing the `.gitignore` or `.graphifyignore` behaviour.
- Modifying Parallix source code outside of `src/adapters/cli/commands/draft.ts`.

## Success Criteria
- SC1: `ensureGraphifyWorkspace()` copies `graphify-out/graph.json` from the primary worktree into the mission worktree when it exists.
- SC2: The copy step gracefully skips (no error, no abort) when `graphify` is not installed or when the primary worktree's `graphify-out/graph.json` is absent.
- SC3: The existing empty-directory creation behaviour is preserved when no graph to copy is found.
- SC4: The draft command still completes successfully in all cases (graph present, graph absent, graphify not installed).
- SC5: No Parallix source files outside `src/adapters/cli/commands/draft.ts` are modified.

## Risks and Assumptions
- The primary worktree's `graphify-out/graph.json` is the source of truth (assumed per AGENTS.md: graphify-out/ lives in the primary checkout).
- `getPrimaryWorktree()` is available and correctly resolves the main worktree path when `ensureGraphifyWorkspace()` runs (it is already used elsewhere in the draft flow).
- The graph file can be ~20 MB; copying it synchronously during draft adds a small but acceptable latency.
- Risk: if `graphify-out/` in the primary worktree contains subdirectories (e.g. `cache/`, `wiki/`), the copy should handle them — a directory copy or selective file copy is acceptable.

## Checkpoints
- CP 1: Update `ensureGraphifyWorkspace()` in `src/adapters/cli/commands/draft.ts` to copy `graphify-out/graph.json` from the primary worktree. The copy must be guarded by an existence check on the source file and must degrade gracefully when graphify is not installed.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g. `src/adapters/cli/commands/draft.ts:512` (must point to an existing file and line)
  2. **Test names** — e.g. `"ensureGraphifyWorkspace copies graph.json from primary worktree"` (must match a test name in the repo)
  3. **Test file paths** — e.g. `test/draft.test.ts` (must be an existing test file)
  4. **ADR references** — e.g. `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g. `` `./scripts/verify-local.sh all` ``, `` `graphify query` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Copies graph.json from primary worktree | `src/adapters/cli/commands/draft.ts:520` | PASS |
| Graceful skip when graphify not installed / graph absent | `src/adapters/cli/commands/draft.ts:525` | PASS |
| Empty-directory creation preserved when no graph found | `src/adapters/cli/commands/draft.ts:530` | PASS |
| No files outside draft.ts modified | `git diff --stat` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/` files other than `src/adapters/cli/commands/draft.ts` — no Parallix source code changes outside this file
- `test/` — no new tests required (behavior is testable via existing draft command tests; add a unit test if feasible but not required)
- `graphify-out/` — do not modify the graphify CLI tool or its output format
- `~/.claude/skills/graphify/` — do not modify the graphify skill

## Stop Rules
- Do not modify files outside `src/adapters/cli/commands/draft.ts`.
- Do not modify the graphify CLI tool or any Parallix source code beyond the copy step.
- Do not change the existing `ensureGraphifyIgnore()` or `ensureMissionFile()` behaviour.
- If resolving the primary worktree path from within `ensureGraphifyWorkspace()` proves difficult (e.g. the function lacks the needed dependency), pass the primary worktree path as a parameter from the draft command rather than calling `resolveMainRepo()` directly.
