# Mission: px status reports the PR of the current branch instead of the requested mission (task-2419)

## Goal
`px status <slug>` must report the Forgejo PR of the requested mission's branch, not the PR of whatever branch the command happens to run on. When a slug is resolved, the PR lookup must use `missionBranchName(resolvedSlug, rootDir)` (the requested mission's branch) instead of `getCurrentBranch()`.

Reproduction-Test: test/task-2419-status-pr-branch-repro.test.ts

## Why Now
Observed 2026-08-26 from `/home/magnus/code/parallix-task-2402` (branch `mission/task-2402`): `px status task-2411`, `px status task-2358`, and even `px status task-9999` all printed `Forgejo PR: #339 (open)` — task-2402's PR. Every other line in the status output is already keyed by slug, so a wrong PR number next to the right mission is actively misleading and can point an operator at another mission's review.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: regression fix, correctness of mission-scoped CLI output, misleading PR number in status

## Scope
- Fix `StatusCommandUseCase.execute` (`src/application/status-command-use-case.ts`) so that when a mission slug is resolved, `prInfo` is looked up via the requested mission's branch.
- The PR lookup must route through the existing `StatusPrPort.getPrInfo(branch)` and the existing `createStatusPrAdapter` / `getPrStatus` Forgejo path — no new PR-fetching machinery.
- Reuse `missionBranchName(slug, rootDir)` from `src/adapters/filesystem/mission-utils.js` (same helper the legacy `src/adapters/cli/commands/status.ts` path uses).
- Add a focused unit test that locks the regression (see Checkpoints and `Reproduction-Test:` below).
- Update docs only if user-visible behavior changes (see Gates).

## Out of Scope
- Any change to `px review`, `px handoff`, `px rebase`, or other commands that already key PR lookups by slug.
- Changes to Forgejo API access, PR creation, or comment posting.
- Reworking the status board projection, agent matrix, or stale-worktree logic.
- Behavioral change for the inferred-slug (no explicit slug) path beyond using the resolved slug's branch, which the fix already covers.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no subjective adjectives or vague quantifiers.

- SC1: For `execute(rootDir, slug)` with a resolved slug, the branch passed to `StatusPrPort.getPrInfo` equals `missionBranchName(slug, rootDir)` and does not equal `getCurrentBranch()` when the two differ.
- SC2: `px status <slug>` run from an unrelated branch or worktree reports the PR number of `<slug>'s` mission branch, not the current branch's PR.
- SC3: `px status <slug>` for a mission with no PR reports no PR (returns `null` / `exists: false`) rather than the current branch's PR.
- SC4: A test under `test/` asserts that the PR lookup for a slug other than the current mission's branch uses the requested mission's branch.
- SC5: All pre-existing status tests in `test/status-command-use-case.test.ts` still pass unchanged (behavior preserved for the shared rendering/parsing paths).

## Risks and Assumptions
- `missionBranchName(slug, rootDir)` calls `loadAdapterConfig(rootDir)`; this resolves gracefully to defaults (`branchPrefix: 'mission/'`) when no product config exists, so it is safe in tests and bare repos. No filesystem mutation occurs.
- The use case is described as "CLI-independent"; importing a filesystem/config-resolving helper introduces a dependency edge. Prefer wiring the requested branch through the board/git port if that keeps layering cleaner — but the observable behavior (SC1–SC3) is the contract either way.
- Assumption: `getCurrentBranch()` and `missionBranchName(resolvedSlug, rootDir)` can differ; the test must use a current branch that is a *different* mission than the requested slug to expose the bug.
- Assumption: no explicit-slug (inferred) case is unaffected because `resolvedSlug` is non-null there too; the fix applies uniformly.

## Checkpoints
- CP 1: Author a failing reproduction test that locks the bug (red) before any fix. File `test/task-2419-status-pr-branch-repro.test.ts`: build a `StatusCommandUseCase` with `mockGit.getCurrentBranch()` returning `mission/task-2402` (a *different* mission than the requested slug) and a `mockPr` that records the branch passed to `getPrInfo` and returns `{ exists: true, number: 339, state: 'open' }`. Call `execute('/tmp/repo', 'task-2419')` (rootDir `/tmp/repo` resolves `missionBranchName` to the default `mission/` prefix, so the requested branch is `mission/task-2419`). Assert the recorded branch equals `mission/task-2419` (and thus differs from the current branch `mission/task-2402`). This assertion FAILS at the mission's parent commit (records `mission/task-2402`, red) and PASSES after the fix lands (green). Do not author the fix during draft — the reproduction test plus the `Reproduction-Test:` line above are the only bug-specific outputs.
- CP 2: Apply the fix so the reproduction test turns green (green).
- CP 3: Verify the full status test suite and static analysis pass; update docs if behavior changed.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/status-command-use-case.test.ts` ``, `` `npm run static-analysis` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — must match a test name in the repo (e.g. a test in `test/status-command-use-case.test.ts`)
  3. **Test file paths** — e.g., `test/status-command-use-case.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. In particular, raw `node --test` / `npm test` stdout alone is NOT sufficient — cite the test name or file path the output refers to.
- A non-generic `Next action:` line at the bottom.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify `src/adapters/review/`, `src/application/handoff-command-use-case.ts`, `src/application/rebase-workflow.ts`, or any Forgejo (`src/adapters/forgejo/`) logic.
- Do not alter the `StatusPrPort` interface contract (still `getPrInfo(branch: string)`), the rendering in `src/application/presentation/cli-format.ts`, or the composition root that wires `createStatusPrAdapter`.
- Do not change test infrastructure, CI, or the verify script.

## Stop Rules
- Stop before implementing anything until CP 1's reproduction test is red at the mission's parent commit.
- Stop editing once SC1–SC5 are satisfied and `./scripts/verify-local.sh all` passes; do not refactor unrelated code.
- Stop if the fix would require changing the `StatusPrPort` interface or adding a new port — escalate in the checkpoint doc rather than expanding scope.
