# Mission: Add GitHub Actions required verification pipeline (task-2500.05)

## Goal
Provide a GitHub Actions workflow that runs Parallix's GitHub-safe CI command as the stable `ci-required` check for pull requests and immutable publication-verification refs.

## Why Now
`github-publish` and `github-pr` require GitHub-owned evidence before protected-main policy can trust a commit. Mission 4 established `npm run test:ci`; this mission makes that existing clean-runner tier available to GitHub branch protection without depending on local agents or Forgejo.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one workflow file; existing `npm run test:ci`; Node engine `>=22.23.1`; trigger and concurrency policy differs between PR updates and immutable publication candidates

## Scope
- Add one GitHub Actions workflow under `.github/workflows/` with a deliberately stable required-check job name, `ci-required`.
- Trigger the workflow for pull requests targeting the protected primary branch and for the verification branch/ref used by `github-publish`.
- Check out the triggered commit, install a Node version satisfying `package.json`'s `>=22.23.1` engine, install dependencies deterministically, and run `npm run test:ci`.
- Configure read-only minimum GitHub token permissions and dependency caching that preserves lockfile-based installs.
- Cancel superseded runs for the same pull request while retaining runs for immutable publication-verification candidates.
- Record the observed GitHub Actions duration for a successful CI run in the completion checkpoint.

## Out of Scope
- Changing the contents, selection, or runtime budget of `npm run test:ci`.
- Implementing `github-publish`, `github-pr`, branch protection rules, GitHub secrets, or GitHub release/publication logic.
- Adding local AI, Forgejo, or third-party CI services to the workflow.
- Changing repository source, package dependencies, Node engine policy, or integration-mode behavior.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A workflow in `.github/workflows/` creates a job named `ci-required` on pull requests targeting the protected primary branch; the job name is a literal value, not computed from branch, event, or matrix data.
- SC2: The same workflow runs for the `github-publish` verification ref and checks out the event's exact commit SHA before executing verification.
- SC3: The `ci-required` job uses Node `>=22.23.1`, performs a lockfile-respecting deterministic dependency install, and runs exactly `npm run test:ci` as its verification command.
- SC4: The workflow grants only read-level repository contents permission unless a documented GitHub Actions action requires a narrower additional permission; it declares no write-all or broad write permission.
- SC5: Workflow concurrency cancels superseded runs for one pull request but does not cancel publication-verification runs merely because a later commit is pushed.
- SC6: A non-zero exit from `npm run test:ci` causes the `ci-required` job to fail, so branch protection can reject a failing commit.
- SC7: The completion checkpoint records the elapsed time of one successful GitHub Actions `ci-required` run, with the workflow run URL or GitHub run identifier as evidence.

## Operator direction — split and deferrals

> **Operator authoritative revision (2026-09-14, actor: operator).** This is an
> operator-authored split of the locked mission through the authoritative
> workflow state, not a branch self-deferral. The operator formally transfers
> SC2 and SC7 out of this mission to the follow-up `task-2500.06`, which owns
> establishing the `github-publish` verification ref and recording the live
> `ci-required` run. Authoritative-state record: `backlog/tasks/task-2500.05`
> (`operator_note`). This transfer is the authoritative resolution of reviewer
> finding F1 (PR #428, codex `workflow-round:2`): a mission branch cannot make an
> unmet acceptance criterion pass by editing its own locked mission, so the
> criterion is closed here only by operator direction, recorded in the
> authoritative workflow state and attributed to the operator.

Review of the committed workflow (PR #428, codex `REQUEST_CHANGES`,
`workflow-round:1, workflow-phase:fixing`) raised two findings that share one
root cause: the `github-publish` verification ref is unestablished in this
release.

- ADR 0045 marks `github-publish` unimplemented: GitHub verifies the exact
  resulting commit *before* it is published to the protected primary branch, so
  the workflow's `push: branches: [main]` trigger is not the github-publish
  verification ref — it fires after publication.
- SC2 requires the workflow to run for that ref; SC7 requires a live GitHub
  Actions run URL / run-id. Both require a live, policy-sanctioned triggering
  branch that this local-only session cannot produce (`origin` accepts only
  `main`; the `review` remote is Forgejo without GitHub Actions; pushing the
  workflow to `origin` `main` would bypass the protection this workflow guards).

Operator direction (mission split): workflow authoring + local validation here
close as complete; the two criteria that depend on a live github-publish
triggering ref move to a follow-up mission.

- This mission closes: SC1, SC3, SC4, SC5, SC6 (all locally verifiable).
- Deferred to follow-up mission `task-2500.06`: SC2 (runs for the established
  github-publish ref), SC7 (live run URL / run-id / elapsed time).

The workflow's `push` trigger is retained as a provisional real trigger, not a
claimed github-publish ref (see `.github/workflows/ci-required.yml` header).

## Risks and Assumptions
- Assumption: Mission 4's `npm run test:ci` remains the GitHub-safe, clean-runner verification authority.
- Assumption: repository operators will configure protected-branch rules to require the literal `ci-required` status after this workflow lands.
- Risk: an incorrect publication-ref pattern leaves `github-publish` commits unverified; confirm the producer's exact ref convention before finalizing the trigger.
- Risk: cache configuration can hide lockfile drift; use `npm ci` and lockfile-keyed caching only.
- Risk: a shared concurrency group could cancel an immutable publication candidate; scope cancellation to pull-request identity only.

## Checkpoints
- CP 1: Inspect the Mission 4 CI-tier contract, `package.json` engine and `test:ci` script, and the implemented `github-publish` ref producer. Record the exact PR target and publication-ref trigger patterns, job name `ci-required`, permissions, cache key inputs, and concurrency grouping before editing the workflow.
- CP 2: Add the single workflow with checkout, supported Node setup, deterministic install, lockfile-safe cache, and `npm run test:ci`; ensure PR and publication triggers share the same `ci-required` verification behavior.
- CP 3: Validate the workflow syntax, run the required local gate. SC2 and SC7 (which require a live github-publish triggering ref) are deferred to `task-2500.06`; this checkpoint closes SC1, SC3, SC4, SC5, SC6.
- CP 4 (operator direction, 2026-09-14): make `npm run test:ci` pass in a hosted-runner equivalent checkout — detached pull-request merge commit and push-to-`main` checkout, Node 24, ambient `CI=true`, non-root user, no workstation state — and record the evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column table header `| Criterion | Evidence | Status |` and one row for every success criterion.
- Durable evidence first: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm run test:ci`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- For workflow behavior, cite `.github/workflows/<workflow>.yml` together with the focused test/command that validates it; cite the GitHub Actions run URL or run identifier for SC7.
- Raw `stat`/`ls` output or generic prose alone is not enough: pair shell output with at least one accepted reference above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change `src/`, `package.json`, dependency lockfiles, integration-mode code, branch-protection settings, repository secrets, or Forgejo configuration unless a separately approved follow-up expands scope.
- `test/` is restricted except for one operator-directed carve-out (2026-09-14, recorded in `backlog/tasks/task-2500.05` `operator_note`): make `npm run test:ci` pass in a hosted GitHub Actions checkout where possible. Used for exactly one change: `test/bootstrap-parallix-home.ts` removes the ambient `CI` / `CONTINUOUS_INTEGRATION` flags, because ink treats `CI=true` as a non-interactive terminal and TUI tests then see no frames. No assertion, fixture, or test selection changes, and no test is skipped or disabled.
- The hosted checkout provides Parallix's standard repository layout rather than tests faking it: `.github/workflows/ci-required.yml` checks out full history and, on pull-request runs, adds `main` as a primary worktree (`git worktree add -b main`), because `getPrimaryBranch` / `resolveMainRepo` require a local primary branch checked out in a worktree.
- Keep workflow changes confined to one file under `.github/workflows/`; do not add a CI framework, reusable workflow layer, or external action beyond the standard checkout and Node setup needed for this workflow.

## Stop Rules
- The exact `github-publish` verification ref cannot be established from the implementation or parent mission evidence (ADR 0045 marks it unimplemented): resolved by operator direction via this mission split — SC2 and SC7 are deferred to `task-2500.06`, which owns establishing the ref.
- Stop and ask for direction if GitHub requires credentials, secrets, write permissions, or external AI/Forgejo infrastructure to run `npm run test:ci`.
- Stop and split a follow-up if satisfying the workflow requires changing the CI tier, Node engine, branch-protection configuration, or integration-mode implementation.
