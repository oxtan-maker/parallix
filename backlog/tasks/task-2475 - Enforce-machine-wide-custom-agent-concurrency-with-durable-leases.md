---
id: TASK-2475
title: Enforce machine-wide custom-agent concurrency with durable leases
status: backlog
assignee: []
created_date: '2026-09-10 05:37'
labels: []
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Make `adapters.agents.maxConcurrentCustom` an actually enforced concurrency limit for local/custom agents across independent Parallix processes, detached board launches, mission worktrees, and repositories sharing the same operator state.

Replace the current process-local counter with an atomic operator-owned lease mechanism, keep capacity tied to the lifetime of the actual custom-agent process, and configure the Parallix repository itself with:

```json
"maxConcurrentCustom": 2
```

## Why Now

`maxConcurrentCustom` currently gives a stronger guarantee than the implementation provides.

The existing implementation keeps custom-agent capacity in a module-level `activeCustomLaunches` variable. That works only inside one Node process. Two independent `px` processes each start with a count of zero and can therefore both acquire the same nominal capacity.

This is particularly unsafe for local GPU-backed agents because:

* independent `px active` invocations do not share the counter;
* board launches may detach/unref the agent child and the board process may exit while the local agent continues running;
* restarting Parallix resets the in-memory count even though an earlier local agent may still be consuming GPU capacity;
* capacity is currently resolved from the mission worktree, allowing stale worktree configuration to disagree with the repository's current policy;
* an invalid configuration can fall back to defaults and thereby turn a finite custom-agent limit into `Infinity`;
* Parallix's own `workflow.config.json` currently has `subagents.maxParallel: 2` but does not set `maxConcurrentCustom`; these are different controls.

For GPU-backed custom agents this limit must behave as resource admission control, not as a best-effort in-process hint.

## Refinement Signals

* Predicted NEL bucket: Large
* Confidence: High
* Selection note: activate as-is
* Main drivers:

  * operator-owned SQLite lease authority;
  * atomic cross-process acquisition;
  * child-process liveness and detached execution;
  * canonical configuration authority;
  * crash/stale-lease recovery;
  * multi-process integration coverage.

## Scope

* Replace the process-local custom-agent capacity counter as the production authority with durable custom-agent leases stored in operator-owned Parallix state under `PARALLIX_HOME`.
* Keep `adapters.agents.maxConcurrentCustom` as the public repository configuration surface.
* Make custom-agent capacity accounting global to the operator state rather than local to one Node module, mission, worktree, or repository process.
* Make lease acquisition atomic across independent Parallix processes.
* Bind an acquired lease to the actual spawned custom-agent process, not merely the parent `px`/board process.
* Preserve the lease while that child remains alive even if the launching board/CLI process exits.
* Release leases on normal completion and reap stale leases after crashes or abnormal parent termination when the recorded agent process is provably no longer alive.
* Protect against PID reuse sufficiently that a stale lease is not kept merely because an unrelated later process received the same PID.
* Stop resolving `maxConcurrentCustom` from arbitrary mission-worktree configuration. Resolve capacity policy from the canonical repository/configuration authority before launch and pass that policy into admission control.
* Treat a present but invalid `workflow.config.json` as an error for custom-agent admission rather than silently converting a requested finite safety limit into unlimited capacity.
* Preserve the documented behavior that an absent `maxConcurrentCustom` means unlimited custom-agent launches.
* Preserve existing selection behavior: when custom capacity is saturated, an eligible non-custom family may be selected; pinned custom work must fail explicitly rather than bypass capacity.
* Count custom capacity across repositories that share the same `PARALLIX_HOME`, because those processes compete for the same local machine resources.
* Update Parallix's own `workflow.config.json` so `adapters.agents.maxConcurrentCustom` is exactly `2`.
* Update configuration/runtime documentation where necessary to distinguish:

  * `maxConcurrentCustom`: enforced top-level custom-agent process capacity;
  * `subagents.maxParallel`: advisory limit on subagents spawned inside an agent.

## Out of Scope

* Building a general distributed scheduler for agents running on different machines.
* GPU-memory-aware dynamic scheduling or querying VRAM before every launch.
* Per-GPU placement or assigning agents to specific GPUs.
* Changing custom-agent runner selection (`opencode` versus `pi`) except where necessary to expose spawned-process identity.
* Turning `subagents.maxParallel` into an enforced operating-system semaphore.
* Changing hosted-agent usage-limit/blocklist semantics.
* Requiring a finite custom-agent limit in every consumer repository; absence remains the documented unlimited default.
* Introducing Redis, a daemon, or another external coordination service when the existing operator SQLite authority can provide the required atomicity.

## Success Criteria

> **Falsifiability rule:** each criterion must be demonstrably pass/fail. Resource limits must be tested at real process boundaries rather than only through mocked module-local state.

* With `maxConcurrentCustom: 1`, two independent Parallix processes cannot simultaneously obtain custom-agent capacity: while process A's custom agent is alive, process B does not start another custom agent.
* A simultaneous two-process race for the final custom slot is atomic: with limit `1`, exactly one process acquires custom capacity and no execution permits two custom children to overlap.
* Custom-agent capacity is based on leases in operator-owned persistent state rather than a module-local integer.
* A normal custom-agent exit releases its lease and permits a subsequent custom launch.
* A launch failure before a usable child exists leaves no retained capacity lease.
* If a parent `px`/board process exits after detaching a custom child, the custom child's lease remains active while that child is alive.
* After that detached custom child exits, a subsequent acquisition identifies the lease as stale/dead and capacity becomes available without manual cleanup.
* An abruptly terminated launcher does not permanently consume capacity once the associated custom-agent process is no longer alive.
* Lease liveness validation includes enough process identity beyond a bare PID to prevent an unrelated process that later reuses the PID from keeping a stale lease alive.
* Two repositories using the same `PARALLIX_HOME` share the same active custom-agent lease pool.
* Saturating custom capacity still allows `startAgent`/selection to choose an eligible non-custom family where normal fallback is permitted.
* Pinned custom work reports explicit custom-capacity saturation and does not silently route around or exceed the limit.
* Capacity policy does not depend on a stale mission worktree's copy of `workflow.config.json`: changing the canonical repository limit is honored by launches from existing mission worktrees.
* A present invalid workflow configuration cannot silently turn a finite `maxConcurrentCustom` policy into `Infinity`; launch/configuration fails with an actionable configuration error.
* Omitting `maxConcurrentCustom` continues to resolve to the documented unlimited behavior.
* Parallix's checked-in `workflow.config.json` contains:

```json
"agents": {
  "maxConcurrentCustom": 2,
  ...
}
```

and `px config` reports `adapters.agents.maxConcurrentCustom = 2`.

* Documentation clearly distinguishes enforced custom-agent concurrency from the advisory `subagents.maxParallel` prompt instruction.
* Existing custom-capacity selection/release tests remain green or are replaced by equivalent tests against the new authority; no production correctness depends on `resetCustomCapacity()` or another process-local reset hook.
* The complete repository verification gate passes.

## Architectural Constraints

### Capacity authority

Custom-agent capacity is operator/machine resource state.

The production authority MUST NOT be:

```ts
let activeCustomLaunches = 0;
```

or another process-local singleton.

Use the existing operator-owned SQLite state as the coordination boundary.

A lease should contain enough information to diagnose and safely recover it, including at least:

* unique lease ID;
* custom agent family/runner;
* repository identity;
* mission identity when available;
* acquisition timestamp;
* configured capacity associated with the acquisition;
* launcher PID where useful for diagnostics;
* actual spawned custom-agent PID/process identity once available;
* sufficient process-start identity to distinguish PID reuse.

Exact schema naming is implementation-owned.

### Atomic admission

Acquiring capacity MUST be a single atomic decision across processes.

Conceptually:

```text
BEGIN transaction

reap leases proven dead

count live custom-agent leases

determine effective finite capacity for this acquisition

if live >= capacity:
    reject acquisition
else:
    insert lease

COMMIT
```

Do not implement `count()` followed later by an unrelated `insert()` without serialization, since two independent launchers could both observe the final slot as free.

Use the SQLite transaction/locking pattern already established by Parallix rather than introducing a separate file-lock protocol.

### Child ownership

The reservation lifetime is the lifetime of the custom-agent process.

The existing launcher path must expose the successfully spawned child identity at the point where the process exists. `spawnAndTee` or an equivalent process seam may add an `onSpawn`/child-start callback so admission state can be bound to the actual child.

Do not free capacity merely because an unref'd board process exits.

### Recovery

Normal execution should explicitly release its lease.

Crash recovery must not rely on that release occurring.

Before admission, stale leases may be reaped only when the recorded process can be shown not to represent the original live agent anymore.

Unknown liveness must not be treated as definitely dead if doing so could oversubscribe configured local capacity.

### Configuration authority

`maxConcurrentCustom` remains repository configuration for compatibility, but launchers must not independently re-read policy from whichever mission worktree happens to be executing.

Resolve the effective capacity from the canonical repository/configuration boundary and pass the resolved policy into the custom-capacity authority.

The shared lease pool lives at operator scope, so custom agents from separate repositories sharing a Parallix home consume the same machine capacity.

Where simultaneously active repositories declare different finite limits, admission must remain conservative: a new acquisition must not invalidate a finite capacity constraint already represented by the active lease set. Store enough policy information on leases to make this deterministic.

## Risks and Assumptions

* Risk: a SQLite transaction design can still race if counting and lease creation are not in the same serialized transaction.

  * Assumption: Parallix's existing operator database can provide the required transaction semantics.

* Risk: parent-process PID tracking is insufficient for detached board launches.

  * Assumption: the process launcher can expose the actual custom child identity.

* Risk: PID reuse can cause stale capacity to remain allocated.

  * Assumption: Linux process start metadata or an equivalent process identity can distinguish the original child from a reused PID.

* Risk: aggressive stale cleanup can exceed GPU capacity.

  * Assumption: uncertain liveness fails conservatively rather than freeing a slot.

* Risk: repository-local limits conflict when repositories share a machine.

  * Assumption: active leases retain the finite policy under which they were admitted so subsequent admission can preserve all active finite constraints.

* Risk: old mission worktrees contain old config.

  * Assumption: composition can resolve canonical repository policy without making worktree state the capacity authority.

## Checkpoints

* CP 1: Add a red multi-process reproduction test for `maxConcurrentCustom`.

  * Configure capacity `1`.
  * Start a custom test runner that remains alive until explicitly released.
  * Launch it through Parallix process A.
  * Launch a second Parallix process B.
  * Assert B never starts a second custom child while A's child is alive.
  * Add a synchronized race variant proving exactly one acquisition succeeds when two processes contend for one slot.
  * The test MUST fail against the parent implementation because each process owns a separate `activeCustomLaunches` value.

Reproduction-Test: `test/custom-capacity-multiprocess-repro.test.ts` or an equivalently narrowly named integration test.

* CP 2: Introduce operator-owned custom-capacity leases and atomic acquisition.

  * Add the required SQLite migration/repository/adapter.
  * Move production admission authority out of `custom-capacity.ts`'s module-local count.
  * Integrate atomic acquire/release with `startAgent`.
  * Expose spawned-child identity from the process launcher.
  * Preserve custom saturation fallback and pinned-agent behavior.
  * Keep focused unit coverage for acquisition, release, saturation, and transaction behavior.

* CP 3: Make detached/crashed execution and configuration authority correct.

  * Prove a detached board/custom child remains capacity-consuming after the parent exits.
  * Prove capacity becomes reusable after that child exits.
  * Add stale/crashed lease cleanup with PID-reuse-safe liveness.
  * Prove two repositories sharing `PARALLIX_HOME` share capacity.
  * Stop reading capacity policy from stale mission-worktree config.
  * Add regression coverage for invalid config failing closed rather than silently becoming unlimited.
  * Preserve absent-limit = unlimited behavior.

* CP 4: Configure Parallix itself and close documentation/regression coverage.

  * Set `adapters.agents.maxConcurrentCustom` to `2` in root `workflow.config.json`.
  * Preserve the existing `subagents.maxParallel` setting independently.
  * Update `docs/config.md` to explain enforced custom concurrency versus advisory subagent concurrency.
  * Run `px config` and verify effective custom capacity is exactly `2`.
  * Run the required repository gates and record Goal Check evidence for every Success Criterion.

### Checkpoint Documentation Requirements

Every checkpoint document (`CP-N.md`) MUST include:

* exact test names and repository paths used as evidence;
* the exact heading `## Goal Check`;
* the exact table header:

```text
| Criterion | Evidence | Status |
```

* one evidence row for every applicable Success Criterion;
* a concise work summary;
* a concrete `Next action:` line at the bottom.

For this mission, accepted durable evidence should include exact references to relevant paths/tests such as:

* `src/adapters/agents/custom-capacity.ts`
* `src/adapters/agents/agents.ts`
* `src/adapters/agents/launcher-selection.ts`
* `src/adapters/process/spawn-tee.ts`
* `src/adapters/process/process-liveness.ts`
* `src/adapters/sqlite/`
* `src/adapters/config/product-config.ts`
* `workflow.config.json`
* `docs/config.md`
* `test/agents.test.ts`
* the new multi-process custom-capacity reproduction/integration tests
* `px config`
* `./scripts/verify-local.sh all`

Generic prose that the limit "works" is not sufficient evidence.

## Gates

* [ ] `./scripts/verify-local.sh all`
* [ ] Multi-process custom-capacity reproduction is green
* [ ] Detached-child lifecycle reproduction is green
* [ ] Cross-repository shared-capacity reproduction is green
* [ ] `px config` reports `maxConcurrentCustom: 2` for Parallix

## Restricted Areas

* Do not solve cross-process admission with another module-level/global JavaScript variable.
* Do not rely exclusively on `running-sessions.ts` process-table detection as the capacity authority.
* Do not count only live `px` parent processes; detached custom children must remain capacity-consuming.
* Do not use a bare PID as sufficient durable process identity for stale-lease recovery.
* Do not implement acquisition as a non-atomic read/count followed by a later insert.
* Do not silently free capacity when liveness is unknown if doing so can exceed a finite configured limit.
* Do not silently convert an invalid finite custom-capacity configuration into unlimited capacity.
* Do not make mission-worktree configuration the authoritative custom-capacity policy.
* Do not merge `maxConcurrentCustom` and `subagents.maxParallel`; they represent different concurrency boundaries.
* Do not introduce Redis, a background daemon, or an external coordinator for this mission.

## Stop Rules

* Stop and escalate if the existing operator SQLite layer cannot provide an atomic cross-process acquire decision without a new long-running coordinator.
* Stop if preserving detached-agent capacity would require keeping the board/CLI parent alive; detached execution is an existing product requirement and must remain supported.
* Stop before implementing stale-lease cleanup that treats uncertain child liveness as dead and can therefore oversubscribe a finite local-agent limit.
* Stop and document the conflict if canonical repository configuration cannot be identified reliably from a mission worktree without introducing a second configuration authority.
* Stop before changing the public meaning of an absent `maxConcurrentCustom`; this mission preserves the documented unlimited default.
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
