# Mission: Prevent PR history noise from blocking mission reviews (task-2359)

Reproduction-Test: test/task-2359-repro.test.ts

## Goal
Narrow the reviewer contract so that PR metadata, commit ancestry, and historical commits outside `git diff {{reviewBaseline}}..HEAD` are context only: they must not produce a mission finding, a request-changes verdict, or a workflow block unless the mission itself introduced or materially worsened the inconsistency, or the review surface cannot identify the reviewed revision. The fix must live in the prompt source (`prompts/review.md`), not in an agent-specific workaround, and must be locked by a red-to-green prompt regression test that renders both `buildReviewPrompt()` and `buildCompactReviewPrompt()`.

## Why Now
Reviewers are blocking otherwise-valid missions over Forgejo PR history the mission did not create. PR #247 is the concrete case: a history inconsistency that belongs to `main` / review-surface state became a request-changes finding and stopped mission progress. The cause is in the prompt: `prompts/review.md` already scopes the reviewed subject to `git diff {{reviewBaseline}}..HEAD` and tells reviewers to ignore rebasing artifacts, but it then twice orders reviewers to report **any** workflow-state/prompt/PR-history inconsistency as a finding, and that broad order overrides the scoped evidence rule in practice. Every mission that goes through review is exposed to this false-positive block, and each occurrence costs at least one full review round.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: a new red-to-green regression test `test/task-2359-repro.test.ts` (roughly 100–150 lines), a scoped rewrite replacing the two broad PR-history instructions in `prompts/review.md` (net roughly ±15 lines), and assertions covering both prompt builders.

## Scope
- Edit `prompts/review.md` — the single template both builders render (`buildReviewPrompt()` delegates to `buildCompactReviewPrompt()`, which loads the template via `runtimeAssetStore.readText`):
  - Remove or qualify the two broad instructions that require reporting any inconsistent "PR history" as a finding: the bullet beginning "If workflow state, prompts, or PR history are inconsistent, report that inconsistency as a finding rather than fixing it." and the bullet "Report any inconsistency (workflow state, prompts, PR history) as a finding rather than resolving it yourself".
  - Add a scoped rule: PR metadata, commit ancestry, and historical commits outside `git diff {{reviewBaseline}}..HEAD` are context only and must not produce a mission finding, request-changes verdict, or workflow block — with exactly two exceptions: the mission introduced or materially worsened the inconsistency, or the review surface cannot identify the reviewed revision.
  - Keep the finding-grounding rule (findings grounded in `git diff {{reviewBaseline}}..HEAD`, mission/checkpoint evidence, or inability to identify the reviewed revision) and the Rebasing Artifacts section intact.
- Author `test/task-2359-repro.test.ts`: the red-to-green regression test for a PR whose history contains an unrelated `main` or review-surface commit, asserting through both `buildReviewPrompt()` and `buildCompactReviewPrompt()` that the reviewer is instructed not to file a finding or request changes for that history alone.
- Extend `test/review-prompts.test.ts` where needed so both builders' rendered prompts assert the new scope, the preserved exceptions, and the intact rebasing-artifact guidance.
- Confirm no authored doc describes the old "report any PR history inconsistency" behavior (only a historical ADR reference exists today, which must stay untouched); if any live doc does describe it, update it and pass the docs gate.

## Out of Scope
- Repairing or rewriting historical PRs, including PR #247.
- Changing `main`, Forgejo server data, or individual mission branches.
- Suppressing valid findings about the mission diff, its checkpoint evidence, or ambiguity about the reviewed revision.
- Any change to `src/adapters/review/review-loop.ts`, review-artifact parsing/consumption, or any prompt template other than `prompts/review.md` (`prompts/act-on-review.md`, `prompts/execute.md`, `prompts/draft.md`, `prompts/portfolio.md` stay untouched).
- Agent-specific workarounds; the required behavior must be expressed through the prompt source.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `test/task-2359-repro.test.ts` exists and contains a test that fails at the mission's parent commit and passes on the final tree. It renders the review prompt for a scenario where the PR history contains an unrelated `main` or review-surface commit and asserts the reviewer is instructed not to file a finding or request changes for that history alone.
- SC2: Rendered prompts from both `buildReviewPrompt()` and `buildCompactReviewPrompt()` preserve the rule that findings must be grounded in `git diff {{reviewBaseline}}..HEAD`, mission/checkpoint evidence, or inability to identify the reviewed revision, with at least one test assertion per builder in `test/task-2359-repro.test.ts` or `test/review-prompts.test.ts`.
- SC3: `prompts/review.md` no longer contains either unqualified instruction — the bullet beginning "If workflow state, prompts, or PR history are inconsistent, report that inconsistency as a finding" and the bullet "Report any inconsistency (workflow state, prompts, PR history) as a finding" — and any replacement wording is explicitly scoped so it cannot override the mission-diff boundary.
- SC4: The template still requires a finding in exactly these three cases, and each case has a named test assertion in the suite: (a) the mission itself introduced or materially worsened the inconsistency; (b) checkpoint evidence is materially false; (c) the review surface cannot identify the exact reviewed revision.
- SC5: Rebasing-artifact guidance remains intact: `prompts/review.md` still contains the Rebasing Artifacts section telling reviewers to ignore stale-baseline noise (behind `{{primaryBranch}}`, files added/deleted on `{{primaryBranch}}`) that is not a mission change, and at least one test asserts that guidance survives in the rendered prompt.
- SC6: `./scripts/verify-local.sh all` passes on the final tree.
- SC7: `./scripts/verify-local.sh static-analysis` passes on the final tree.

## Risks and Assumptions
- Both builders share one template (`buildReviewPrompt()` delegates to `buildCompactReviewPrompt()`; both read `prompts/review.md` via `runtimeAssetStore.readText`), so a single template edit covers both — but tests must still render through both entrypoints so a future split cannot silently drop the rule.
- Over-narrowing risk: if the replacement wording loses any of the three mandatory-finding paths (SC4), real defects get silenced. Mitigation: explicit exception wording plus one test assertion per exception.
- Existing prompt-content assertions in `test/review-prompts.test.ts`, `test/review-artifacts.test.ts`, `test/review-identity-placeholder.test.ts`, and `test/task-2317-context-compaction.test.ts` may match wording adjacent to the edit sites; check them before editing and only update assertions that lock the old broad wording.
- The docs gate forbids `file.ts:<line>` citations in `prompts/*.md` (`./scripts/verify-local.sh docs` greps for them); the new wording must not introduce any.
- Tests can only assert rendered prompt text; actual reviewer-agent compliance is not mechanically enforceable. Accepted residual risk — the contract requires the fix in prompt source, not code.
- Unit tests must stay fast and mock dependencies (repo convention); the repro test renders prompts via the builders and must not launch agents, hit Forgejo, or run heavy CLI commands.

## Checkpoints
- CP 1 (red): Author the failing reproduction test `test/task-2359-repro.test.ts` without touching `prompts/review.md`. Scenario: a review where the PR history contains an unrelated `main` or review-surface commit (integration history the mission did not author). Render through both `buildReviewPrompt()` and `buildCompactReviewPrompt()` and assert the target contract: out-of-diff PR history is context only, the grounding rule is preserved, the three SC4 exceptions remain mandatory findings, and the Rebasing Artifacts guidance is intact. Run the test and capture the failing output — the assertions guarding against the unqualified PR-history instructions must fail at the parent commit.
- CP 2 (green): Edit `prompts/review.md`: remove or qualify the two broad instructions and add the scoped context-only rule with the two exceptions. Re-run `test/task-2359-repro.test.ts` until green, then run the prompt-adjacent suites (`test/review-prompts.test.ts`, `test/review-artifacts.test.ts`) and update only assertions that locked the removed broad wording.
- CP 3 (verify): Run `./scripts/verify-local.sh docs`, `./scripts/verify-local.sh static-analysis`, and `./scripts/verify-local.sh all`; confirm no `.only` or bare `.skip` was introduced; write the final Goal Check table with durable evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section — use that exact heading
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- At least one evidence row per success criterion using durable, verifiable references. Lead with the forms Parallix verifies today:
  1. **Exact test names** — e.g., a test named `"task-2359: rendered review prompt treats unrelated PR history as context only (buildReviewPrompt + buildCompactReviewPrompt)"` (must match a test name actually present in the repo)
  2. **Test file paths** — e.g., `test/task-2359-repro.test.ts`, `test/review-prompts.test.ts` (must be existing test files)
  3. **Recognized repo commands or paths** — e.g., `` `npm test` ``, `` `node --test test/review-prompts.test.ts` ``, `` `git diff main..HEAD` ``, `` `px status task-2359` ``, or `` `./scripts/verify-local.sh all` ``
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** (parenthetical only) — accepted when needed, but discouraged because line numbers rot; prefer the forms above
- Weak-agent failure mode: raw `stat`/`ls` output or generic prose alone is NOT sufficient evidence; such output may appear only as supplemental context paired with one of the accepted references above
- Mission-specific expectations: CP 1 must paste the failing test name plus assertion output proving the test is red at the parent commit; CP 2 must name each test that flipped red→green; CP 3 must cite each gate command with its pass result
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Red-to-green repro test locks the PR-history-noise defect | `test/task-2359-repro.test.ts` (failing output captured at parent commit) | PASS |
| Broad PR-history instructions removed from the template | `prompts/review.md` | PASS |
| Both builders still ground findings in the mission diff | `test/review-prompts.test.ts`, `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh docs

## Restricted Areas
- All prompt templates except `prompts/review.md` (`prompts/act-on-review.md`, `prompts/execute.md`, `prompts/draft.md`, `prompts/portfolio.md`).
- `src/adapters/review/review-loop.ts` and review-artifact parsing/consumption — no behavior changes; this mission is prompt-source plus tests only.
- The checkpoint-evidence rule in `prompts/review.md` (materially false checkpoint evidence remains a finding) — do not weaken it while narrowing the PR-history wording.
- `main`, Forgejo server data, historical PRs (including #247), and all other mission branches; no pushing.

## Stop Rules
- If the red test passes at the parent commit (fails to reproduce), stop and re-derive the reproduction scenario before continuing.
- If making the test green requires changes outside `prompts/review.md` and test files (e.g., code changes to review-loop or artifact consumers), stop and record a blocker in the checkpoint.
- If keeping the three mandatory-finding paths (SC4) proves impossible without reintroducing a broad PR-history instruction, stop and escalate — do not ship a narrowed contract that silences valid findings.
- If verification gates fail for pre-existing reasons unrelated to this change, stop and report instead of fixing unrelated code.
