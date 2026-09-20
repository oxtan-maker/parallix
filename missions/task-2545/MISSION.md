# Mission: Make the six GitHub-CI tests green by removing CI env/git leakage (task-2545)

## Goal
Make the six failing tests in `test/forgejo.test.ts` and `test/task-2544-sonar-worktree-isolation.test.ts` pass on the clean GitHub-hosted runner by removing the CI-only environment and real-git leakage that makes them non-hermetic, and keep them in the GitHub-safe (`integration-ci`) lane. If, after diagnosis, a specific test genuinely requires state a clean runner cannot provide, move only that test file to the `integration-local` tier (with a written reason in `INTEGRATION_LOCAL_REASONS`) instead of fixing it in place.

Concretely, the six failures are:
- `test/forgejo.test.ts` — `getPrStatus and syncMerged share the same FORGEJO_USER fallback contract`
- `test/forgejo.test.ts` — `syncMerged treats 409 Conflict as success if commits match (already merged)`
- `test/forgejo.test.ts` — `syncMerged treats 405 Method Not Allowed as success if commits match (already merged)`
- `test/forgejo.test.ts` — `syncMerged fails on 409 Conflict if commits do NOT match`
- `test/task-2544-sonar-worktree-isolation.test.ts` — `task-2544: two distinct branch analyses resolve to distinct identities`
- `test/task-2544-sonar-worktree-isolation.test.ts` — `task-2544: querying one branch analysis targets only that branch identity`

## Why Now
These six tests are registered in `INTEGRATION_CI_TESTS` (the GitHub-safe lane) but fail on the GitHub-hosted runner via `npm run test:integration:ci` while passing on a local workstation. The runner-supplied `GITHUB_REF_NAME` and any `FORGEJO_*`/`PARALLIX_SONAR_*` variables leak into code paths the tests assume are empty, and several `syncMerged` assertions reach real `git` through `reconcileForgejoBase` against `process.cwd()` (the CI checkout). A CI lane that fails is a broken gate; the regression blocks a clean `npm run test:ci` and must be closed.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: six `integration-ci` tests fail on the clean runner due to environment/git leakage; fix hermeticity in place or re-classify the offending file(s) to `integration-local`.

## Scope
- Diagnose the exact CI-only dependency for each of the six failing assertions by static review of `test/forgejo.test.ts`, `test/task-2544-sonar-worktree-isolation.test.ts`, and the code they exercise (`scripts/sonar-local.ts` `resolveSonarBranch`/`resolveSonarProjectKey`; `src/adapters/forgejo/forgejo-git.ts` `syncMerged`/`reconcileForgejoBase`; `src/adapters/forgejo/forgejo-auth.ts` `resolveForgejoUser`/`readToken`).
- Confirmed root causes to address (verify each during execution):
  - `GITHUB_REF_NAME` / `PARALLIX_SONAR_BRANCH` leak into `resolveSonarBranch` (`scripts/sonar-local.ts:125`), so `resolveSonarProjectKey` returns a branch-derived key instead of `parallix` for the seeded `main` repo. Fix: the task-2544 test must save and clear these variables so `resolveSonarBranch` falls back to the seeded repo's real `git rev-parse --abbrev-ref HEAD`.
  - The three `syncMerged` tests (409-success, 405-success, 409-sha-mismatch) call `syncMerged` without `rootDir` and without a `gitRunner` mock, so `reconcileForgejoBase` runs real `git -C <cwd>` against the CI checkout and returns `overwrite-refused` / the wrong error. Fix: drive each assertion against a temporary fixture Git repository with a `gitRunner`/`gitFetch`/`gitPush`/`gitDelete` contract so no real checkout is touched.
  - The `FORGEJO_USER` fallback test depends on `FORGEJO_USER`/`FORGEJO_HOME` and token files; confirm the CI environment is isolated and, if it leaks, make the assertion hermetic.
- Update `test/lib/test-categories.ts` only if a file is moved out of `INTEGRATION_CI_TESTS` into `INTEGRATION_LOCAL_TESTS` with a written reason in `INTEGRATION_LOCAL_REASONS`.
- Do not change production behavior in `forgejo-git.ts`, `sonar-local.ts`, or any other source beyond what is strictly required to make a test hermetic (none is expected — the fix is in the test layer).

## Out of Scope
- Any change to SonarQube identity semantics (ADR 0060), `syncMerged` merge logic, or Forgejo auth contract.
- Fixing tests that are not in the six listed above.
- Adding new production features, new dependencies, or new configuration.
- Running real-agent / lifecycle e2e suites or the full `integration-local` tier beyond the single `./scripts/verify-local.sh all` gate permitted for this draft.

## Success Criteria
> Falsifiability rule (ADR 0039 Part 2): each criterion below is falsifiable and cites a concrete evidence form.

- SC1: All six named assertions pass on the clean-runner subset. Evidence: `` `npm run test:integration:ci` `` exits 0 with those six test names reported passing (or the moved file reported in the local tier).
- SC2: `test/forgejo.test.ts` and `test/task-2544-sonar-worktree-isolation.test.ts` remain classified in `INTEGRATION_CI_TESTS` unless a file is intentionally moved — in which case the moved file is absent from `INTEGRATION_CI_TESTS` and present in `INTEGRATION_LOCAL_TESTS` with a non-empty entry in `INTEGRATION_LOCAL_REASONS`. Evidence: grep the file for the moved path in each array; `` `./scripts/verify-local.sh all` `` passes `test/test-categories.test.ts`.
- SC3: No focused or unannotated skipped tests introduced (no `.only`, no bare `.skip`). Evidence: `` `./scripts/verify-local.sh static-analysis` `` (test-hygiene stage) passes.
- SC4: No new GitHub-CI-prohibited dependency was introduced into the CI lane (no real Forgejo, no operator-installed tooling, no non-runner binaries). Evidence: `test/lib/test-categories.ts` `PROHIBITED_CI_DEPENDENCY_MARKERS` scan passes under `test/test-categories.test.ts`.
- SC5: No production behavior regressed. Evidence: `` `npm test` `` (unit) and `` `npm run test:integration` `` (full integration layer) pass on the final tree.
- SC6: Verification gate ran with captured proof. Evidence: `` `./scripts/verify-local.sh all` `` exits 0 with the command output captured in the checkpoint.

## Risks and Assumptions
- Assumes the six failures are purely hermeticity/environment issues, not a real production regression. If a failing assertion encodes correct behavior that the source violates, the fix moves to the production source and the mission scope widens — verify the assertion's intent before editing.
- Assumes `GITHUB_REF_NAME` is the only runner-supplied variable that leaks into `resolveSonarBranch`; confirm `PARALLIX_SONAR_BRANCH` is not also set in the runner env.
- Assumption that `syncMerged` can be driven hermetically via a temp fixture repo; if `reconcileForgejoBase` inherently needs remote refs a temp repo lacks, the fallback is to move `test/forgejo.test.ts` to `integration-local` with a reason rather than ship a broken CI test.
- The parent commit for red/green is the current checked-out mission-commit baseline (the tests already fail there).

## Checkpoints
- CP 1: Reproduce (red) — run the six named assertions against the parent commit and capture the exact failing assertions as the lock.
- CP 2: Fix the Sonar branch-identity env leak in `test/task-2544-sonar-worktree-isolation.test.ts` (save + clear `GITHUB_REF_NAME` / `PARALLIX_SONAR_BRANCH`).
- CP 3: Fix the three `syncMerged` assertions in `test/forgejo.test.ts` to run against a temporary fixture Git repository with a `gitRunner`/git-ops contract.
- CP 4: Fix the `FORGEJO_USER` fallback assertion in `test/forgejo.test.ts` to be hermetic, or move the file if it cannot be.
- CP 5: Classify/tier any moved file in `test/lib/test-categories.ts` and verify the full green tree.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm run test:integration:ci` ``, `` `./scripts/verify-local.sh all` ``, `` `npm test` ``, `` `node --import tsx test/run-default-tests.ts --integration-ci` ``, or `` `px ...` ``
  2. **Test names** — must match a test name in the repo, e.g. `"task-2544: two distinct branch analyses resolve to distinct identities"` or `"syncMerged fails on 409 Conflict if commits do NOT match"`
  3. **Test file paths** — e.g., `test/forgejo.test.ts`, `test/task-2544-sonar-worktree-isolation.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0060` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed (e.g., `scripts/sonar-local.ts:125`, `src/adapters/forgejo/forgejo-git.ts:541`), but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Concretely: a bare `` `npm run test:integration:ci` `` exit code or a copy-paste of `node:test` pass/fail lines is NOT sufficient on its own — restate the failing test name(s) and the exact command that produced the proof, and cite the test file path. This is the weak-agent failure mode: raw shell output alone reads as plausible but is unverifiable; the accepted references make it checkable.
- A non-generic `Next action:` line at the bottom

The first checkpoint (CP 1) must open red: record the exact failing assertions for the six named tests at the parent commit (the red state), then close green once fixed. Use the heading `## Goal Check` and the `| Criterion | Evidence | Status |` table; mark each row PASS only when the evidence cites an accepted reference form above.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/` production code (especially `src/adapters/forgejo/`, `scripts/sonar-local.ts`) — do not change behavior; the fix lives in the test layer.
- `docs/` authored documentation — do not edit unless a user-visible workflow/behavior change results (see DOD #5); consult `docs/doc-standards.md` before any edit.
- The backlog `assignee` field — do not edit; the workflow records ownership itself.
- The `origin` remote — mission branches must never be pushed to `origin` (only `main` may be pushed there).

## Stop Rules
- Stop after the draft passes `./scripts/verify-local.sh all`; do not transition the task to `ready` (the harness does that).
- Do not implement any fix or write any production change — this draft phase produces the mission contract only.
- Do not run any test beyond the single `./scripts/verify-local.sh all` gate.
- Do not spawn more than 2 parallel subagents; pause and wait if more are needed.
- Do not add a separate frontmatter field for mission type; classification lives in the backlog task labels only.

Reproduction-Test: test/forgejo.test.ts
Reproduction-Test: test/task-2544-sonar-worktree-isolation.test.ts
