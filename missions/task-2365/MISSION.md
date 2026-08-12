# Mission: Reclaim all Parallix-owned temporary directories (task-2365)

## Goal
Make every Parallix-owned temporary directory created while Parallix develops and verifies itself reclaimable on normal completion, failure, `SIGINT`, `SIGTERM`, and the next eligible run after `SIGKILL`. This includes the real-agent smoke fixture, test-worker fixtures, and verification-runner scratch space.

## Why Now
The current draft narrowed the incident to `parallix-real-agent-*`, but `/tmp` contains thousands of leaked Parallix artifacts: 1,503 `task-2339-aggregate-*`, 1,212 `node-coverage-*`, 1,010 `codex-home-*`, 1,000 `task-2339-*`, plus `parallix-test-*`, `coverage-gate-*`, `forgejo-sync-*`, and other test-owned roots. Two leaked real-agent roots alone consume about 185 MiB each. A smoke-test signal handler cannot reclaim the much larger self-hosted verification residue.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: replace the smoke-test-only premise with ownership-scoped runner recovery and a complete temporary-root audit
- Main drivers: manifest coverage, signal ordering, self-hosted verification scripts, real-agent fixture cleanup, no deletion of operator-owned `/tmp` data

## Scope
- Inventory every `mkdtemp`, `mktemp`, direct `/tmp` write, and temporary-root environment override in `src/`, `scripts/`, and `test/`; classify the owner, lifecycle, and retention contract.
- Route every temporary root created by the self-hosted unit-test and verification paths through one ownership-scoped registration/cleanup mechanism, or give a standalone creator an equivalent `try`/`finally` cleanup.
- Fix `test/run-default-tests.ts` and any invoked verification scripts so they clean their own manifest, registered roots, and runner scratch before propagating a child status or signal; handle `SIGINT` and `SIGTERM` at each process boundary that owns roots.
- Preserve recovery after an uncatchable `SIGKILL`: a later eligible Parallix verification run must reclaim only roots recorded as owned by dead Parallix processes before creating new roots.
- Cover real-agent repository and capture roots through the same ownership model or an equally safe local mechanism; normal, failure, timeout, `SIGINT`, and `SIGTERM` cleanup must remain idempotent.
- Add focused, mocked tests for the audit’s missing artifact classes and the process-boundary cleanup ordering. Update durable documentation only if supported retention or recovery behavior changes.

## Out of Scope
- A blanket `/tmp` sweep, age-based janitor, inode quota, or deletion of pre-existing paths that cannot be proven owned by the current or a recorded dead Parallix run.
- Catching `SIGKILL`, recovering files from a live process, or changing OS/CI storage policies.
- Changing production mission semantics, agent selection, Forgejo behavior, or real-agent execution other than their temporary-artifact lifecycle.
- Retention policy beyond existing explicit diagnostic opt-ins.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test at `test/task-2365-tmp-reclamation.test.ts` is red on the mission parent commit and green after the fix. It creates recorded roots for the observed classes `parallix-real-agent-*`, `node-coverage-*`, `coverage-gate-tmp-*`, `codex-home-*`, and `task-2339-aggregate-*`; it proves the owner removes only those recorded roots and leaves an adjacent unrecorded path untouched.
- The completed inventory accounts for every creation site in `src/`, `scripts/`, and `test/` found by the audit. Each site either registers its root before child work begins, removes its own root in `finally`, or is an explicit durable-retention exception with its owner and cleanup trigger recorded in the regression test or source comment.
- `test/run-default-tests.ts`, `src/adapters/verification/coverage-gate.ts`, and any shell/script wrapper that creates or owns verification temporary roots remove their owned paths before propagating child failure, `SIGINT`, or `SIGTERM`; repeated cleanup is harmless.
- A process killed by `SIGKILL` leaves a durable, ownership-scoped record before its registered root is used. The next eligible self-hosted verification invocation removes roots from dead recorded processes and removes the corresponding record, without removing roots from a live process or an unrecorded path.
- `test/e2e-real-agent-smoke.test.ts` retains its opt-in diagnostic behavior and removes its repository and capture roots on ordinary completion and handled interruption without launching a real agent in regression coverage.
- A representative `npm test` and coverage-gate invocation leave no newly created, non-retained Parallix-owned temporary roots after their processes return. `./scripts/verify-local.sh static-analysis` completes successfully on the final tree.

## Risks and Assumptions
- Signal handlers are process-global; tests must call a cleanup seam rather than deliver a real signal to the test runner.
- `SIGKILL` can only be recovered by a later process, so registration must be synchronous and precede work that writes into the root.
- `/tmp` is shared: prefix matching alone is insufficient authority to delete. A recorded ownership boundary and dead-PID check are mandatory.
- Test files can run individually outside the self-hosted runner. Such paths need local `finally` cleanup rather than relying solely on a runner manifest.

## Checkpoints
- CP 1: Write `test/task-2365-tmp-reclamation.test.ts` before implementation. It must be red at the parent commit, simulate dead and live owners without real signals or agents, and prove recorded-root-only recovery for all five observed artifact classes.
- CP 2: Audit the creation sites in `src/`, `scripts/`, and `test/`. Move self-hosted creators onto the existing minimal registration helper where possible; add local `finally` cleanup only for isolated invocation paths. Record the completed inventory in the checkpoint evidence, not live documentation.
- CP 3: Repair manifest lifecycle and signal ordering in the runner, coverage gate, and their owning script boundary. Add mocked tests for normal failure, `SIGINT`, `SIGTERM`, dead-process recovery, and preservation of live/unrecorded roots.
- CP 4: Bring the real-agent repository and capture roots under the same contract, retain explicit diagnostic opt-in behavior, then run the required static-analysis gate and representative focused verification.

Reproduction-Test: test/task-2365-tmp-reclamation.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion. Lead with durable evidence Parallix verifies today: exact test names, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. Use `test/task-2365-tmp-reclamation.test.ts`, `test/run-default-tests.ts`, `src/adapters/verification/coverage-gate.ts`, `test/e2e-real-agent-smoke.test.ts`, and `./scripts/verify-local.sh static-analysis` where applicable. File:line references are accepted parenthetically when necessary, but discouraged because line numbers rot.
- Raw `stat`/`ls` output or generic prose alone is not enough: pair it with one of the accepted references above.
- A non-generic `Next action:` line at the bottom.

## Gates
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Never delete a `/tmp` path based only on its name or age. Delete only a root created by the current process or listed in a manifest for a confirmed-dead owner.
- Do not start real agents, contact Forgejo, or send actual process signals in unit tests.
- Do not add a background daemon, dependency, or broad cleanup command.

## Stop Rules
- Stop and seek direction if any observed artifact cannot be attributed to a Parallix creation site.
- Stop and seek direction if the only recovery design requires deleting unrecorded paths, guessing ownership from a prefix, or changing a non-Parallix process.
- Stop if handling a signal safely requires altering unrelated production process semantics.
