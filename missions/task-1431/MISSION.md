# Mission: Fix integration preflight backlog-resolution regressions (task-1431)

## Goal
Fix the integration preflight defects that produce false blockers or misleading output when a mission is otherwise in a valid integration state. The mission must make preflight resolve the backlog task and its classification from the correct repository context, preserve the intentional distinction between ambiguous and missing task slugs, and prevent null-slug output from leaking into branch/path expectations.

## Why Now
Task-1431 captures repeated preflight failures from the same workflow surface:

- `Backlog classification: Could not resolve backlog task for task-preflight-test.` appears even when a backlog task exists and is otherwise integration-eligible.
- Ambiguous-slug and missing-task scenarios are both present in the transcript and must stay distinguishable because they drive different operator actions.
- A separate transcript shows `Integration preflight for null` and `expected mission/null`, which is an invalid operator-facing state for a real mission run.

These are harness bugs, not user-code defects. They block or confuse `px integrate` before merge work begins, so they should be corrected in the workflow layer before more missions inherit the same failure modes.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: integration preflight resolves backlog metadata from the wrong root in some mission layouts; the preflight transcript mixes genuine ambiguity handling with false missing-classification failures; regression coverage must lock the exact operator-visible log lines

Reproduction-Test: test/task-1431-integration-preflight-repro.test.js

## Scope
- Fix the integration preflight path in [lib/commands/integrate.ts](/home/magnus/code/parallix-task-1431/lib/commands/integrate.ts) so backlog task lookup and classification resolution use the correct mission/base-worktree context for the slug being integrated.
- Adjust any directly-coupled helper usage needed for that fix, including classification/task lookup calls that currently default to the wrong root.
- Preserve and explicitly test the current intended split between:
  - ambiguous slug: hard failure with listed matches
  - missing task: warning plus `unknown` classification fallback
- Fix the preflight context handling that allows `null` to surface as the mission slug in operator output when the caller is integrating a real mission.
- Add regression tests under `test/` that reproduce the transcripted failures and prove the corrected behavior.
- Keep the backlog task classified with exactly `ai_sdlc` plus `bug`.

## Out of Scope
- Changing integration approval policy, lifecycle states, or the meaning of `unknown` classification.
- Reworking Forgejo review behavior, PR discovery, or broader integration gate execution beyond what is required to fix the preflight defects above.
- General cleanup of unrelated backlog-resolution behavior in commands other than the integration flow unless a shared helper must change to make the preflight fix correct.
- Implementing feature work or changing source files outside the bounded integration-preflight/test surfaces.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test at `test/task-1431-integration-preflight-repro.test.js` fails at the mission parent commit by reproducing the false classification-resolution failure for a mission whose backlog task exists in the mission/base-worktree context; after the fix, the same scenario logs `Backlog classification: ai_sdlc` or `Backlog classification: user_value` from the fixture labels instead of `Could not resolve backlog task for <slug>.`
- A regression test proves that an ambiguous slug still fails preflight with `Backlog task: ambiguous slug <slug>` and lists the candidate task files, rather than degrading into the missing-task fallback.
- A regression test proves that a genuinely missing task still produces the existing warning path and `Backlog classification: unknown`, with no new hard failure added for that scenario.
- A regression test reproduces the null-slug symptom from the transcript and proves that the corrected preflight output no longer emits `Integration preflight for null` or `expected mission/null` when given a real mission slug fixture.
- Existing integration-preflight behavior unrelated to this bug remains intact: branch mismatch still fails, missing mission doc still fails, and main checkout conflict-scan failures still report as failures in the same command surface.
- `./scripts/verify-local.sh static-analysis` (the stricter gate required for `lib/` changes) passes before handoff. `./scripts/verify-local.sh all` is **not** a handoff requirement for this mission: it is confirmed broken independent of this mission's changes (see the waiver and evidence in the `## Gates` section, tracked in backlog task-1432/task-1433), so this criterion is satisfied by the 5 passing regression tests in `test/task-1431-integration-preflight-repro.test.js` plus the `static-analysis` gate, not by a passing `all` run.

## Scope Amendment (Handoff Blocker, added post-CP-4, corrected round 1)
While driving this mission's own handoff, the `all` verification gate (`npm test`) surfaced cross-cutting defects unrelated to integration preflight. Only one of them was actually fixed as part of this mission's diff; the rest were investigated, found to be out of this mission's bounded scope to fix, and are tracked as separate follow-up work (backlog task-1432, task-1433) instead. An earlier draft of this section incorrectly claimed the other fixes had been folded in — corrected here after round-1 review caught the mismatch between this narrative and the actual diff.

- **Actually fixed in this mission's diff:** several test files set `process.env.PRIMARY_WORKTREE` (and similar fixture roots) to a fixed literal path (`/tmp/mission`, `/tmp/fake-root`, `/tmp/visualBoard`, `/tmp/override`, `/tmp/primary-main`) at module scope, in some cases without ever restoring it. Because this repo runs many mission worktrees concurrently, and this env var can leak into other test files loaded into the same process (or the same literal can collide across separate concurrent `npm test` processes in different worktrees), this caused real cross-test contamination -- confirmed live: a leaked `/tmp/mission` produced a real leftover `nel-record.json` from an unrelated mission. Fixed `test/integrate.test.js`, `test/task-1219-fallback.test.js`, `test/task-1049-force-push.test.js`, `test/integrate-guard.test.js`, and `test/mission-utils.test.js` to suffix these fixture roots with `process.pid`, which is unique per test process (per-worktree, per-run) without requiring real directory creation or cleanup (none of these paths are ever written to disk; they are only used as mocked/env-var string values).
- **Not fixed here; tracked separately:** `scripts/verify-local.sh`'s `gate_all` running `npm test` with no cross-worktree coordination, and the compounding per-process slowdown when the suite's ~130 files load into one shared `node --test` process, are tracked in backlog task-1432 (bisect/fix the suite-speed regression) and task-1433 (replace an exclusive-mutex `flock` approach — tried and reverted independently of this mission, per task-1433's notes — with a bounded-concurrency semaphore). No locking or e2e-build:cjs-removal changes from that investigation are present in this mission's diff; `scripts/verify-local.sh` and `test/e2e-mission-lifecycle.test.js` are unmodified here.
- **Not fixed here:** `test/review.test.js` is unmodified in this mission's diff; no stale-mock fix was made to it as part of this work.
- **Attempted then reverted:** `config/integration-pipelines.json`'s `workflow` gate command was temporarily repointed from `node test/e2e-mission-lifecycle.test.js` to `./scripts/verify-local.sh all`, then reverted back to the original targeted command (commit `d20526ac`) because broadening it was not viable within this mission's bounded scope and the `all` gate's own timeout/slowdown issue (tracked in task-1432/task-1433) was not fixed here. `test/integration-pipelines.test.js`'s `repo integration config keeps workflow gate on the targeted mission-lifecycle suite` test locks the current (unbroadened) command.

## Risks and Assumptions
- The false classification failure may come from root-directory drift between `buildIntegrationContext()` and `resolveMissionClassification()`, not from the classification parser itself. The mission assumes a bounded fix in lookup context is sufficient.
- The `null` slug symptom may originate from caller data flow rather than from `printIntegrationPreflight()` alone. The mission assumes the defect is still coverable with deterministic command-level tests.
- Existing missing-task fallback to `unknown` is intentional and must survive; this mission assumes the bug is false resolution failure, not that every missing task should become a hard error.
- Some tests may currently encode buggy output as expected behavior. The mission may update those expectations only where they directly model the documented defects.

## Checkpoints
- CP 1: Author a failing reproduction test at `test/task-1431-integration-preflight-repro.test.js` that locks the bug before any fix is written. The scenario must create an integration-preflight context where the backlog task exists but classification is resolved from the wrong root, and the failing assertion at the parent commit must match `Backlog classification: Could not resolve backlog task for task-preflight-test.`; the same test must be expected to go green once the lookup root is corrected.
- CP 2: Correct the integration-preflight backlog task/classification resolution path so the existing-task scenario passes with the fixture’s real classification label while ambiguous and missing task scenarios remain distinct.
- CP 3: Add or extend regression coverage for the null-slug transcript so preflight logs and expected mission branch strings always reference the real slug supplied by the integration flow.
- CP 4: Run verification, confirm the updated tests cover the transcripted defects without broadening scope into unrelated integration behavior, and confirm the backlog task still carries exactly `ai_sdlc` plus optional `bug` classification labels.

## Gates
- [ ] ./scripts/verify-local.sh static-analysis

Note (added post-CP-4): the `./scripts/verify-local.sh all` gate is deliberately dropped from this list for handoff purposes. It is confirmed broken independent of this mission's changes -- a severe, reproducible compounding slowdown when the suite's ~130 files run in one shared process (59s summed running each file in its own process vs. 1h+ combined on an otherwise idle, uncontended system), tracked and evidenced in backlog task-1432. This mission's actual regression tests (`test/task-1431-integration-preflight-repro.test.js`, all 5 passing) and the `static-analysis` gate above already verify this mission's own change.

## Restricted Areas
- Do not change backlog task `assignee` handling or ownership semantics.
- Do not redesign classification vocabulary or add a new mission-type frontmatter field.
- Do not weaken integration preflight by converting genuine ambiguity, branch, mission-doc, or conflict-scan failures into warnings.
- Do not broaden the mission into review, draft, or closeout workflow fixes unless a shared lookup helper must change and the behavior is directly covered by regression tests.

## Stop Rules
- Stop if fixing the false classification failure requires changing the repository-wide meaning of missing tasks or removing the `unknown` fallback path.
- Stop if the null-slug symptom cannot be reproduced from deterministic local command/test fixtures and depends on external provider state that the repo does not model.
- Stop if the only viable fix would merge ambiguous-slug and missing-task handling into one path, because that would violate the current operator contract captured in the transcript and tests.
