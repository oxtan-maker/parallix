# Mission: Enforce machine-wide custom-agent concurrency with durable leases (task-2475)

## Goal
Make `adapters.agents.maxConcurrentCustom` an actually enforced, machine-wide concurrency limit for local/custom agents across independent `px` processes, detached board launches, mission worktrees, and repositories that share the same operator state. Replace the process-local counter in `src/adapters/agents/custom-capacity.ts` with an atomic, operator-owned lease mechanism stored in the Parallix operator SQLite database under `PARALLIX_HOME`, tie capacity to the lifetime of the actual spawned custom-agent process, and set Parallix's own `workflow.config.json` to `"maxConcurrentCustom": 2`.

## Why Now
`maxConcurrentCustom` currently advertises a stronger guarantee than the implementation delivers.

The existing implementation stores custom-agent capacity in a module-level `activeCustomLaunches` variable (`src/adapters/agents/custom-capacity.ts`). That works only inside one Node process:

* Two independent `px` processes each start at zero and can both acquire the same nominal capacity.
* `px active` invocations do not share the counter.
* Board launches may `unref`/detach the agent child; the board process can exit while the local agent keeps running, so capacity is lost or leaked.
* Restarting Parallix resets the in-memory count even though an earlier local agent may still consume GPU capacity.
* Capacity is resolved from the mission worktree (`resolveMaxConcurrentCustom`), so a stale worktree config can disagree with the repository's current policy.
* An invalid configuration can fall back to defaults and turn a finite limit into `Infinity`.
* `workflow.config.json` currently sets `subagents.maxParallel: 2` but not `maxConcurrentCustom`; these are distinct controls.

For GPU-backed custom agents the limit must behave as resource admission control, not a best-effort in-process hint.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: operator-owned SQLite lease authority, atomic cross-process acquisition, child-process liveness and detached execution, canonical configuration authority, crash/stale-lease recovery, multi-process integration coverage.

## Scope
- Replace the process-local custom-agent capacity counter as the production authority with durable custom-agent leases stored in operator-owned Parallix state under `PARALLIX_HOME` (operator SQLite, per ADR 0053).
- Keep `adapters.agents.maxConcurrentCustom` as the public repository configuration surface.
- Make custom-agent capacity accounting global to operator state, not local to one Node module, mission, worktree, or repository process.
- Make lease acquisition atomic across independent Parallix processes (single serialized acquire decision).
- Bind an acquired lease to the actual spawned custom-agent process, not merely the parent `px`/board process (via `spawnAndTee`/`src/adapters/process/spawn-tee.ts` child-start seam).
- Preserve the lease while that child stays alive even if the launching board/CLI process exits.
- Release leases on normal completion; reap stale leases after crashes or abnormal parent termination when the recorded agent process is provably no longer alive (via `src/adapters/process/process-liveness.ts`).
- Protect against PID reuse so a stale lease is not kept merely because an unrelated later process received the same PID.
- Stop resolving `maxConcurrentCustom` from arbitrary mission-worktree configuration. Resolve capacity policy from the canonical repository/configuration authority (`src/adapters/config/product-config.ts`) before launch and pass that policy into admission control.
- Treat a present-but-invalid `workflow.config.json` as an error for custom-agent admission rather than silently converting a finite limit into `Infinity`.
- Preserve documented behavior: an absent `maxConcurrentCustom` means unlimited custom-agent launches.
- Preserve existing selection behavior: saturated custom capacity still allows an eligible non-custom family to be selected; pinned custom work must fail explicitly rather than bypass capacity (`src/adapters/agents/launcher-selection.ts`).
- Count custom capacity across repositories that share the same `PARALLIX_HOME`.
- Set Parallix's own `workflow.config.json` so `adapters.agents.maxConcurrentCustom` is exactly `2`.
- Update configuration/runtime documentation to distinguish `maxConcurrentCustom` (enforced top-level capacity) from `subagents.maxParallel` (advisory subagent limit).

## Out of Scope
- Building a general distributed scheduler for agents on different machines.
- GPU-memory-aware dynamic scheduling or querying VRAM before every launch.
- Per-GPU placement or assigning agents to specific GPUs.
- Changing custom-agent runner selection (`opencode` vs `pi`) except where necessary to expose spawned-process identity.
- Turning `subagents.maxParallel` into an enforced OS semaphore.
- Changing hosted-agent usage-limit/blocklist semantics.
- Requiring a finite custom-agent limit in every consumer repository; absence remains the documented unlimited default.
- Introducing Redis, a daemon, or another external coordination service when the operator SQLite authority can provide the required atomicity.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives without an attached metric and vague quantifiers. Resource limits must be tested at real process boundaries, not only through mocked module-local state.

- With `maxConcurrentCustom: 1`, two independent processes cannot simultaneously obtain custom capacity: while process A's custom agent is alive, process B does not start another custom agent.
- A simultaneous two-process race for the final slot is atomic: with limit `1`, exactly one process acquires custom capacity; no execution permits two custom children to overlap.
- Custom-agent capacity is based on leases in operator-owned persistent state, not a module-local integer (`src/adapters/agents/custom-capacity.ts` no longer holds production authority).
- A normal custom-agent exit releases its lease and permits a subsequent custom launch.
- A launch failure before a usable child exists leaves no retained capacity lease.
- If a parent `px`/board process exits after detaching a custom child, the custom child's lease remains active while that child is alive.
- After that detached custom child exits, a subsequent acquisition identifies the lease as stale/dead and capacity becomes available without manual cleanup.
- An abruptly terminated launcher does not permanently consume capacity once the associated custom-agent process is no longer alive.
- Lease liveness validation includes process identity beyond a bare PID so an unrelated process that later reuses the PID cannot keep a stale lease alive.
- Two repositories using the same `PARALLIX_HOME` share the same active custom-agent lease pool.
- Saturating custom capacity still allows `startAgent`/selection to choose an eligible non-custom family where normal fallback is permitted.
- Pinned custom work reports explicit custom-capacity saturation and does not silently route around or exceed the limit.
- Capacity policy does not depend on a stale mission worktree's copy of `workflow.config.json`: changing the canonical repository limit is honored by launches from existing mission worktrees.
- A present invalid workflow configuration cannot silently turn a finite `maxConcurrentCustom` into `Infinity`; launch/configuration fails with an actionable configuration error.
- Omitting `maxConcurrentCustom` continues to resolve to the documented unlimited behavior.
- Parallix's checked-in `workflow.config.json` contains `"agents": { "maxConcurrentCustom": 2, ... }` and `px config` reports `adapters.agents.maxConcurrentCustom = 2`.
- Documentation clearly distinguishes enforced custom-agent concurrency from the advisory `subagents.maxParallel` prompt instruction.
- Existing custom-capacity selection/release tests remain green or are replaced by equivalent tests against the new authority; no production correctness depends on `resetCustomCapacity()` or another process-local reset hook.
- The complete repository verification gate passes.

## Risks and Assumptions
- Risk: a SQLite transaction design can still race if counting and lease creation are not in the same serialized transaction.
  * Assumption: the operator database can provide the required transaction semantics (ADR 0053 transaction rules).
- Risk: parent-process PID tracking is insufficient for detached board launches.
  * Assumption: the process launcher can expose the actual custom child identity.
- Risk: PID reuse can cause stale capacity to remain allocated.
  * Assumption: Linux process start metadata or an equivalent process identity can distinguish the original child from a reused PID.
- Risk: aggressive stale cleanup can exceed GPU capacity.
  * Assumption: uncertain liveness fails conservatively rather than freeing a slot.
- Risk: repository-local limits conflict when repositories share a machine.
  * Assumption: active leases retain the finite policy under which they were admitted so subsequent admission preserves all active finite constraints.
- Risk: old mission worktrees contain old config.
  * Assumption: composition resolves canonical repository policy without making worktree state the capacity authority.

## Checkpoints
- CP 1: Add a red multi-process reproduction test for `maxConcurrentCustom`.
  * Configure capacity `1`.
  * Start a custom test runner that stays alive until explicitly released.
  * Launch it through Parallix process A.
  * Launch a second Parallix process B.
  * Assert B never starts a second custom child while A's child is alive.
  * Add a synchronized race variant proving exactly one acquisition succeeds when two processes contend for one slot.
  * The test MUST fail against the parent implementation because each process owns a separate `activeCustomLaunches` value.
- CP 2: Introduce operator-owned custom-capacity leases and atomic acquisition.
  * Add the required SQLite migration/repository/adapter under `src/adapters/sqlite/`.
  * Move production admission authority out of `src/adapters/agents/custom-capacity.ts`'s module-local count.
  * Integrate atomic acquire/release with `startAgent` (`src/adapters/agents/agents.ts`).
  * Expose spawned-child identity from the process launcher (`src/adapters/process/spawn-tee.ts`).
  * Preserve custom saturation fallback and pinned-agent behavior (`src/adapters/agents/launcher-selection.ts`).
  * Keep focused unit coverage for acquisition, release, saturation, and transaction behavior.
- CP 3: Make detached/crashed execution and configuration authority correct.
  * Prove a detached board/custom child remains capacity-consuming after the parent exits.
  * Prove capacity becomes reusable after that child exits.
  * Add stale/crashed lease cleanup with PID-reuse-safe liveness (`src/adapters/process/process-liveness.ts`).
  * Prove two repositories sharing `PARALLIX_HOME` share capacity.
  * Stop reading capacity policy from stale mission-worktree config.
  * Add regression coverage for invalid config failing closed rather than silently becoming unlimited.
  * Preserve absent-limit = unlimited behavior.
- CP 4: Configure Parallix itself and close documentation/regression coverage.
  * Set `adapters.agents.maxConcurrentCustom` to `2` in root `workflow.config.json`.
  * Preserve the existing `subagents.maxParallel` setting independently.
  * Update `docs/config.md` to explain enforced custom concurrency versus advisory subagent concurrency.
  * Run `px config` and verify effective custom capacity is exactly `2`.
  * Run the required repository gates and record Goal Check evidence for every Success Criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (`CP-N.md`) MUST include:

- exact test names and repository paths used as evidence;
- the exact heading `## Goal Check`;
- the exact table header:

```text
| Criterion | Evidence | Status |
```

- one evidence row for every applicable Success Criterion;
- a concise work summary;
- a concrete `Next action:` line at the bottom.

For this mission, accepted durable evidence must lead with these forms (line:line file:line references are accepted but discouraged because they rot):

1. Recognized repo commands or paths — backticked `` `npm ...` ``, `` `node ...` ``, `` `git ...` ``, `` `px ...` ``, or `` `./scripts/verify-local.sh all` ``.
2. Exact test names — must match a test name in the repo, e.g. a multi-process custom-capacity integration test.
3. Test file paths under `test/`.
4. ADR references — e.g. `ADR 0053` (must correspond to an existing file under `docs/adr/`).
5. File paths — accepted when needed, discouraged: `src/adapters/agents/custom-capacity.ts`, `src/adapters/agents/agents.ts`, `src/adapters/agents/launcher-selection.ts`, `src/adapters/process/spawn-tee.ts`, `src/adapters/process/process-liveness.ts`, `src/adapters/sqlite/`, `src/adapters/config/product-config.ts`, `workflow.config.json`, `docs/config.md`, `test/agents.test.ts`, `test/agents-limit-hit.test.ts`.

Weak-agent failure mode: raw `stat`/`ls` output or generic prose alone is NOT sufficient. Pair any shell output with at least one accepted reference above. Example accepted evidence lines:

- `test/custom-capacity-multiprocess-repro.test.ts`, `"two processes contend for one custom slot: exactly one acquires"`
- `` `px config` `` reports `adapters.agents.maxConcurrentCustom = 2`
- `ADR 0053` operator SQLite lease authority; `src/adapters/sqlite/` migration
- `` `./scripts/verify-local.sh all` ``

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `npm test -- test/custom-capacity-multiprocess-repro.test.ts`
- [ ] `npm test -- test/custom-capacity-detached-child.test.ts`
- [ ] `npm test -- test/custom-capacity-cross-repo.test.ts`
- [ ] `px config`

## Restricted Areas
- Do not solve cross-process admission with another module-level/global JavaScript variable.
- Do not rely exclusively on `running-sessions.ts` process-table detection as the capacity authority.
- Do not count only live `px` parent processes; detached custom children must remain capacity-consuming.
- Do not use a bare PID as sufficient durable process identity for stale-lease recovery.
- Do not implement acquisition as a non-atomic read/count followed by a later insert.
- Do not silently free capacity when liveness is unknown if doing so can exceed a finite configured limit.
- Do not silently convert an invalid finite custom-capacity configuration into unlimited capacity.
- Do not make mission-worktree configuration the authoritative custom-capacity policy.
- Do not merge `maxConcurrentCustom` and `subagents.maxParallel`; they represent different concurrency boundaries.
- Do not introduce Redis, a background daemon, or an external coordinator for this mission.

## Stop Rules
- Stop and escalate if the existing operator SQLite layer cannot provide an atomic cross-process acquire decision without a new long-running coordinator.
- Stop if preserving detached-agent capacity would require keeping the board/CLI parent alive; detached execution is an existing product requirement and must remain supported.
- Stop before implementing stale-lease cleanup that treats uncertain child liveness as dead and can therefore oversubscribe a finite local-agent limit.
- Stop and document the conflict if canonical repository configuration cannot be identified reliably from a mission worktree without introducing a second configuration authority.
- Stop before changing the public meaning of an absent `maxConcurrentCustom`; this mission preserves the documented unlimited default.

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
