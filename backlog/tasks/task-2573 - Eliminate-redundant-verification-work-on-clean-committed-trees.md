---
id: TASK-2573
title: Eliminate redundant verification work on clean committed trees
status: backlog
assignee: []
created_date: '2026-09-25 05:21'
labels: []
dependencies: []
ordinal: 106008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Reduce CPU consumed by redundant verification throughout the Parallix lifecycle without weakening verification guarantees, without allowing dirty-worktree evidence reuse, and without leaking Parallix's own Node/npm development conventions into the generic Parallix product.

The change has two deliberately separate layers:

1. **Parallix repository self-development optimisation**

   * remove redundant canonical bundle builds from the repository's own test orchestration;
   * make build ownership explicit at the script/gate level rather than hidden inside the generic test runner.

2. **Generic Parallix lifecycle optimisation**

   * reuse an already-passing verification proof only when the exact same verification command has already passed against the exact same clean committed tree and compatible toolchain;
   * prevent the execute agent from repeatedly running final lifecycle gates that Parallix itself owns at handoff;
   * allow repository lifecycle gates to opt into the same clean-tree proof reuse without making reuse the default for arbitrary shell commands.

No dirty-tree proof or affected-test selection is part of this mission.

## Why Now

Parallel missions increasingly make CPU, rather than agent/model capacity, a bottleneck.

Current behaviour contains several avoidable multipliers:

* `test/run-default-tests.ts` performs `npm run build` before every suite, including a targeted invocation such as `npm test -- test/foo.test.ts`.
* `npm run test:ci` explicitly builds and then invokes test commands whose runner builds again, resulting in repeated canonical bundle builds.
* Parallix's own pre-integration configuration explicitly runs `npm run build` and then `npm run test:integration`, whose runner currently builds again.
* the execute-agent prompt requires all mission-declared gates to pass even though handoff authoritatively executes those gates again;
* handoff repository verification creates a clean-tree proof identity, executes the verification regardless of whether an identical proof already exists, then stores the proof;
* mission-declared handoff gates already check an identical proof before executing, demonstrating the desired fail-closed behaviour;
* generic repository phase gates currently always execute their configured command and have no opt-in same-tree reuse mechanism.

An earlier attempt to mitigate contention by serialising full test runs would reduce parallelism rather than remove unnecessary work. This mission must eliminate redundant work instead.

## Refinement Signals

* Predicted NEL bucket: Large (235+)
* Confidence: High
* Selection note: activate as-is
* Main drivers: test-runner orchestration, package scripts, self-development gate configuration, reusable verification proofs, repository lifecycle gate configuration/schema, handoff behaviour, execute-agent instructions, regression coverage

## Scope

### A. Establish non-negotiable proof semantics

Reusable lifecycle verification is valid only against a **clean committed checkout**.

A reusable passing proof MUST remain bound to all identity dimensions already required by the verification proof mechanism, including at minimum:

* exact verification command after placeholder resolution;
* exact committed `HEAD`;
* exact Git tree;
* tracked-input fingerprint;
* relevant toolchain identity;
* successful exit status.

A proof MUST NOT be created or reused when `git status --porcelain` indicates a dirty checkout.

A changed commit invalidates reuse even if the resulting tree happens to be otherwise similar.

A changed tree invalidates reuse.

A changed verification command invalidates reuse.

A changed relevant toolchain invalidates reuse.

Missing, unreadable, malformed, stale, mismatched, or otherwise unverifiable proof data MUST cause actual execution, never a synthetic pass.

Only successful results are reusable. Failures are never cached as authorization to skip execution.

Do not introduce TTL-based, timestamp-based, filename-based, heuristic, partial-diff, or dirty-working-tree proof semantics.

### B. Remove hidden bundle builds from Parallix's own test runner

`test/run-default-tests.ts` MUST cease unconditionally invoking `npm run build`.

The test runner's responsibility is selecting and executing the requested tests, not silently performing repository build orchestration.

Specifically:

* `npm test` must execute the hermetic unit suite without first building the canonical bundle.
* `npm test -- <specific-test-file>` must execute the requested unit test selection without first building the canonical bundle.
* the underlying integration-suite runner must not itself unconditionally build the canonical bundle.

Preserve standalone developer usability where a test lane genuinely requires a built artifact by making that dependency explicit at the **Parallix repository script layer**.

It is acceptable and preferable to introduce explicit internal/prebuilt script variants where necessary, for example conceptually:

* a normal standalone integration command that explicitly performs one build before running integration tests;
* a prebuilt integration command used by an aggregate pipeline that has already performed that build.

The exact script names are an implementation choice. Do not introduce an environment-variable maze when clear package-script composition can express the dependency.

### C. Make `npm run test:ci` build exactly once

Refactor the Parallix repository's `package.json` scripts so a successful `npm run test:ci` performs the canonical production build exactly once.

The aggregate must continue to provide its current intended coverage:

* typecheck;
* canonical build;
* unit tests;
* GitHub-safe integration tests;
* bundle smoke;
* package-content audit.

Unit and integration test runners invoked after that build must consume the already-built state rather than triggering additional canonical builds.

Do not remove `test:bundle` or equivalent verification merely because the build count is reduced.

Do not weaken release/package validation.

### D. Make Parallix self-development pre-integration build exactly once

The Parallix repository's own `workflow.config.json` currently has an explicit pre-integration build gate followed by an integration suite that implicitly builds again.

Keep an explicit pre-integration build gate.

Change the self-development integration-suite command/path so it consumes that already-completed build rather than performing another canonical build.

The intended self-development sequence remains conceptually:

1. build;
2. static verification;
3. integration verification;
4. workflow E2E;
5. agent smoke.

The build happens once.

This is a **repository-specific optimisation**. It belongs in Parallix's own `package.json`, scripts, tests, and `workflow.config.json`.

Do not make generic Parallix product code inspect npm scripts, package manifests, Node projects, test filenames, or Parallix-specific verification tiers.

### E. Reuse an existing clean-tree proof in handoff repository verification

Handoff repository verification currently computes proof identity, always executes the configured verification command, and only afterwards writes the proof.

Change it to the same fail-closed pattern already used by mission-declared gates:

1. resolve the exact verification command;
2. determine whether an exact reusable proof exists for the current clean committed tree;
3. if and only if the proof is valid, reuse it and do not execute the command;
4. otherwise execute the command normally;
5. after a successful execution, store a reusable proof only if the checkout still satisfies the exact expected proof identity.

A dirty tree cannot be reused and cannot issue a reusable proof.

If inputs change while verification runs, the successful process exit must not produce a reusable proof for the changed inputs.

The observable output should distinguish:

* verification executed and passed;
* verification passed by reuse of an exact clean-tree proof;
* verification executed but proof could not safely be persisted.

Do not derive reuse from checkpoint prose or an agent assertion.

### F. Stop requiring the active agent to execute final mission gates redundantly

Change the generic execute-stage instructions so ownership is explicit:

* the execute agent should run targeted tests/checks necessary to develop and validate its changes;
* Parallix handoff owns the authoritative execution of mission-declared `## Gates`;
* the execute agent MUST NOT run a complete mission-declared gate merely because the lifecycle contract lists it and Parallix will execute it at handoff;
* the agent MAY run such a command when it has a concrete development reason, for example diagnosing a suspected failure, but it must not repeatedly rerun the final lifecycle gate as ritual confirmation;
* checkpoint evidence may cite targeted tests and other durable evidence; a checkpoint does not need to manufacture a second execution of the final handoff gate merely to demonstrate progress.

Preserve the rule that a mission cannot successfully hand off until its authoritative gates actually pass.

Do not make agent memory, checkpoint prose, or "I already ran this" statements an authorization mechanism for lifecycle gate reuse.

### G. Add opt-in clean-tree proof reuse to generic repository phase gates

Repository-configured lifecycle gates are intentionally generic and may be arbitrary shell commands. Many such commands are non-hermetic or have required side effects.

Therefore **do not make repository gate reuse automatic**.

Add an explicit language-neutral repository-gate reuse policy with these semantics:

* default: execute every configured phase gate as today;
* opt-in value: permit reuse only from an exact clean-tree verification proof;
* invalid policy values fail configuration validation;
* omitted policy preserves today's behaviour byte-for-byte.

Use a clear closed-schema representation such as:

`"reuse": "never"`
or
`"reuse": "clean-tree"`

with `never` as the effective default.

Exact naming may differ only if an existing configuration convention provides a clearly better name.

For `clean-tree` gates:

1. check the existing generic proof mechanism before spawning the shell command;
2. reuse only an exact passing proof satisfying Section A;
3. otherwise execute normally;
4. after a successful execution, persist a proof only if the committed tree still exactly matches the identity validated before execution.

For `never` gates:

* always execute;
* do not skip them because another command happened to pass;
* preserve existing arbitrary-shell semantics.

Document that `clean-tree` is suitable only for deterministic verification commands whose required outcome is the pass/fail result itself. A gate that must create an artifact, contact mutable external state, exercise a live agent/service, publish something, or otherwise perform a required side effect must remain `never`.

### H. Apply repository-gate reuse conservatively to Parallix self-development

After the generic opt-in exists, review Parallix's own configured lifecycle gates individually.

Opt in only commands that are demonstrably deterministic, side-effect-free verification where an exact clean-tree pass is meaningful.

At minimum:

* **build** MUST remain non-reusable if later gates depend on the produced build artifact being present;
* **agent-smoke** MUST remain non-reusable;
* external/live-agent/service-dependent verification MUST remain non-reusable.

Do not opt an integration/E2E gate into reuse merely to produce a larger benchmark improvement. Its dependencies must justify reuse.

It is acceptable for the initial Parallix configuration to opt in only static/repository-local verification while leaving integration/workflow/agent gates `never`.

The product capability and the self-hosting policy are separate decisions.

## Out of Scope

* Dirty-worktree verification proof reuse.
* Caching an agent's uncommitted working state.
* Test-impact analysis or reverse-dependency selection.
* Skipping a hermetic test merely because the test file itself did not change.
* Per-file or per-test result caching.
* Shared CPU token pools or dynamic test concurrency.
* Reintroducing a global `flock` or serialising all test suites.
* Changing the current unit-test concurrency setting.
* Removing required pre-integration, workflow, agent-smoke, packaging, or release verification.
* Guessing whether arbitrary repository shell commands are hermetic.
* Automatically enabling proof reuse for existing repository gates.
* Node/npm/package.json awareness in generic Parallix lifecycle code.
* Making Parallix self-development conventions product defaults.
* Changing verification proofs to rely only on timestamps, path mtimes, checkpoint text, or agent claims.

## Success Criteria

1. `npm test` in the Parallix repository does not invoke the canonical bundle build before running unit tests.

2. `npm test -- <unit-test-file>` does not invoke the canonical bundle build before running that selected test.

3. The underlying default test runner contains no unconditional `npm run build` execution.

4. A successful `npm run test:ci` performs the canonical build exactly once while retaining typecheck, unit, CI-safe integration, bundle-smoke, and package-content coverage.

5. A standalone Parallix integration-test command that requires the canonical build remains usable and performs no more than one explicit build.

6. Parallix's configured pre-integration sequence performs one canonical build, and the following integration test step does not silently perform a second build.

7. Generic Parallix product code gains no knowledge of npm, `package.json`, `test/run-default-tests.ts`, Parallix-specific test tiers, or this repository's build command as a consequence of Criteria 1–6.

8. Handoff repository verification does not invoke its configured verification process when an exact valid passing proof already exists for the current clean HEAD/tree, exact command, tracked inputs, and toolchain.

9. Handoff repository verification executes normally when no proof exists.

10. Handoff repository verification executes normally when the proof's command, commit, tree, tracked-input fingerprint, or toolchain does not match.

11. A dirty worktree cannot reuse a proof.

12. A dirty worktree cannot create a reusable passing proof.

13. A verification run whose inputs change before proof persistence cannot certify the changed tree.

14. Mission-declared gates retain their existing clean-tree proof reuse behaviour and are not weakened.

15. Execute-stage instructions no longer require an agent to run every final mission-declared gate before handing control back to Parallix; they explicitly state that handoff owns authoritative mission-gate execution.

16. Execute-stage instructions still require the agent to perform targeted testing/checking appropriate to the code it changes.

17. Repository lifecycle gates retain today's execute-every-time behaviour when no reuse policy is configured.

18. Repository lifecycle gates explicitly configured for clean-tree reuse skip their shell process only when an exact valid passing proof exists.

19. Invalid repository-gate reuse policy values are rejected by configuration validation rather than ignored.

20. A repository lifecycle gate requiring side effects can remain `never` and is executed even when an identical committed tree was previously observed.

21. A clean-tree reusable repository gate writes a reusable proof after successful execution only if the verified identity still matches after execution.

22. Parallix's own build gate and live-agent/agent-smoke gates are not configured for clean-tree reuse.

23. Tests pin the distinction between:

    * executed verification;
    * safely reused clean-tree proof;
    * proof unavailable/stale/dirty → actual execution.

24. Existing fail-closed verification behaviour remains intact: no stale/missing/malformed proof can turn a command that has not been validly verified for the current committed tree into a pass.

25. `npm test`, the relevant lifecycle/gate regression tests, and the repository's existing pre-integration gate sequence pass after the refactor.

## Risks and Assumptions

* Removing the build from `test/run-default-tests.ts` may expose integration tests that accidentally relied on a previously generated `build/px.mjs`. Treat that as an orchestration dependency to make explicit, not a reason to retain a hidden build in the generic runner.
* Some tests spawn the packaged CLI and genuinely require a current build. Keep that dependency explicit in the owning package script or gate.
* A reusable pass is only meaningful for verification commands whose result is determined by the committed repository inputs and represented toolchain. Arbitrary external/live-state commands must not be silently cached.
* A build gate has both verification and artifact-production semantics. A previous proof does not recreate a missing local build artifact, so build reuse is unsafe when later commands consume that artifact.
* Rebase, version bump, or any other commit/tree mutation naturally invalidates the previous proof. Do not work around this invalidation.
* Different commits intentionally do not share proof authorization in this mission, even if someone believes they are semantically equivalent.
* The existing proof store should be reused rather than introducing a second cache unless an architectural constraint makes that impossible.
* Prefer extending existing proof abstractions over duplicating identity/fingerprint logic in handoff and repository-gate implementations.

## Checkpoints

* CP 1: Lock proof semantics and lifecycle ownership with regression tests

  * Add/adjust tests proving clean committed HEAD/tree identity is mandatory for reuse.
  * Add handoff coverage showing a matching proof prevents process execution and every mismatch causes execution.
  * Add execute-prompt coverage establishing that handoff, not the implementation agent, owns authoritative mission-gate execution.
  * Add repository-gate tests for default `never` versus explicit clean-tree reuse before changing runtime behaviour.

* CP 2: Remove redundant self-development builds

  * Remove the unconditional build from `test/run-default-tests.ts`.
  * Refactor Parallix repository package scripts so standalone integration commands make any required build explicit.
  * Make `npm run test:ci` build exactly once.
  * Change Parallix's pre-integration integration-suite command to consume the build already performed by its explicit build gate.
  * Add regression coverage that catches accidental restoration of hidden/multiple builds.

* CP 3: Consume reusable proof at handoff

  * Change repository verification in handoff to read an exact reusable proof before executing.
  * Preserve fail-closed behaviour for dirty, stale, mismatched, malformed, and changed-during-run inputs.
  * Preserve existing process diagnostics and repair/rebound behaviour for gates that actually execute and fail.
  * Emit clear machine/operator-visible distinction between execution and proof reuse.

* CP 4: Add opt-in reusable repository phase gates

  * Extend the generic gate schema/configuration with explicit `never` / clean-tree reuse semantics.
  * Default to `never`.
  * Route opted-in gates through the existing proof identity/read/write mechanisms rather than creating a parallel cache.
  * Preserve language/toolchain neutrality and arbitrary-shell support.
  * Update configuration documentation with side-effect and determinism restrictions.

* CP 5: Apply conservative self-hosting policy and certify the lifecycle

  * Review each Parallix self-development gate individually.
  * Enable clean-tree reuse only where its semantics are demonstrably safe.
  * Keep build, agent-smoke, external/live, and required-side-effect gates non-reusable.
  * Run targeted regression tests followed by the repository's normal final verification.
  * Verify via instrumentation/test assertions that `test:ci` and Parallix pre-integration do not regress to redundant canonical builds.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:

* A summary of work done.
* A `## Goal Check` section.
* A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status.
* At least one evidence row per applicable criterion using durable references such as:

  1. exact test names;
  2. test file paths;
  3. recognized repository commands;
  4. ADR references where architectural behaviour is relevant.
* For proof-reuse criteria, evidence MUST identify tests that demonstrate both the reuse path and the fail-closed execution path.
* For build-count criteria, evidence MUST demonstrate the number of canonical build invocations mechanically; do not use "the output looked like one build" as the sole evidence.
* For generic-product-boundary criteria, identify tests/source boundaries proving no npm/Parallix-self-development assumption entered generic lifecycle behaviour.
* Raw `stat`, `ls`, timestamps, or generic statements such as "tests pass" are insufficient by themselves.
* A non-generic `Next action:` line at the bottom.

## Gates

* [ ] ./scripts/verify-local.sh all

## Restricted Areas

* Do not weaken or bypass `adapters.gates.preIntegration`.
* Do not remove workflow E2E or agent-smoke coverage.
* Do not modify reusable-proof semantics to allow dirty working trees.
* Do not introduce npm/Node/Parallix-repository assumptions into generic gate execution.
* Do not replace exact proof identity with mtime, TTL, checkpoint prose, agent memory, filename-only, or changed-file heuristics.
* Do not automatically mark arbitrary repository gates reusable.
* Do not make build gates reusable where later steps require their generated artifact.
* Do not solve CPU contention by serialising all mission verification with a global lock.
* Do not create a second independent verification-cache implementation when the existing verification proof abstraction can be extended.
* Do not silently change public configuration defaults.
* Do not remove existing tests merely to make the new build/test orchestration pass.

## Stop Rules

Stop and surface the issue rather than guessing if:

* removing the hidden test-runner build reveals that a test depends on a built artifact but the owning test lane cannot be identified cleanly;
* implementing repository-gate reuse requires weakening the clean-worktree or exact-commit/tree proof invariant;
* a proposed generic solution requires Parallix product code to detect npm, Node, package manifests, or this repository's test structure;
* a gate proposed for reuse has required side effects or depends on mutable external/live state;
* proof reuse would authorize one commit using evidence produced for a different commit;
* the existing proof architecture cannot support repository phase gates without creating an architectural dependency cycle — document the dependency and stop before adding a parallel cache as a workaround;
* build-count reduction would remove an existing verification property rather than relocating its execution explicitly.
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
