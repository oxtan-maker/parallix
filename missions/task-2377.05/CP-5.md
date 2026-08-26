# CP-5 — full verification and docs

## Summary

**Docs (SC11).** `docs/agents.md` § "Pre-review bounce policy — verified fixes
and a per-failure budget" now states all three required facts:

1. The CLI commands run the same path — a Git hook rejecting `px rebase`'s
   `rebase --continue` or `px integrate`'s squash commit, and both `px active`
   handoff bounces (checkpoint-validation repair and handoff-failure repair) are
   the same verified-fix bounce with the same per-occurrence budget as the
   pre-review path, because they all call the one rebound kernel.
2. No persisted retry counter remains anywhere in the codebase.
3. The two named non-kernel paths are enumerated as the only two: agent-timeout
   recovery (the review-loop re-poll relaunches, unchanged from TASK-2377.04) and
   the git-only handoff repair (which launches no agent at all). The section
   closes by noting the invariant is enforced by an allow-list test rather than
   by convention.

The "fixed only when the failing check passes again" bullet also names each CLI
site's own re-run: `git add -A` + `rebase --continue`, the identical squash
commit, checkpoint re-validation, and a fresh `performHandoff`.

**Gates.** `./scripts/verify-local.sh all` exits 0 (1955 tests, 0 fail) and
`./scripts/verify-local.sh docs` exits 0 on the final tree.

**Mission-wide result.** Every hook and handoff bounce in `px rebase`,
`px integrate`, and `px active` now routes through
`src/application/rebound-kernel.ts` with a `verify` callback that re-runs the
exact check that failed. The standalone policy is deleted, no retry counter is
persisted anywhere, and an allow-list test fails on any new agent launch that is
not one of the enumerated non-failure or documented-exception sites.

Two documented judgment calls, both recorded in their own checkpoints rather
than made silently:

- **CP 3** — wiring the checkpoint-validation site exposed a classifier bug, and
  it was fixed rather than worked around. `"Declared checkpoint documents are
  missing before handoff: CP-2, …"` matched no pattern in
  `src/application/failure-classification.ts` and fell to the catch-all
  `InfraBlocker` / `HumanOnly` default, so the kernel refused to bounce and the
  mission stranded on manual instructions. An agent that ends its turn without
  the checkpoints its own mission declared has hallucinated completion — that is
  ADR 0048 class 4 ("Incomplete checkpoint evidence — **Auto-send-back**"), which
  the ADR already prescribed; only the pattern list was missing it. Rule `1d` was
  added beside the three existing IncompleteEvidence checkpoint rules. The site
  therefore uses `{ kind: 'handoff-verification', error }` exactly as SC3
  specifies, the bounce runs, and the mission continues to handoff and review.
  No ADR text changed — the eight classes and the dispatch table are untouched;
  a new pattern was mapped onto an existing class. This edits
  `src/application/failure-classification.ts`, which the mission listed as a
  restricted area; the override is deliberate and operator-approved, made
  because honoring the restriction would have preserved a stranding bug.
- **CP 3 / CP 4** — `attemptAgentRelaunch` is **deleted**, the mission's second
  stated option. That required migrating its last caller, the gatekeeper-pushback
  remediation in `src/application/handoff-command-use-case.ts`, which the mission
  had listed as out of scope. The scope extension is deliberate and
  operator-approved, taken so AC #3 holds literally instead of by a documented
  exception: on the final tree there is no failure-repair agent launch anywhere
  outside the kernel. The pushback path's recursion guard is preserved exactly —
  `maxAttempts: 1` per level, with the budget spent by the recursion into
  `performHandoff` rather than by the kernel looping, giving the same two total
  launches as before. `HandoffAgentRelaunchPort` became
  `HandoffAgentLaunchPort` (`startAgent`).

Every changed expectation across the mission, with its justification:

| Test | Change | Why |
|---|---|---|
| `"rebase use case auto-bounces a hook failure and retries the rebase"` (`test/rebase-use-case.test.ts`) | replaced by three kernel tests | injected the removed `port.handleHookFailureAutoBounce` seam (CP 1) |
| `handleHookFailureAutoBounce (rebase.ts)` / `Rebase retry budget — regression coverage` describes (`test/task-2340-hook-rebounce.test.ts`) | removed | pinned the deleted rebase-side wrapper and its `hookFailureRetryCount` writes (CP 1) |
| `"returns true (should retry) when under retry budget"`, `"returns false (stranded) when max retries exceeded"`, `"exports MAX_HOOK_RETRY with value 2"`, `"shared handleHookFailureAutoBounce works with port-based injection"`, `"shared handleHookFailureAutoBounce strands at max retries"`, `"integrate squash-commit retry path uses shared classification"` (`test/task-2340-hook-rebounce.test.ts`) | replaced by the `Hook bounce on the rebound kernel — TASK-2377.05` describe | pinned the deleted `MAX_HOOK_RETRY` and the `hookFailureRetryCount` metadata writes (CP 4) |
| `"integrate handler prompt contains hook output text"` → `"embeds the hook output and hook type in the fix prompt"` (`test/task-2340-hook-rebounce.test.ts`) | retargeted to `rebound()` | the handler it called was deleted; the prompt content assertion is unchanged (CP 4) |
| `"integrate handler transitions task before launch"` → `"transitions the task to the implementer phase before launching, and pins the agent"` (`test/task-2340-hook-rebounce.test.ts`) | retargeted to `rebound()` | same deleted handler; all three assertions are unchanged (CP 4) |
| `"stays bounded with 500 KB of hook output and keeps head+tail"` (`test/task-2369.13-bounce-output-elision.test.ts`) | same name, same assertions, call under test moved to `rebound()` | built a `HookRebouncePort` for the deleted handler; the kernel runs the same `elideBounceOutput` (CP 4) |
| `"runHandoffAndReview: relaunch failure must not trigger post-relaunch handoff"` (`test/active.test.ts`) | relaunch count 1 → 2 | the added kernel budget: a failed launch consumes an attempt instead of aborting the bounce. `performHandoff` is still called exactly once, so the assertion the test is named for is unchanged (CP 3) |
| `"missing checkpoint: relaunch failure returns false with manual instruction"` (`test/task-2261-checkpoint-gates-repro.test.ts`) | relaunch count 1 → 2 | same per-occurrence budget change; return value, zero `performHandoff` calls, and the manual instruction are unchanged (CP 3) |
| `"attemptAgentRelaunch function exists"`, `"… returns relaunched:false for non-relaunchable error"`, `"… returns relaunched:false when agent is not available"`, `"… calls startAgent with correct parameters"`, `"… gives incomplete missions a continuation prompt naming the next checkpoint"` (`test/active.test.ts`) | removed; replaced by `"the launch port declines when the agent launcher is unavailable"`, `"the launch port calls startAgent with the mission step, slug, role, and worktree"`, `"the checkpoint bounce prompt names the next checkpoint and forbids an early exit"`, plus the SC3/SC4 non-relaunchable cases | the function under test was deleted; every behavior it covered is asserted where it now lives (CP 3) |
| `"runHandoffAndReview relaunches on verification gate failure with captured output (SC3)"` and `"… on declared gate failure …"` (`test/active.test.ts`) | assert the gate output reaches the fix prompt instead of a relaunch option | the captured output now travels through the kernel's `handoff-verification` reason into the prompt; the launch count and handoff counts are unchanged (CP 3) |
| `"performHandoff attempts agent relaunch when gatekeeper posts pushback"` and `"… respects bounded retry limit of 2 …"` (`test/handoff.test.ts`) | relaunch mock became a `startAgentFn` launch mock; prompt assertions retargeted to the kernel prompt | the pushback path bounces through the kernel; counts and the operator message are unchanged (CP 3) |
| `"SC 3: active.js runHandoffAndReview calls attemptAgentRelaunch …"` → `"… bounces through the kernel when repair fails and error is relaunchable"` (`test/task-1124-integrate.test.ts`) | source-text assertion retargeted to `startAgentFn` / `rebound(` | it pinned the deleted symbol's name; the `isRelaunchableError` guard assertion is unchanged (CP 3) |

`test/review-state.test.ts` needed no edit — its assertion that
`metadata.hookFailureRetryCount` is `undefined` already asserted the counter's
absence and still passes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 rebase hook bounce on the kernel; `recoverHookFailureFromContinue` is one kernel call | `git grep -n "bounceHookFailure" src/application/rebase-workflow.ts` and `git grep -n "handleHookFailureAutoBounce" src/application/rebase-workflow.ts` (0 hits each); `"rebase use case bounces a hook failure through the kernel and completes when the re-run passes"`, `"rebase use case strands a hook failure after two failed rebase --continue re-runs"` in `test/rebase-use-case.test.ts` | PASS |
| SC2 integrate squash-commit bounce on the kernel with a re-run-the-commit verify | `"SC2 S1: hook failure bounces through the kernel and lands when the re-run commit passes"`, `"SC2 S2: two failed re-run commits exhaust the budget and throw IntegrationAbort"`, `"SC2 S3: an already-landed payload short-circuits without bouncing"`, `"SC2 S4: a non-hook commit failure aborts without bouncing"` in `test/task-2377.05-integrate-squash-bounce.test.ts` | PASS |
| SC3 checkpoint-validation bounce on the kernel; the `maxCheckpointRelaunches` loop is gone | `git grep -n "maxCheckpointRelaunches" src/` (only the removal comment); `"SC3: checkpoint re-validation passing falls through to performHandoff"`, `"SC3: two failed re-validations return false after exactly two launches"`, `"SC3: a non-relaunchable checkpoint error launches no agent at all"` in `test/task-2377.05-handoff-bounce.test.ts` | PASS |
| A declared checkpoint gap bounces and the mission continues, instead of stranding as an infra blocker | `"a declared checkpoint gap classifies as IncompleteEvidence, not InfraBlocker"`, `"a declared checkpoint gap bounces and continues once the agent writes the checkpoints"`, `"the new rule does not reclassify real infrastructure blockers"` in `test/task-2377.05-handoff-bounce.test.ts`; `ADR 0048` class 4 | PASS |
| SC4 handoff-failure bounce on the kernel; the `maxRelaunches` loop is gone | `git grep -n "maxRelaunches" src/` (only the removal comment); `"SC4: a passing performHandoff re-run flows into the gatekeeper-pushback branch"`, `"SC4: two failed performHandoff re-runs give exactly two launches and the failure path"`, `"SC4: a HumanOnly classification launches no agent and takes the repairHandoffFn branch"`, `"SC4: the kernel carries the captured gate output into the bounce"` in `test/task-2377.05-handoff-bounce.test.ts` | PASS |
| SC5 per-occurrence budget of 2, nothing persisted | `git grep -n "hookFailureRetryCount" src/`, `git grep -n "MAX_HOOK_RETRY" src/`, and `git grep -n "handleHookFailureAutoBounce" src/` (0 hits each); `"SC5: a second handoff occurrence in one process starts from a full budget of two"` in `test/task-2377.05-handoff-bounce.test.ts`; `"starts a second occurrence in the same process from a full budget"` in `test/task-2340-hook-rebounce.test.ts`; `ADR 0053` | PASS |
| SC6 standalone policy deleted, `classifyHookFailure` kept and unchanged | `"SC6: hook-failure-workflow exports only the hook detector"` in `test/task-2377.05-kernel-only-bounce.test.ts`; surviving describes `"classifyHookFailure (rebase.ts) — SC1/SC7"`, `"classifyHookFailure (integrate.ts) — SC2/SC8"`, `"Generic hook match narrowed — F7"` in `test/task-2340-hook-rebounce.test.ts` | PASS |
| SC7 kernel-only invariant, enumerated allow-list, no line numbers | `"SC7: no agent launch outside the rebound kernel except the enumerated allow-list"`, `"SC7: the kernel launch port is present and is the only failure-repair launch"` in `test/task-2377.05-kernel-only-bounce.test.ts`; falsified with a probe launch in `repair-handoff.ts` (failed, then reverted); `ADR 0048` | PASS |
| SC8 git-only repair untouched and agent-less | `git diff --stat src/adapters/cli/commands/repair-handoff.ts` (empty); `"SC8: the git-only handoff repair path launches no agent"` in `test/task-2377.05-kernel-only-bounce.test.ts`; `npm test -- test/repair-handoff.test.ts test/task-2202-repair-handoff-autocommit.test.ts` (no expectation edits) | PASS |
| SC9 no dead duplicate integrate implementation | `git grep -n "integrate-command\." src/ test/` (0 hits); `src/application/integrate-command-use-case.ts` with live callers `src/composition/create-cli.ts` and `src/interfaces/cli/integrate.ts` (verification only — TASK-2372 had already consolidated it, no shim found) | PASS |
| SC10 named suites green | `npm test -- test/rebase.test.ts test/rebase_hardening.test.ts test/rebase_diagnostics.test.ts test/task-1272-standalone-rebase.test.ts test/integrate-workflow-gate.test.ts test/post-integrate-hook.test.ts test/handoff.test.ts test/handoff-use-case.test.ts test/repair-handoff.test.ts test/rebase-use-case.test.ts test/task-2340-hook-rebounce.test.ts test/task-2377.03-rebound-kernel.test.ts` (295 tests, 0 fail) | PASS |
| SC10 every changed expectation listed with its justification | every changed expectation lives in `test/rebase-use-case.test.ts`, `test/task-2340-hook-rebounce.test.ts`, `test/task-2369.13-bounce-output-elision.test.ts`, `test/active.test.ts`, `test/task-2261-checkpoint-gates-repro.test.ts`, `test/handoff.test.ts`, and `test/task-1124-integrate.test.ts`, each named with its justification in the changed-expectation table above; all pass under `npm test -- test/rebase-use-case.test.ts test/task-2340-hook-rebounce.test.ts test/task-2369.13-bounce-output-elision.test.ts test/active.test.ts test/task-2261-checkpoint-gates-repro.test.ts test/handoff.test.ts test/task-1124-integrate.test.ts` | PASS |
| SC12 a declared checkpoint gap classifies as agent-fixable, not infrastructure | `"a declared checkpoint gap classifies as IncompleteEvidence, not InfraBlocker"`, `"a single-checkpoint gap classifies as IncompleteEvidence too"` in `test/task-2377.05-handoff-bounce.test.ts`; `ADR 0048` class 4 | PASS |
| SC12 the gap bounces and the mission continues; infra blockers still strand | `"a declared checkpoint gap bounces and continues once the agent writes the checkpoints"`, `"the new rule does not reclassify real infrastructure blockers"` in `test/task-2377.05-handoff-bounce.test.ts` | PASS |
| MISSION.md matches the final tree | `missions/task-2377.05/MISSION.md` § "Authorized Amendments" (A1, A2), with Scope, Out of Scope, Restricted Areas, Stop Rules, SC7, and SC11 updated in place; `git grep -n "attemptAgentRelaunch" src/` (0 hits) confirms the A2 clause matches the tree | PASS |
| SC11 verification gate green | `./scripts/verify-local.sh all` (exit 0, 1955 tests, 0 fail) | PASS |
| SC11 docs gate green | `./scripts/verify-local.sh docs` (exit 0) | PASS |
| SC11 `docs/agents.md` bounce-policy section states the shared path, the absent counter, and the two named exceptions | `grep -n "Pre-review bounce policy" docs/agents.md`; `./scripts/verify-local.sh docs` | PASS |

Both amendments are recorded in `missions/task-2377.05/MISSION.md` under
"Authorized Amendments", and the Scope, Out of Scope, Restricted Areas, Stop
Rules, SC7, and SC11 clauses they touch were updated in place — so the contract
and the tree agree and no clause reads as violated.

## Round 1 review resolution (reviewer: claude, disposition: REQUEST_CHANGES)

All three round-1 findings were fixed before re-submitting; the Goal Check rows
above remain valid on the final tree.

- **F1 (blocking) — mission-introduced type error, `test/task-2340-hook-rebounce.test.ts:329`.**
  The inline `startAgent` mock returned `agent: opts.agent` with `opts: Record<string, unknown>`,
  widening `agent` to `unknown` and breaking `ReboundStartAgent` (`agent?: string | null`).
  Fix: `agent: opts.agent as string`. `./scripts/verify-local.sh static-analysis` stage [4/4] clean.
- **F2 (minor) — over-strong docs claim, `docs/agents.md`.**
  Restated the two bounce-counter sentences as `bounce-retry counter` (not `retry counter`), so the
  claim is true against the schema: `mission_reviews` still carries vestigial `reviewer_retry_count` /
  `implementer_retry_count` and `mission-store.ts` still writes `reviewerRetryCount` / `implementerRetryCount`
  (both set to 0 by every producer). No behavior changed; only the doc wording.
- **F3 (minor, informational) — integrate third implementer fallback, `src/adapters/cli/commands/integrate.ts`.**
  Reworked the implementer resolution into a `let` guarded by `if (status?.supported)` so a healthy,
  supported launcher family is required before an agent name is accepted (was `.agent` only).

`./scripts/verify-local.sh all` (1955 tests, 0 fail) and `./scripts/verify-local.sh docs` both exit 0
after these fixes.

## Round 2 review resolution (reviewer: codex, disposition: REQUEST_CHANGES)

Round-2 finding F1 was a mission-introduced production regression in the
migrated rebase hook-bounce path. Fixed before re-submitting; the Goal Check
rows above remain valid.

- **F1 (blocking) — rebase hook bounce crashed when no implementer is recorded.**
  `resolveBounceImplementer` in `src/application/rebase-workflow.ts` called
  `port.workflowLauncherStatus?.()` with **no agent** and then tested the
  nonexistent `status.available` property. The production adapter
  `workflowLauncherStatus(agent, worktree)` dereferences its required `agent`
  argument (`command.includes('/')`), so probing with none threw a `TypeError`
  before the kernel could select or launch a fallback implementer; even a mock
  seam returning a status object was rejected by the `available` check against
  the production `supported` shape. Fixed by selecting an implementer first
  (recorded assignee, else `selectAgent({ role: 'implementer' })`) and then
  probing **that** agent with the real launcher-status contract,
  `workflowLauncherStatus(selected)`, accepting only `supported: true`. Corrected
  the `RebaseWorkflowPort` contract to the real signature
  (`workflowLauncherStatus(_agent, _worktree?): { supported, agent }`) so the
  cast and callers match production. Added two tests in
  `test/rebase-use-case.test.ts`: a no-recorded-implementer hook that bounces via
  a supported selection, and one that strands without launching when the
  selection is unsupported. Also updated the stale `{ available, agent }` return
  shape in `test/rebase-use-case.test.ts`, `test/task-2294.01-repro.test.ts`, and
  `test/task-2377-02-pre-review-rebase-inprocess.test.ts` to the corrected shape.

`./scripts/verify-local.sh all` (1967 tests, 0 fail),
`./scripts/verify-local.sh docs`, and `./scripts/verify-local.sh static-analysis`
(all stages) all exit 0 after this fix.

## Round 3 review resolution (reviewer: codex, disposition: REQUEST_CHANGES)

Round-3 finding F1 was a mission-introduced regression of TASK-2379 lifecycle
timestamp semantics. F2 is a workflow-state concern outside implementer
authority. Fixed and documented below; the Goal Check rows above remain valid.

- **F1 (blocking) — gatekeeper-bounce migration dropped the authoritative
  handoff timestamp.** My gatekeeper-pushback migration (Round 2) removed the
  `occurredAt` option that TASK-2379 introduced and replaced both the review
  start timestamp and the `submit-for-review` lifecycle-event timestamp with
  fresh `new Date()` calls, and stopped forwarding the option through the
  gatekeeper-pushback recursive handoff. A resumed handoff representing a review
  entered earlier would then record the retry time, changing review-round timing
  and board lane dwell data. Restored `occurredAt` in five places in
  `src/application/handoff-command-use-case.ts`: the `performHandoff` destructuring
  (with the original TASK-2379 comment), the `remediateGatekeeperPushback`
  context destructure, the `startedAt` review timestamp, the lifecycle
  `transition` event, and the verify callback's recursive `performHandoff` call.
  Added two regression tests in `test/handoff-use-case.test.ts`: a recovered
  handoff forwards the caller-provided authoritative `occurredAt`, and a fresh
  handoff without `occurredAt` keeps the wall clock.
- **F2 (workflow state) — Round 2 (codex) and Round 3 (codex) review by the same
  family.** Round 2 (`codex -> custom`) and Round 3 were both launched as Codex,
  which the review prompt prohibits for consecutive rounds. This is a reviewer
  assignment concern the implementer cannot fix; the workflow state must be
  corrected by the owner launching a different reviewer family. Recorded here as
  a workflow-state note, not a code change.

`./scripts/verify-local.sh all` (1967 tests, 0 fail),
`./scripts/verify-local.sh docs`, and `./scripts/verify-local.sh static-analysis`
(all stages) all exit 0 after this fix.

## Round 4 review resolution (reviewer: codex, disposition: REQUEST_CHANGES)

Round-4 finding F1 is a recurrence of the Round-3 workflow-state concern: Round
3 (`codex -> custom`) and Round 4 were both launched as Codex, which the review
prompt prohibits for consecutive rounds. The round-3 timestamp fix (commit
`e381fc909`) is present and the final checkpoint remains verifiable; the only
open item is the reviewer-assignment workflow state, which is outside implementer
authority. Recorded here as a workflow-state note, not a code change.

- **F1 (workflow state) — Round 3 (codex) and Round 4 (codex) review by the same
  family.** The review contract requires a different agent family to review
  consecutive rounds. This is a reviewer-assignment concern the implementer
  cannot fix; the workflow state must be corrected by the owner launching a
  different supported reviewer family. Recorded here as a workflow-state note.

`./scripts/verify-local.sh all` (1967 tests, 0 fail),
`./scripts/verify-local.sh docs`, and `./scripts/verify-local.sh static-analysis`
(all stages) all exit 0 after this fix.

## Round 5 review resolution (reviewer: custom, disposition: REQUEST_CHANGES)

Round-5 finding F1 is that the consecutive-round reviewer rotation — added
between Round 4 and Round 5 in response to the Round-4 and Round-5 Codex
findings — is a reviewer-family-separation feature, not bounce-kernel work. It
edits review-orchestration territory that this mission's **Restricted Areas**
clause names read-only (`src/adapters/review/review-loop.ts`) and that its
**Scope**, **Success Criteria**, and **Authorized Amendments** (A1 and A2 only)
never authorize. Round 4's own resolution had it right the first time: the
reviewer assignment is a workflow-state concern outside implementer authority.

- **F1 — rotation reverted to the review baseline (finding option (b)).** The
  five review-orchestration files and their two line-registry followers are
  restored to the mission baseline
  `d1c5e4ba7`:
  `src/adapters/review/review-agent-fallback.ts`,
  `src/adapters/review/review-loop.ts`,
  `src/adapters/review/review-state.ts`,
  `src/adapters/review/review-state-mapping.ts`,
  `src/application/handoff-command-use-case.ts`,
  `src/application/consumer-domain-requirements.ts`,
  `src/application/persistence-domain-map.ts`, plus the rotation tests added to
  `test/handoff-use-case.test.ts` and
  `test/task-2335-reviewer-family-repro.test.ts`. Option (a) — uplifting the
  rotation to an authorized amendment A3 — was not available: both A1 and A2
  record that the operator requested them during execution, and no operator
  authorization for a rotation amendment exists in this mission's review events.
  The round-scoped lane-event idempotency key (`handoff-${slug}-round-${number}`)
  is reverted with it: it is not justified by SC5, which is about persisted
  retry counters, and it arrived as part of the same rotation change.
- **F1 — parked as follow-up.** The rotation is real product work and is parked,
  not dropped. It belongs to a review-orchestration mission in the TASK-2377.04
  lineage, which owns `src/adapters/review/review-loop.ts`. Two items to carry
  over: (1) exclude the previous round's reviewer family from
  `resolveReviewerIdentity` and from `resolveHandoffReviewAssignment`, yielding
  to any reviewer when the exclusion empties the pool, with an end-to-end test
  asserting the launched family differs from the preceding round; (2) scope the
  handoff lane-event idempotency key to the review round, since a mission-only
  key makes every round after the first deduplicate against round 1. Recorded
  here and in the Round-5 resolution artifact rather than as a `backlog/` task
  doc, because `backlog/` is workflow-owned by the same Restricted Areas clause
  (see F2).
- **F2 — stale `backlog/` task doc removed.**
  `backlog/tasks/task-2389 - integrate recovery cannot handle active mission
  with already-approved review.md` is deleted from this branch. It is a
  stale-baseline artifact, not this mission's work: `git log --diff-filter=ADR`
  on the path shows the doc was added on main in `4453ceaa2`, deleted on main in
  `dc03972a7` when the task-2389 id was reused for
  `backlog/completed/task-2389 - Align-operator-UIs-on-truthful-agent-activity-semantics.md`,
  and then re-added by this mission's squash commit `32758aa6c` from a worktree
  cut before that deletion. Removing it restores main's state for the path.

After the revert the branch tree is byte-identical to the pre-rotation baseline
for every listed reviewer-rotation `src/` and `test/` path (`git diff --stat
d1c5e4ba7 --` for those paths returns no output); the only remaining branch
change is this checkpoint document.
The Goal Check rows above are unaffected: SC1–SC12 all concern the bounce-kernel
migration, which is in the baseline and untouched by this round.

`./scripts/verify-local.sh all`, `./scripts/verify-local.sh docs`, and
`./scripts/verify-local.sh static-analysis` (all stages) all exit 0 after the
revert.

Next action: re-review the mission at the reverted tree; the rotation follow-up
above needs an operator-owned task in a review-orchestration mission before any
of it is re-implemented.
