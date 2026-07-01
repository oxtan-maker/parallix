# CP-1: Current-state check inventory

Existing harness checks and current repair/send-back behavior documented with code references and failure coverage.

## Inventory of Existing Checks

### Phase 1: Before Handoff (checkpoint time)

| Check | File:Line | Failure Class Caught |
|-------|-----------|---------------------|
| Verification gate runs at checkpoint | `lib/commands/checkpoint.js:44` | Unverifiable "tests passed" claims — gate exit code is the signal, not agent prose |
| `--no-gate` bypass available | `lib/commands/checkpoint.js:41` | None (intentional escape hatch) |

### Phase 2: During Handoff (`performHandoff`)

| Check | File:Line | Failure Class Caught |
|-------|-----------|---------------------|
| Mission branch check | `lib/commands/handoff.js:37-39` | Mechanical git blocker — wrong branch |
| MISSION.md existence | `lib/commands/handoff.js:42-44` | Missing mandatory mission artifact |
| MISSION.md uncommitted check | `lib/commands/handoff.js:96-99` | Uncommitted mission contract |
| Checkpoint existence (with auto-gen remediation) | `lib/commands/handoff.js:102-126` | Missing checkpoint documents — auto-generates CP-1.md if none exist |
| Final checkpoint uncommitted check | `lib/commands/handoff.js:131-135` | Uncommitted checkpoint evidence |
| Goal Check section existence | `lib/commands/handoff.js:141-147` | Missing `## Goal Check` heading in final checkpoint |
| Goal Check evidence rows validation | `lib/commands/handoff.js:152-179` | Empty goal-check table with no real evidence rows |
| Backlog task file resolution | `lib/commands/handoff.js:84-89` | Missing or ambiguous backlog task |
| Verification gate (area-based) | `lib/commands/handoff.js:199-209` | Gate failure — lint/typecheck/test-hygiene not passing |
| Rebase onto primary | `lib/commands/handoff.js:214-229` | Branch divergence / rebase conflicts |
| NEL capture | `lib/commands/handoff.js:233-239` | Observational only — no enforcement |
| Gatekeeper mandatory artifacts | `lib/commands/handoff.js:322-335` | Missing MISSION.md, checkpoint docs, or backlog task |
| Declared gates execution (`## Gates` section) | `lib/commands/handoff.js:343-354` | Mission-declared gate commands fail |

### Phase 3: Before Review (`verifyReview`)

| Check | File:Line | Failure Class Caught |
|-------|-----------|---------------------|
| Mission directory existence | `lib/review/review-commands.js:367-370` | Missing mission directory |
| Branch correctness | `lib/review/review-commands.js:374-379` | Wrong branch for mission |
| Backlog task status | `lib/review/review-commands.js:382-401` | Task not in reviewable state |
| PR existence and state (when Forgejo enabled) | `lib/review/review-commands.js:403-430` | Missing/closed PR |
| Verification gate | `lib/review/review-commands.js:438-445` | Gate failure at review time |
| Acceptance criteria display | `lib/review/review-commands.js:449-456` | Informational — no enforcement |

### Phase 4: During Integration

| Check | File:Line | Failure Class Caught |
|-------|-----------|---------------------|
| Integration preflight | `lib/commands/integrate.js:500-504` | Context build failures (missing task, branch issues) |
| Integration gates (`verify-local.sh integrate` area) | `lib/commands/integrate.js:507-534` | Area-specific verification failure pre-merge |
| Squash merge | `lib/commands/integrate.js:693-698` | Merge conflict |
| Exact-tree verification proof capture | `lib/commands/integrate.js:742-749` | Verification gate fails on the squash-merged tree |
| Exact-tree verification proof assertion | `lib/commands/integrate.js:753-757` | Tree changed after verification (stale proof) |
| Forgejo sync-merged | `lib/commands/integrate.js:761-774` | PR sync failure |

### Phase 5: Variant A Closeout (Forgejo-merged path)

| Check | File:Line | Failure Class Caught |
|-------|-----------|---------------------|
| `finalizeVariantACloseout` with exact-tree proof | `lib/commands/integrate.js:1347-1410` | Verification proof capture/assertion on closeout tree |

### Phase 6: Forgejo Publish Path

| Check | File:Line | Failure Class Caught |
|-------|-----------|---------------------|
| `captureVerifiedTreeProof` at PR creation | `lib/tools/forgejo.js:519` | Broken tree published to review remote |
| `assertVerifiedTreeProof` in `syncPrimaryBaseline` | `lib/tools/forgejo.js:853` | Stale or mismatched proof on primary baseline push |

## Current Repair/Send-Back Behavior

### `repair-handoff.js` — Mechanical Repairs

Located at `lib/commands/repair-handoff.js:82-226`:

| Error Pattern | Repair Action | Coverage |
|---------------|--------------|----------|
| "is modified but uncommitted" / "Commit the mission contract before handoff" / "Commit the implementation evidence before handoff" | Auto-commit mission-safe artifacts | Narrow: only mission artifacts, not arbitrary dirty files |
| "Updates were rejected" / "fetch first" / "non-fast-forward" | Auto-rebase onto primary | Narrow: only simple rebase, fails on conflicts |

### `repair-handoff.js` — Relaunchable Errors

Located at `lib/commands/repair-handoff.js:12-68`:

| Error Pattern | Action | Coverage |
|---------------|--------|----------|
| "has a '## Goal Check' section but no evidence rows" | Build relaunch prompt for agent to fix checkpoint | Single error class only |

### `active.js` — Automated Handoff-and-Repair Flow

Located at `lib/commands/active.js:426-498`:

1. `validateCheckpointsBeforeHandoff` — pre-handoff checkpoint enforcement (`active.js:440-446`)
2. `performHandoff` — runs all handoff checks
3. On failure: `repairHandoff` — attempts mechanical auto-commit/rebase (`active.js:454`)
4. On repair success: retries `performHandoff` with `force: true` (`active.js:457`)
5. On non-repairable but relaunchable: `attemptAgentRelaunch` with fix prompt (`active.js:462-483`)
6. On gatekeeper pushback: skips review loop, keeps task active (`active.js:495-498`)

### Auto-Generated Checkpoint (task-1228 remediation)

Located at `lib/commands/handoff.js:103-126`:

When no checkpoint documents exist at handoff time, generates a minimal CP-1.md with a valid Goal Check table structure. Marked as auto-generated for reviewer awareness.

## Key Prior Artifacts Referenced

1. **TASK-1268** (`backlog/tasks/task-1268 - Shift-left.md`): Shift-left verification concept — run gate mechanically before each review round, auto-bounce on failure. Not yet implemented.
2. **TASK-1335** (`backlog/completed/task-1335 - Harden-parallix-self-hosting-publish-path...md`): Exact-tree verification proof, fail-closed publish guards. Completed.
3. **ADR 0041** (`docs/adr/0041-integration-pipeline-gates.md`): Integration-time pipeline gates, per-area gate dispatch, `--no-integration-gates` escape hatch.
4. **ADR 0047** (`docs/adr/0047-per-mission-change-size-budget.md`): NEL budget — observational capture at handoff, no enforcement.

## Gap Summary

The current harness has strong coverage for:
- Exact-tree verification at integrate time (task-1335)
- Mandatory artifact presence at handoff (gatekeeper)
- Mechanical git issues (dirty files, rebase needed)
- Mission-declared gate execution at handoff

The current harness has gaps in:
1. **Pre-review gate enforcement**: Gate runs at checkpoint and handoff but is not enforced before each review round (task-1268 open)
2. **Gate command validation**: Declared `## Gates` are executed as shell commands but never validated for syntactic correctness or executability before running
3. **Error classifier breadth**: `repair-handoff.js` handles only 2 mechanical error classes and 1 relaunchable class; all other failures strand
4. **Genuine gate failure relaunch**: When verification gate fails at handoff, the error is not classified as relaunchable — agent is not relaunched with fix instructions
5. **Auto-send-back on gatekeeper block**: Gatekeeper posts pushback and keeps task active, but does not auto-send-back to implementer or relaunch agent

Next action: Build failure-class matrix mapping each incomplete-work / hallucination class to current handling and proposed auto-repair / auto-send-back / human-only outcomes (CP-2).
