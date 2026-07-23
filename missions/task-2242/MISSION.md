# Mission: Variant B integration tolerates concurrent backlog-only changes (task-2242)

## Goal
Make Variant B (local squash-merge) integration survive when the base branch (`main`) changes mid-integration with backlog-only updates, without hiding real merge conflicts or losing either the mission's or the base branch's task updates.

## Why Now
The dry-run probe merge (`git merge --no-commit --no-ff`) in Step 2 of Variant B fails with an unabortable conflict when `main` receives backlog-only commits between the preflight check and the squash step. This forces operators to manually retry `px integrate` after every backlog update on `main`, breaking the automation loop for teams with frequent backlog activity. The error surface is `[FAIL] Dry-run merge could not be aborted cleanly. Inspect the local integration checkout before retrying integrate.` — which gives no signal that the root cause is harmless backlog drift.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: conflict classification logic in probe-merge; retry/rebase sequence; test fixture for concurrent backlog drift

## Scope
- Add a "backlog-only conflict" classification after the Step 2 probe merge detects conflicts
- If all conflict files are under `backlog/` (matching the noise-path pattern used by `softResetTrailingBacklogNoise`), re-fetch the base branch and retry the probe merge once
- On retry success, proceed to Step 3 (squash-merge) with the updated base
- On retry failure or non-backlog conflicts, fall through to the existing conflict-resolution flow (fail closed)
- Add a dedicated test fixture that simulates mid-integration backlog-only base-branch changes
- Add tests for: (a) backlog-only drift succeeds after retry, (b) overlapping code conflicts still fail with conflict details, (c) overlapping mission/task-file conflicts still fail

## Out of Scope
- Automatic discard, stash-pop, or overwrite of arbitrary base-branch changes
- Handling of concurrent changes to `agents.local.json`, `graphify-out/`, or `.workflow/` artifacts during integration
- Variant A (if any) or non-merge-based integration paths
- Changes to the preflight overlap-check logic (`printIntegrationPreflight`) — that layer already flags backlog overlaps as FAIL; this mission targets the Step 2 probe-merge path
- Forgejo sync-merged retry logic or PR branch cleanup

## Success Criteria
- SC1: Probe merge at `src/platform/runtime/lib/commands/integrate.ts` classifies conflict files as "backlog-only" when every conflict path matches `^backlog/` and retries the dry-run merge after re-fetching the base branch
- SC2: A new test file `test/task-2242-backlog-drift.test.ts` contains at least three assertions: (a) backlog-only conflict files trigger a retry and the integration proceeds to squash, (b) a conflict in a non-backlog file (`src/platform/runtime/lib/commands/handoff.ts`) fails with the existing conflict-resolution output, (c) a conflict overlapping the mission's own backlog task file fails with overlap details
- SC3: The existing `softResetTrailingBacklogNoise` path in Step 3 remains unchanged — its noise-patch capture/reset/restore cycle is not modified
- SC4: No new focused tests (`.only`) or unannotated skipped tests (bare `.skip`) are introduced
- SC5: `./scripts/verify-local.sh all` passes on the final tree

## Risks and Assumptions
- Risk: The re-fetch + retry adds latency to integration. Mitigation: limit to one retry; log the retry event clearly
- Risk: A backlog file that also appears in the mission branch could produce a real content conflict (both sides edited the same task file). Mitigation: the retry re-reads the current base, so the second probe merge will still conflict if the overlap is real — it will then fail closed with conflict details
- Assumption: The noise-path pattern (`^backlog/`) used by `softResetTrailingBacklogNoise` and `findLastNonNoiseCommit` is the correct classifier for "backlog-only" changes
- Assumption: `git merge --abort` can reliably undo a probe merge that conflicted only in `backlog/` files; if the abort itself leaves index entries, the retry path handles them

## Checkpoints
- CP 1: Deterministic concurrent-change fixture — create `test/task-2242-backlog-drift.test.ts` with a mock gitRunner that simulates: (a) first probe merge returns backlog-only conflicts, (b) base branch is re-fetched, (c) second probe merge succeeds. Verify the conflict classification logic and retry path in isolation.
- CP 2: Narrow retry/rebase implementation — update the Step 2 probe-merge block in `integrate.ts` (around line 733) to parse conflict files, check if all are under `backlog/`, and if so, re-fetch base and retry once. Preserve the existing abort + fail-closed flow for non-backlog conflicts.
- CP 3: Integration regression suite — add test cases for overlapping code conflicts (non-backlog file), overlapping mission task-file conflicts, and the happy path where the probe merge succeeds on first try. Run `./scripts/verify-local.sh all` to confirm.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `src/platform/runtime/lib/commands/integrate.ts:733` (must point to an existing file and line)
  2. **Test names** — e.g., `"backlog-only conflict files trigger retry and proceed to squash"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2242-backlog-drift.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `npm run test:integration` ``, `` `node --import tsx test/task-2242-backlog-drift.test.ts` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Probe merge classifies backlog-only conflicts | `src/platform/runtime/lib/commands/integrate.ts:740`, conflict classification block | PASS |
| Retry test passes for backlog-only drift | `test/task-2242-backlog-drift.test.ts`, `"backlog-only conflict files trigger retry and proceed to squash"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- `src/platform/runtime/lib/core/mission-utils/merge-noise.ts` — the existing noise-detection utilities (`findLastNonNoiseCommit`, `softResetTrailingBacklogNoise`, `parseConflictFilesFromMergeOutput`) are not to be modified; the new classification logic is added in `integrate.ts`
- `src/platform/runtime/lib/commands/integrate.ts` lines 780–820 (Step 3 squash-merge + noise-patch capture/restore) — the noise-patch cycle is out of scope
- `src/platform/runtime/lib/tools/backlog.ts` — backlog task resolution and closeout logic is unchanged
- `config/integration-pipelines.json` — no gate configuration changes

## Stop Rules
- Do not automatically discard, stash-pop, or overwrite arbitrary base-branch changes; fail closed on source, configuration, or overlapping task-file conflicts
- Do not modify the preflight overlap-check (`printIntegrationPreflight`) or the Step 3 noise-patch cycle
- Do not add retry logic for more than one attempt; if the second probe merge also conflicts, fall through to the existing conflict-resolution flow
- Do not introduce new dependencies or CLI flags for this feature; the retry is automatic and transparent to the operator
