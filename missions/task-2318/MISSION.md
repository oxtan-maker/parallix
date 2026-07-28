# Mission: Fix test temp-directory leaks that exhaust /tmp inodes (task-2318)

## Goal
Eliminate test-created `/tmp` directory leaks so Parallix test runs clean up their bootstrap, adapter, stats, and npm-home temporary directories, and add a hygiene guard that makes unsafe `/tmp` inode consumption fail visibly before it can cascade into unrelated test failures.

## Why Now
Repeated test runs have already left roughly 420,000 orphaned directories and can exhaust the tmpfs inode table. Once `/tmp` reaches 100% inode usage, `fs.mkdtempSync()` fails during test bootstrap with `ENOSPC`, making the integration gate report broad, misleading failures until someone manually removes the leaked directories.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: cleanup coverage for approximately 460 unpaired `mkdtempSync` calls, signal-safe bootstrap cleanup, regression coverage, and a post-test inode-usage guard

## Scope
- Add a regression test at `test/task-2318-temp-directory-leaks.test.js` that demonstrates the bootstrap temp-directory leak scenario and asserts cleanup after the controlled termination path.
- Make `test/bootstrap-parallix-home.js` remove every temp directory it creates on normal exit and SIGTERM, using a cleanup strategy that is safe to invoke more than once.
- Audit every `mkdtempSync` call under `test/adapters/` and add deterministic `after()` or `finally` cleanup for each directory created by those tests.
- Add deterministic cleanup for every `mkdtempSync` call in `test/stats.test.ts` and `test/stats-merge-conflict.test.ts`.
- Clean up auto-created `tempHome` directories in `test/task-1424-post-integrate-publish-reinstall.test.ts` and `test/package-persistent-data.test.ts`, while preserving caller-provided temp-home directories.
- Add or extend the repository test-hygiene/CI check to fail and report when `/tmp` inode usage is at or above the selected 80% threshold after test execution.

## Out of Scope
- Removing existing orphaned directories from a developer or CI host.
- Changing production runtime temporary-directory behavior outside test code and test verification tooling.
- Replacing the Node test runner, changing global timeout policy, or making test processes immune to SIGKILL.
- Cleaning unrelated test fixtures that do not use `mkdtempSync` or do not contribute to the listed `/tmp` prefixes.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The regression test `test/task-2318-temp-directory-leaks.test.js` fails on the mission parent commit because the controlled bootstrap termination leaves a directory with the test’s unique `parallix-test-*` prefix, and passes after the cleanup change by finding zero such directories.
- `test/bootstrap-parallix-home.js` has one idempotent cleanup path that removes all eight bootstrap temp directories it creates, and that path is registered for both `exit` and `SIGTERM`.
- Every `mkdtempSync` call in `test/adapters/` has a matching removal on its test’s `after()` or `finally` path; the changed tests retain no directory they created once their cleanup path completes.
- Every `mkdtempSync` call in `test/stats.test.ts` and `test/stats-merge-conflict.test.ts` has a matching `fs.rmSync(..., { recursive: true, force: true })` cleanup path.
- The two npm-home tests remove an auto-created `tempHome` after completion and do not remove a `tempHome` supplied by their caller.
- The repository hygiene/CI check fails with a diagnostic when `/tmp` inode usage is at least 80% after test execution and passes below that threshold.
- `./scripts/verify-local.sh all` succeeds with no focused tests and no unannotated skipped tests added by this mission.

## Risks and Assumptions
- Signal handlers can change Node termination semantics or run cleanup twice; cleanup must be idempotent and preserve the expected SIGTERM exit behavior.
- Broad cleanup edits across many tests can remove fixtures before asynchronous assertions finish; each test must retain ownership of only the directory it created.
- Host-level `/tmp` inode state is shared and nondeterministic; guard tests must mock filesystem/stat inputs rather than depending on the real host inode count.
- The mission assumes the listed `mkdtempSync` sites are test-only and that recursive forced removal is acceptable for directories created with unique test prefixes.

## Checkpoints
- CP 1: Lock the bug before a fix: author `test/task-2318-temp-directory-leaks.test.js` under `test/` to launch the bootstrap in a controlled termination scenario, identify the unique `parallix-test-*` directories it creates, and assert that zero remain after termination. On the mission parent commit this assertion must be red because cleanup is exit-only; after the fix it must be green. Do not modify cleanup implementation before recording the red result.
- CP 2: Implement and verify ownership-bound cleanup for bootstrap, adapter, stats, and npm-home test directories; add focused mocked coverage for the inode guard and confirm cleanup does not delete caller-owned `tempHome` directories.
- CP 3: Run the repository verification gate, inspect the final changed paths for unpaired temporary-directory ownership, and document criterion-by-criterion evidence for handoff.

Reproduction-Test: test/task-2318-temp-directory-leaks.test.js

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done and a non-generic `Next action:` line at the bottom.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited Markdown table with this exact header: `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion. Accepted evidence includes existing file:line references, exact test names, ADR references, test file paths, and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For CP 1, evidence must identify `test/task-2318-temp-directory-leaks.test.js`, give its exact test name, and record the parent-commit red result before cleanup implementation begins.
- For later checkpoints, pair every cleanup claim with the changed file:line reference and the exact test name or test-file path; pair guard claims with its test and the recognized command used to run it.
- Raw `stat`/`ls` output or generic prose alone is not enough. It may be supplemental context only and must be paired with one of the accepted references above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Bootstrap leak is locked red-to-green | `test/task-2318-temp-directory-leaks.test.js`, exact regression-test name | PASS |
| Adapter and stats directories have paired cleanup | changed test file:line references and exact test names | PASS |
| Repository verification completed | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not alter production code, public CLI behavior, test-runner selection, or global timeout settings unless a discovered test-only dependency makes it unavoidable and the mission is re-scoped.
- Do not delete existing `/tmp/parallix-test-*` directories as part of verification; tests must prove cleanup using only directories they create with unique prefixes.
- Do not add real Forgejo access, subprocess-heavy integration behavior, or host-dependent inode assertions to unit tests; mock external and filesystem-capacity dependencies.

## Stop Rules
- Stop and request re-scoping if the required cleanup needs changes outside test files, test bootstrap, or repository hygiene/CI tooling.
- Stop and report the limitation if the Node runner uses SIGKILL for the reproduction path, because no JavaScript signal or exit handler can guarantee cleanup after SIGKILL; document an alternative containment strategy before proceeding.
- Stop and request direction if a proposed cleanup would remove a caller-supplied directory or any directory whose ownership cannot be proven by a unique test-created prefix.
- Stop and request direction if the inode guard cannot be tested with mocked capacity data without inspecting or depending on the host `/tmp` state.
