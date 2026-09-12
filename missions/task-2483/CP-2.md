# CP-2: wire `{{completedControls}}` into the review prompt

## Summary

- `prompts/review-core.md`: the vague sentence *"The workflow runs the declared
  verification gate before this review."* is gone. In its place the minimum
  loop contract now states that the block reports which controls the workflow
  has already executed and which it has not, that a listed command whose
  recorded status is `passed` must not be re-run and must be cited from the
  block instead, and that re-running is permitted only when the block reports
  no recorded gate result, reports a `failed` status, reports a control as not
  yet run, or the command is not listed. The `{{completedControls}}`
  placeholder follows on its own line. The read-only `px status {{slug}}`
  carve-out that shared the old line was preserved verbatim as its own bullet.
- `src/adapters/review/review-prompts.ts`: `buildCompactReviewPrompt`
  substitutes `{{completedControls}}` with `buildCompletedControlsBlock`
  (CP-1), so `buildReviewPrompt` inherits it by delegation. Substitution runs
  after `assembleStagePrompt`, so a repo-local opinion override that mentions
  the placeholder is substituted too — `assembleStagePrompt` still just loads
  two files and concatenates.
- `test/fixtures/prompt-split-parent.json`: the `review` value was regenerated
  from `assembleStagePrompt('review', {})`. A key-by-key comparison against
  `HEAD:test/fixtures/prompt-split-parent.json` reports `changed keys:
  ['review']`, so `draft`, `execute`, `act-on-review`, and `portfolio` are
  byte-identical and the multiset comparison in `test/prompt-split.test.ts` was
  not loosened.
- `test/review-prompts.test.ts`: the single assertion that pinned the removed
  sentence (`"buildCompactReviewPrompt inlines the contract instead of
  redirecting to docs/agent-prompts"`) now pins the replacement rule. The two
  tests named in SC10 were not touched and pass unchanged.
- `test/persistence-inventory-guardrail.test.ts`: reading `MISSION.md` and the
  gitignored `.workflow/gate-result.json` makes `review-prompts.ts` a durable-IO
  file by the guard's token scan. It is registered in the guard's
  `infrastructureExclusions` under the same documented category as
  `src/adapters/verification/verification.ts` ("verification proofs —
  infrastructure metadata, not a domain concept") and
  `src/adapters/verification/redgreen.ts` ("reads mission docs for test
  markers"). The guard's assertion was not weakened and no ADR 0053 concept or
  inventory entry changed.
- `docs/config.md`: a new *The `{{completedControls}}` placeholder* subsection
  in the Prompts section names the three data sources
  (`.workflow/gate-result.json`, `adapters.gates`, mission `## Gates`), states
  that pass is derived from `exitCode === 0` alone, that `preIntegration` gates
  are omitted because they have not run at review time, and that substitution
  happens after assembly so overrides are covered.

## Round 1 review response (F1)

**F1 — configured `preReview` gates were falsely reported as executed: fixed.**
The finding is correct. `submitReview` runs the `review`-phase gates inside an
`if (outcome === 'approve')` branch (`src/adapters/review/review-commands.ts`),
so a configured `preReview` command runs *after* the review prompt is issued,
not before it. The block labelled it `executed`, which is exactly the
configuration-is-not-an-execution-record error ADR 0048 forbids.

The block now separates the two lifecycle positions:

- `Configured preHandoff gates executed by handoff: …` — handoff runs these and
  hard-fails on a non-zero exit, so reaching review proves they passed.
- `Configured preReview gates NOT yet run (they run on approve, after this
  review): …` — still listed with its phase key, as SC3 requires, but never
  presented as a control the reviewer may skip.
- `preIntegration` remains omitted entirely.

`prompts/review-core.md` was reworded in lockstep ("which controls the workflow
has already executed for this mission and which it has not"), and its
re-run-permitted list gained the "reports a control as not yet run" case, so the
instruction matches what the block can now say. The `review` fixture entry was
regenerated again; a key-by-key comparison against the pre-mission fixture still
reports `changed keys: ['review']`.

Root cause, also fixed: `docs/config.md` claimed "`preReview` gates run before
the review phase", which is the stale description this mission trusted. It now
states that they run when a review is submitted with the `approve` outcome,
before the `review` → integration transition rather than before the review.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: `{{completedControls}}` appears once; the old sentence is gone | `prompts/review-core.md`; `grep -c completedControls prompts/review-core.md` = 1 and `grep -c 'The workflow runs the declared verification gate before this review.' prompts/review-core.md` = 0 | PASS |
| SC2: passing record's command/status/exitCode/recordedAt reach the prompt with no `{{completedControls}}` left | `"task-2483: buildCompactReviewPrompt substitutes {{completedControls}} and leaks no placeholder (SC2)"` in `test/task-2483-completed-controls.test.ts` | PASS |
| SC3: configured `adapters.gates` render with phase keys | `"task-2483: configured preHandoff and preReview gates render with their phase key (SC3)"` in `test/task-2483-completed-controls.test.ts` | PASS |
| F1 (round 1): a configured `preReview` gate is never reported as executed | `"task-2483: a configured preReview gate is never reported as executed (round 1 F1)"` in `test/task-2483-completed-controls.test.ts` | PASS |
| SC4: every mission `## Gates` command appears | `"task-2483: every mission \`## Gates\` command line appears in the block (SC4)"` in `test/task-2483-completed-controls.test.ts` | PASS |
| SC5: empty case is exactly one non-blank line | `"task-2483: no gate record, no configured gates and no mission gates degrade to one line (SC5)"` in `test/task-2483-completed-controls.test.ts` | PASS |
| SC6: ≤12 non-blank lines and ≤900 characters in every exercised case | `"task-2483: the fully-populated block stays within 12 non-blank lines and 900 characters (SC6)"` in `test/task-2483-completed-controls.test.ts` | PASS |
| SC7: reproduction line present iff `Reproduction-Test:` is declared | `"task-2483: the reproduction-gate line appears only when MISSION.md declares Reproduction-Test (SC7)"` in `test/task-2483-completed-controls.test.ts` | PASS |
| SC8: prompt carries the do-not-re-run rule and its three exceptions | `prompts/review-core.md`; asserted by `"buildCompactReviewPrompt inlines the contract instead of redirecting to docs/agent-prompts"` in `test/review-prompts.test.ts` | PASS |
| SC9: prompt-split green with only the `review` fixture entry changed | `test/prompt-split.test.ts` (`"task-2465-2: review core+default preserves the parent-commit prompt as a non-blank multiset"`, `"task-2465-review launch point preserves every pre-split line (no override)"`); `test/fixtures/prompt-split-parent.json` diff vs `HEAD` reports `changed keys: ['review']` | PASS |
| SC10: named review-prompt tests pass unchanged in intent | `"buildCompactReviewPrompt reads from template and substitutes all variables"` and `"buildCompactReviewPrompt substitutes {{reviewBaseline}} with the provided SHA and leaks no placeholder"` in `test/review-prompts.test.ts` — both untouched and passing | PASS |
| SC11: docs name the placeholder and its data sources | `docs/config.md`, section *The `{{completedControls}}` placeholder*, including when each `adapters.gates` phase actually runs | PASS |
| SC12: verification gate green on the final tree | `./scripts/verify-local.sh all` — `tests 2513 / pass 2513 / fail 0`, exit 0 | PASS |
| Persistence guard registered, not relaxed | `test/persistence-inventory-guardrail.test.ts` (`"SC1 reverse: all durable-IO files under src/ are present in the inventory"`) — 20/20 pass; entry sits beside `src/adapters/verification/verification.ts` and `src/adapters/verification/redgreen.ts` | PASS |
| DoD #3: no focused or bare-skipped tests introduced | `test/task-2483-completed-controls.test.ts` contains no `.only` and no `.skip` | PASS |

Notes for the reviewer:
- `package-lock.json` carries a pre-existing one-line `"pi-ai": "dist/cli.js"` → `"./dist/cli.js"` rewrite that was already dirty when this mission started; it is deliberately not committed.
- `npx eslint` reports 3 errors across `test/review-prompts.test.ts` and `test/persistence-inventory-guardrail.test.ts`. All three exist at the parent commit (`git show HEAD~1:test/review-prompts.test.ts` lines 447–448, `HEAD~1:test/persistence-inventory-guardrail.test.ts` line 9); this mission only shifted their line numbers.

Next action: return to the round-1 reviewer with F1 fixed — the `preReview` line now reads `NOT yet run`, `"task-2483: a configured preReview gate is never reported as executed (round 1 F1)"` pins it, and `./scripts/verify-local.sh all` is green at 2513/2513 on the final tree.
