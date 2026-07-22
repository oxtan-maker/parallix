# Mission: Strengthen the defence (task-2298)

## Goal
Establish and enforce an explicit execution-root contract across Parallix defenses so every mission-scoped verification, proof, and publication action operates on the selected mission worktree, never an ambient or primary checkout.

## Why Now
The existing defense surface spans local verification, integration, workflow tests, handoff/review/rebase, and publication. If any layer silently resolves the primary checkout after a mission root is selected, a clean primary tree can incorrectly authorize a failing, dirty, stale, or mismatched mission tree. This mission closes that class of false-positive release and review decisions before more defense paths accumulate the same assumption.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: Medium
- Selection note: activate as-is; begin with a complete call-site inventory before changing root resolution.
- Main drivers: cross-cutting execution-root propagation, two-worktree behavioral coverage, and publication-proof validation.

## Scope
- Inventory every production-defense use of `process.cwd()`, `getPrimaryWorktree()`, `resolveWorktree()`, `rootDir`, `cwd`, and child-process `cwd`; classify each call site as primary-only, target-worktree, or invalid.
- Define and apply one explicit selected-target-root flow through `verify-local`, the default/unit runner, static analysis, integration gate planning and execution, workflow E2E, real-agent smoke tests, checkpoint, handoff, review, rebase, exact-tree proof, Forgejo publication, integration, and applicable hook/pre-push paths.
- Remove invalid fallback resolution after a mission worktree has been selected, including subprocesses, Git operations, asset/config/task lookup, temporary paths, and publish proof construction.
- Add fast mocked/temporary-repository tests for every defense family that exercise both a valid mission tree with an invalid primary tree and an invalid mission tree with a valid primary tree, including nested command propagation.
- Validate publication APIs reject root, tree, proof, or branch mismatches before any remote push.
- Document and test the narrow primary-root exceptions that intentionally act on the primary checkout, including review-baseline synchronization.

## Out of Scope
- Changing Parallix product behavior unrelated to selecting and propagating a defense execution root.
- Replacing Forgejo, changing remote-review policy, or contacting a real Forgejo service during tests.
- Launching real agents or adding slow recursive CLI tests; coverage must use mocks and temporary repositories.
- Broad cleanup of unrelated worktree utilities beyond call sites needed to enforce this contract.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Every audited production-defense root-resolution call site is recorded as primary-only, target-worktree, or invalid; no invalid call site remains in the defense paths named in Scope.
- Each named defense family accepts or resolves one selected target root and uses it for all nested subprocesses, Git calls, configuration/task/asset lookup, temporary paths, and proof construction relevant to that family.
- For each named defense family, automated two-worktree tests prove: (a) a valid selected mission tree succeeds when the primary tree is failing, dirty, or stale; and (b) an invalid selected mission tree fails when the primary tree is clean.
- Nested-command tests fail when a child process runs in the primary or ambient working directory and pass only when the selected target root is preserved through every command level.
- Publication-facing APIs reject a mismatched proof root, tree, or branch before a remote push is attempted, with mocked remote interactions proving no push call occurs.
- Every retained primary-root exception is explicitly documented, limited to an operation on primary itself, and has an independent automated test.
- New tests use only mocks and temporary repositories; no test contacts real Forgejo, launches a real agent, or invokes expensive recursive CLI work.
- `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` complete successfully on the final mission tree.

## Risks and Assumptions
- Risk: root resolution is implicit in deeply nested command helpers, so a superficial top-level `cwd` change can leave a child process on the ambient checkout. Mitigation: inventory call sites first and require nested-command two-worktree tests.
- Risk: test fixtures accidentally invoke Forgejo, agents, or recursive CLI commands. Assumption: existing test seams can be mocked; keep fixtures as temporary repositories and assert command arguments instead of executing external systems.
- Risk: a legitimate primary-root action is broken while removing fallback behavior. Mitigation: enumerate primary-only exceptions, document their reason, and give each independent coverage.
- Assumption: mission worktrees can be constructed with deliberately different validity, dirtiness, and freshness states in unit/integration fixtures.

## Checkpoints
- CP 1: Map the execution-root contract. Produce the call-site inventory for all Scope defense families, classify every root/CWD resolution, identify legitimate primary-only exceptions, and identify the test seams needed for two-worktree fixtures.
- CP 2: Propagate the selected target root through local verification and test defenses: `verify-local`, default/unit runner, static analysis, integration gate planning/execution, workflow E2E, real-agent smoke tests, and nested subprocess helpers. Add mocked/temporary-repository two-worktree tests for each changed family.
- CP 3: Harden lifecycle and publication defenses: checkpoint, handoff, review, rebase, exact-tree proof, Forgejo publication, integration, and applicable hook/pre-push paths. Add mismatch rejection and no-push tests, then document/test primary-only exceptions.
- CP 4: Complete the defense audit, remove any remaining invalid fallback, run the required gates, and prepare a final Goal Check that maps every success criterion to precise implementation and test evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`
- At least one evidence row per applicable criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `node ...` ``, `` `git ...` ``, `` `px ...` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not sufficient evidence; if shell output is included, pair it with at least one accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above.
- A non-generic `Next action:` line at the bottom that names the next defense family or audit action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not weaken, bypass, or remove integration gates, exact-tree proof, publication safeguards, or pre-push enforcement to make tests pass.
- Do not make mission-scoped code infer a root from ambient `process.cwd()`, module location, or a discovered primary checkout after selection of a mission root.
- Do not introduce tests that access real Forgejo or launch real agents; use mocks and temporary repositories only.
- Preserve explicitly documented primary-root operations solely for operations that intentionally act on primary, and do not repurpose them for mission verification.

## Stop Rules
- Stop and escalate if enforcing a selected root requires changing the public worktree-selection contract or remote-review policy rather than correcting defense propagation.
- Stop and escalate if a required defense family cannot be tested with mocks and temporary repositories without contacting Forgejo, launching an agent, or running recursive CLI work.
- Stop and escalate if an alleged primary-only exception cannot be tied to an operation on primary itself and independently tested.
- Do not mark the mission complete while any Scope defense family lacks both required two-worktree behavioral cases, while a publication mismatch can reach a push attempt, or while either required gate fails.
