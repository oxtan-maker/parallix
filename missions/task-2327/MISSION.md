# Mission: Reclaim coverage-gate temporary directories after SIGKILL (task-2327)

## Goal
Make coverage-gate recover its own orphaned `node-coverage-*`, `coverage-gate-tmp-*`, and `graphify-*` scratch directories after a coverage-gate process is terminated with `SIGKILL`, without deleting directories owned by a live or unrelated process.

## Why Now
TASK-2326's `/tmp/` sweep removed approximately 4,410 `node-coverage-*` and 2,000 `coverage-gate-tmp-*` directories. Coverage-gate currently relies on in-process `exit`, `SIGINT`, and `SIGTERM` cleanup, which cannot run after `SIGKILL`; repeated coverage verification therefore accumulates orphaned filesystem state on developer and agent hosts.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate after locking the SIGKILL regression with the required reproduction test.
- Main drivers: three coverage-gate scratch-directory prefixes, process-death persistence, safe ownership tracking, and interaction with TASK-2326's manifest-based orphan cleanup.

## Scope
- Add a regression test at `test/task-2327-coverage-gate-tmp-leaks.test.ts` that creates coverage-gate-owned scratch directories in a killable child process, terminates that process with `SIGKILL`, and verifies the designated recovery path reclaims only those orphaned roots.
- Investigate the coverage-gate lifecycle and select a persistent ownership mechanism compatible with its independent invocation model: reuse the per-run manifest protocol where appropriate or add an equivalent coverage-gate-local manifest and orphan sweep.
- Update `src/platform/runtime/lib/commands/coverage-gate.ts` and focused tests as required to register all three coverage-gate scratch-directory classes before they can be orphaned, reclaim registered roots after a terminated run, and preserve existing normal/failure cleanup.
- Cover recovery safety for an active/concurrent run or an unrelated matching directory so orphan cleanup has a demonstrable ownership boundary.

## Out of Scope
- Changing the coverage percentage, denominator, LCOV reporting, or test-discovery behavior of coverage-gate.
- Performing a broad `/tmp/` cleanup, deleting unregistered matching directories, or retroactively reclaiming directories without a verifiable coverage-gate ownership record.
- Reworking TASK-2326's general test-bootstrap cleanup architecture beyond the smallest compatible interface needed by coverage-gate.
- Changing unrelated commands, integration-pipeline policy, or documentation unrelated to coverage-gate temporary-directory ownership.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `test/task-2327-coverage-gate-tmp-leaks.test.ts` contains a subprocess-based regression that is red at this mission's parent commit: after the subprocess creates coverage-gate scratch state and is killed with `SIGKILL`, the test's recovery assertion finds the orphaned registered root still present; the same assertion is green after the fix.
- SC2: Every scratch root created by coverage-gate with the `node-coverage-*`, `coverage-gate-tmp-*`, or `graphify-*` prefix is recorded in durable per-run ownership state before child work can leave it orphaned.
- SC3: A subsequent designated coverage-gate recovery path removes the SIGKILL-orphaned roots recorded for the terminated run and removes the associated ownership record, as asserted by the focused regression test.
- SC4: The focused tests prove the recovery path does not remove a root belonging to a live concurrent coverage-gate run or an unregistered directory with one of the three matching prefixes.
- SC5: Existing coverage-gate normal and error-path cleanup behavior remains covered, and `./scripts/verify-local.sh all` exits successfully on the final tree.

## Risks and Assumptions
- Risk: `SIGKILL` prevents JavaScript cleanup handlers from running, so the ownership record must be flushed synchronously before a killable boundary. Mitigation: make the red reproduction kill a real child process and assert recovery from persisted state.
- Risk: prefix-based deletion could remove another run's directory. Mitigation: recover only paths listed in a run-specific ownership record and add a live/concurrent or unregistered-directory safety assertion.
- Risk: coverage-gate may run outside the default test bootstrap. Assumption: the implementation will choose a coverage-gate-local recovery entry point if bootstrap environment variables are unavailable, rather than assuming bootstrap participation.
- Assumption: tests can use isolated temporary roots and mocked child processes where needed, and will not invoke Forgejo or expensive external agents.

## Checkpoints
- CP 1: Author the failing reproduction test before any production fix. Add `test/task-2327-coverage-gate-tmp-leaks.test.ts`; it must launch a killable coverage-gate-owned subprocess that creates the registered scratch roots, terminate it with `SIGKILL`, invoke the planned recovery entry point, and assert that the orphaned root remains at the parent commit (red) but is removed once the fix is applied (green). Record the initial red result in the checkpoint document.
- CP 2: Trace coverage-gate scratch-root creation and cleanup, choose the smallest persistent ownership/recovery design compatible with independent coverage-gate execution, and implement registration plus orphan recovery for all three prefixes.
- CP 3: Add ownership-boundary coverage for a live concurrent run or unregistered matching root, confirm normal/error cleanup coverage remains intact, and run the required verifier with final Goal Check evidence.

Reproduction-Test: test/task-2327-coverage-gate-tmp-leaks.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2327-coverage-gate-tmp-leaks.test.ts` ``, `` `node --test test/task-2327-coverage-gate-tmp-leaks.test.ts` ``, `` `git diff --check` ``, `` `px checkpoint task-2327` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough: it may appear as supplemental context only when paired with one of the accepted file:line references, exact test names, ADR references, test file paths, or recognized repo commands/paths above.
- A non-generic `Next action:` line at the bottom that names the remaining criterion or concrete verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change coverage thresholds, source inclusion/exclusion rules, LCOV output, or the user-facing coverage report.
- Do not add a prefix-only cleanup sweep of `/tmp/`; recovery must require a durable ownership record for the specific terminated coverage-gate run.
- Do not alter `test/bootstrap-parallix-home.js` or `test/run-default-tests.ts` unless the selected design demonstrably requires a minimal compatibility change; retain TASK-2326's concurrency-safe manifest semantics.
- Do not modify mission orchestration, review/integration commands, backlog ownership (`assignee`), or unrelated test infrastructure.

## Stop Rules
- Stop and request design direction if persistent ownership cannot be established before a killable boundary without changing the shared test-bootstrap manifest contract or public coverage-gate behavior.
- Stop and request direction if the only recovery strategy available would delete roots based solely on their `/tmp/` prefix, cannot distinguish active ownership, or risks deleting a user-created directory.
- Stop and report the failing criterion if the required red reproduction cannot be made deterministic with an isolated subprocess and temporary root; do not replace it with a timing-dependent or mocked-only SIGKILL claim.
