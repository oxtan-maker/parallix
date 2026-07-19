# Mission: Make test and runtime temporary-file writers clean up /tmp (task-2241)

## Goal
Bound Parallix-owned temporary storage by making its production and test temporary-file writers clean up on success and failure, while preserving an explicit, safe diagnostic-retention option and clearly classifying temporary-storage failures in the real-agent smoke and handoff flows.

## Why Now
Temporary artifacts accumulated until `/tmp` was 99% full (16 GiB used and 284 MiB free), preventing Git from creating lock and index files. That condition was surfaced as a generic handoff-to-review failure even though the workflow itself remained healthy after space was reclaimed. Repeated local and CI-style runs can recreate the same disk-pressure failure unless writers, diagnostics, and classification are made bounded and observable.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: repository-wide ownership audit of temporary writers; cleanup behavior for normal and exceptional exits; real-agent smoke preflight and error taxonomy; regression coverage for storage residue and safe retention.

## Scope
- Inventory Parallix production and test helpers that create temporary directories, files, stdout/stderr captures, clones, worktrees, and compile-cache artifacts, and document each writer's ownership and cleanup responsibility in the implementation checkpoint.
- Add ownership-safe cleanup for artifacts created by those writers on normal completion, launch errors, command failures, and timeout/error paths.
- Provide an explicit opt-in diagnostic-retention mechanism that leaves only the artifacts created by the current run and does not turn normal runs into retained diagnostics.
- Add regression coverage for real-agent smoke stdout/stderr capture cleanup, including failed launch and timeout cases.
- Add a temporary-capacity preflight to the real-agent smoke harness before fixture creation, with a distinct environment/resource result when capacity is insufficient.
- Preserve the originating Git failure through handoff failure handling and classify ENOSPC plus Git index/lock-creation failures as environment/resource failures in the smoke harness.
- Verify representative repeated runs do not add unbounded Parallix-owned residue beneath the configured temporary root.

## Out of Scope
- Deleting, sweeping, or reclaiming arbitrary shared `/tmp` content, including artifacts not proven to be owned by the current Parallix run.
- Changing Git's own temporary-file behavior, operating-system disk quotas, or host cleanup policies.
- Changing unrelated workflow lifecycle semantics, task state transitions, or agent behavior beyond preserving and classifying the existing underlying failure.
- Retrofitting cleanup into third-party tools where Parallix does not control artifact ownership.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: The completed writer inventory identifies every in-scope production and test temporary writer named in Scope, its created artifact type, its owner, its cleanup point, and its retention behavior.
- SC2: For every inventoried writer that owns an artifact, automated tests cover both a successful execution and an applicable failure, launch-error, or timeout execution and show that the writer's artifact is removed; explicitly retained artifacts are covered by an opt-in retention test.
- SC3: The real-agent smoke harness removes its stdout and stderr capture files after normal completion, launcher failure, and timeout failure, unless the documented retention option is enabled.
- SC4: Cleanup code only removes paths created and owned by the current run; tests demonstrate that an operator-provided path and a concurrently active path are not recursively deleted.
- SC5: A repeated representative verification scenario has an automated residue assertion showing that Parallix-owned temporary artifacts from completed runs do not accumulate without bound under the configured temporary root.
- SC6: Before creating its fixture, the real-agent smoke test checks available temporary capacity; insufficient capacity produces an explicit environment/resource classification that identifies temporary-storage exhaustion.
- SC7: A Git ENOSPC, index-creation, or lock-creation failure in handoff retains the original error detail and is classified by the smoke/handoff reporting path as an environment/resource failure rather than a Parallix lifecycle regression.
- SC8: The required verification gate completes successfully on the final mission tree with no focused or unannotated skipped tests introduced.

## Risks and Assumptions
- Risk: broad cleanup can delete an operator's diagnostics or an active worktree. Assumption: each cleanup target can be tied to a unique path created by the current process; otherwise implementation stops for direction.
- Risk: filesystem free-space reporting and ENOSPC errors differ by platform. Assumption: the existing supported test environment exposes a usable temporary-root capacity signal; platform-specific behavior must be explicitly tested or documented.
- Risk: retaining diagnostic artifacts can reintroduce unbounded growth. Assumption: retention is disabled by default and is scoped to artifacts from one invocation.
- Risk: real-agent smoke tests are timing-sensitive. Assumption: failure and timeout fixtures can be made deterministic without requiring an actual disk-full host.

## Checkpoints
- CP 1: Author the failing reproduction test at `test/task-2241-tmp-cleanup-repro.test.js` before writing a fix. It must create a representative Parallix-owned temporary artifact through the affected writer and assert that it is absent after the relevant failure/timeout completion path. At the mission parent commit the assertion must fail because the artifact remains (red); after the cleanup implementation it must pass (green). Record the exact parent-commit test command and red result in CP-1.

Reproduction-Test: test/task-2241-tmp-cleanup-repro.test.js

- CP 2: Build the temporary-writer inventory, then implement ownership-scoped cleanup and default-off diagnostic retention. Add focused tests for normal, failure, launch-error, timeout, opt-in retention, and non-owned/concurrently active paths.
- CP 3: Implement and test smoke temporary-capacity preflight plus ENOSPC/Git lock/index error preservation and environment/resource classification. Add repeated-run residue coverage and run the required repository gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited markdown table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already verifies:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.js` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough. It may appear only as supplemental context and must be paired with at least one accepted reference above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Shared temporary roots such as `/tmp`, operator-selected directories, existing clones/worktrees, and paths not created by the current Parallix run: never delete or recursively clean them.
- Git repositories and worktrees used by concurrent Parallix processes: cleanup may target only a uniquely owned path after the owning process has completed.
- Diagnostic retention: it must remain opt-in and must not be enabled by default for tests, smoke runs, or runtime execution.
- Handoff and real-agent lifecycle behavior: preserve existing success and failure semantics except for surfacing underlying storage/Git details and assigning the required environment/resource classification.

## Stop Rules
- Stop and request direction if a temporary artifact cannot be proven to have been created by the current run before cleanup is added.
- Stop and request direction if satisfying cleanup requires deleting a shared temporary root, an operator-selected directory, or an active clone/worktree.
- Stop and request direction if the supported environment has no reliable temporary-capacity signal and no deterministic way to test the insufficient-capacity branch.
- Stop and request direction if preserving the underlying Git error requires changing public handoff result contracts beyond adding the required diagnostic detail and classification.
