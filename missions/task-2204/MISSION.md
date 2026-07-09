# Mission: remove forgejo merged fast path from integrate (task-2204)

## Goal

Remove the Variant A fast path from `px integrate` so that a Forgejo PR already marked `merged` is never treated as an acceptable integration state. When `context.pr.merged === true`, `px integrate` must fail preflight with explicit operator-facing recovery guidance and proceed exclusively through the local-authority squash-merge path (Variant B).

## Why Now

ADR 0045 explicitly states: "Forgejo is strictly a PR viewer and publication surface." Yet `integrate.ts:649` selects `useVariantA = context.pr.merged`, causing the workflow to skip squash-merge entirely when a PR was merged out-of-band on Forgejo. This contradicts the repo's authoritative model where the local base branch is the single integration target. The stale-date bug on task-1421 (Variant A closeout producing no new commit when there is no diff) is a secondary symptom of this same design flaw. Removing Variant A aligns the code with the documented branch model and eliminates an entire class of silent-state drift.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: architectural inconsistency (Variant A violates ADR 0045), stale-date regression (task-1421), single code path simplification

## Scope

- `lib/commands/integrate.ts`: Remove the `useVariantA = context.pr.merged` decision at line 649. A merged PR must cause preflight failure with recovery guidance instead of entering a closeout-only path.
- `lib/commands/integrate.ts`: Update `evaluateTaskStatusForIntegration()` at line 1038 — a merged PR is no longer an acceptable reason to proceed.
- `lib/commands/integrate.ts`: Update preflight display at line 1221 — a merged PR becomes a failure (not a warning).
- `lib/commands/integrate.ts`: Remove or repurpose `finalizeVariantACloseout()` — decide whether to keep it as an internal helper for edge cases or remove it entirely. Document the decision.
- `lib/core/post-integrate-hook.ts`: Remove `'variant-a'` as a valid `INTEGRATE_HOOK_VARIANT` value; update env construction.
- `test/integrate.test.js`: Remove or convert Variant A tests to expect failure.
- `test/task-1109.test.js`: Convert Variant A tests ("integrate fast-path (Variant A) success path", "integrate Variant A reports closeout commit failure guidance") to expect preflight failure.
- `test/post-integrate-hook.test.js`: Remove `'variant-a'` from expected env values.
- `docs/adr/0045-parallax-branch-model.md`: Update line 51 to reflect that only Variant B exists; remove Variant A from the integration mode descriptions.
- `docs/authority-reference.md`: Remove `variant-a` from `INTEGRATE_HOOK_VARIANT` values.
- Author a deterministic regression test proving the new behavior (see Checkpoints).

## Out of Scope

- Changes to Forgejo PR creation, sync, or close logic (those are unaffected; `syncMerged()` at `forgejo.ts:780` still runs after Variant B squash-merge).
- Changes to the rebase command or draft command.
- Changes to the post-integrate hook execution engine itself (only the `'variant-a'` string value is removed).
- Migration of existing worktrees or historical data.
- Changes to the integration pipeline gates config.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable.

- SC1: `integrate.ts` contains zero references to `context.pr.merged` that affect control flow (the only remaining references must be in comments or dead-code removal candidates). Verified by: `` `rg 'context\.pr\.merged' lib/commands/integrate.ts` `` returns no matches outside comments.
- SC2: A deterministic regression test exists at `test/task-2204-integrate-no-variant-a.test.js` that mocks `context.pr.merged === true` and asserts the command fails preflight with operator-facing recovery guidance. Verified by: `` `node --test test/task-2204-integrate-no-variant-a.test.js` `` passes.
- SC3: Both trunk-based and feature-branch integration flows land through the same local/base-worktree squash-merge path. Verified by: `` `rg 'finalizeVariantACloseout' lib/commands/integrate.ts` `` returns zero live-call matches.
- SC4: All existing integration tests pass after the change. Verified by: `` `node --test test/integrate.test.js` `` and `` `node --test test/task-1109.test.js` `` and `` `node --test test/post-integrate-hook.test.js` `` all pass.
- SC5: `post-integrate-hook.ts` no longer emits `variant: 'variant-a'` in any test or production path. Verified by: `` `rg 'variant-a' test/post-integrate-hook.test.js lib/core/post-integrate-hook.ts` `` returns zero matches.
- SC6: ADR 0045 and `docs/authority-reference.md` are updated to remove Variant A references. Verified by: `` `rg 'variant.?a|Variant.?A' docs/adr/0045-parallax-branch-model.md docs/authority-reference.md` `` returns zero matches (excluding the word "alternative" in the alternatives table).
- SC7: Verification gate `./scripts/verify-local.sh all` ran and passed on the final tree.

## Risks and Assumptions

- Risk: Some operators may have manually merged PRs on Forgejo and rely on `px integrate` to silently close out. Mitigation: The preflight error message will provide explicit recovery steps (re-sync the base branch locally, then re-run integrate).
- Risk: `finalizeVariantACloseout()` may be called from code paths outside `integrate.ts`. Assumption: A grep for callers confirms it is only invoked from the Variant A branch in `integrate.ts`. If external callers exist, the function must be preserved as a standalone utility and the mission scope adjusted.
- Assumption: The regression test can be written using the same mock pattern as `test/task-1109.test.js` (mocking `forgejo.getPrStatus`, `git.git`, and `console.log`/`console.error`).
- Assumption: No other command handler reads `context.pr.merged` for control flow decisions outside `integrate.ts`.

## Checkpoints

- CP 1: Reproduction test authored that fails at the mission's parent commit (red) and will pass once the fix lands (green). The test mocks `context.pr.merged === true` and asserts `px integrate` fails preflight with operator-facing recovery guidance instead of proceeding to closeout. See the Checkpoint Documentation Requirements block below for evidence standards.

Reproduction-Test: test/task-2204-integrate-no-variant-a.test.js
- CP 2: Code changes implemented — Variant A path removed, preflight updated, tests converted.
- CP 3: Verification gate runs clean (`./scripts/verify-local.sh all`) and all checkpoints document evidence.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include:

- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/integrate.ts:649` (must point to an existing file and line)
  2. **Test names** — e.g., `"integrate rejects merged-PR with preflight failure guidance"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/task-2204-integrate-no-variant-a.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0045` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `node --test test/integrate.test.js` ``, `` `./scripts/verify-local.sh all` ``, `` `rg 'context\.pr\.merged' lib/commands/integrate.ts` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates

- [ ] ./scripts/verify-local.sh docs
- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Do not modify `lib/tools/forgejo.ts` — the Forgejo tool module is out of scope. Only `integrate.ts` and the post-integrate hook env construction change.
- Do not modify `lib/commands/draft.ts`, `lib/commands/rebase.ts`, or `lib/commands/mission-start.ts`.
- Do not modify `config/integration-pipelines.json`.

## Stop Rules

- Stop if `rg 'finalizeVariantACloseout' lib/` reveals callers outside `integrate.ts` — this requires scope adjustment and a mission re-baseline.
- Stop if the regression test cannot be made deterministic using the existing mock infrastructure (node:test `mock.method` pattern) — flag for manual review.
- Stop if `./scripts/verify-local.sh all` fails with errors unrelated to this mission's changes (pre-existing flakiness) — do not attempt to fix unrelated issues.