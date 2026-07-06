# CP 2: Fix backlog task/classification resolution root

## Summary
Fixed the root-directory drift in `lib/commands/integrate.ts` that caused the
false `Backlog classification: Could not resolve backlog task for <slug>.`
failure:

- `buildIntegrationContext()` (lib/commands/integrate.ts:892) now resolves the
  initial backlog task lookup via `resolveTaskFile(slug, resolvedBaseWorktree)`
  instead of the implicit `process.cwd()` default, so it looks in the
  mission's recorded base worktree — the same root printIntegrationPreflight
  now uses for classification — rather than wherever `px integrate` happens
  to be invoked from.
- `printIntegrationPreflight()` (lib/commands/integrate.ts:1118) now resolves
  classification via `resolveMissionClassificationFn(context.slug, baseWorktree)`
  instead of `stats.resolveMissionClassification(context.slug)` with no root
  (which defaulted to `process.cwd()`). `baseWorktree` is the same
  `context.baseWorktree || getPrimaryWorktree()` value already used earlier in
  the function for mission-doc and branch-prefix resolution, so backlog task
  lookup and classification lookup are now guaranteed to agree on root.
- `resolveMissionClassificationFn` was added as an injectable option
  (default `stats.resolveMissionClassification`), matching the existing
  dependency-injection pattern used for the other preflight checks, so tests
  can observe/stub it without needing a real filesystem in every case.

Ambiguous-slug and missing-task handling were left untouched — both live in
the `else if (context.task.reason === 'ambiguous')` / final `else` branches
of `printIntegrationPreflight` (lib/commands/integrate.ts:1140-1148), which
do not depend on `resolveMissionClassification` at all, so the root-dir fix
cannot affect them.

## Goal Check

| Criterion | Evidence |
|---|---|
| Existing-task scenario now passes with the fixture's real classification label | `test/task-1431-integration-preflight-repro.test.js` — `printIntegrationPreflight resolves classification from the mission base worktree, not process.cwd()` — PASS, asserts `Backlog classification: ai_sdlc` and absence of the false-failure string |
| Ambiguous slug stays a hard failure with listed candidates | `test/task-1431-integration-preflight-repro.test.js` — `printIntegrationPreflight still hard-fails on an ambiguous slug rather than degrading to missing-task` — PASS |
| Missing task still warns + falls back to `unknown` (no new hard failure) | `test/task-1431-integration-preflight-repro.test.js` — `printIntegrationPreflight still warns and falls back to unknown classification for a genuinely missing task` — PASS |
| No regression in existing integrate preflight behavior | `node --require ./test/bootstrap-parallix-home.js --test test/integrate.test.js` — 59/59 pass |
| All new + existing tests pass together | `node --require ./test/bootstrap-parallix-home.js --test test/task-1431-integration-preflight-repro.test.js test/integrate.test.js` — 64/64 pass |

Next action: Extend/confirm regression coverage for the null-slug transcript (CP 3) — already added alongside this fix as `printIntegrationPreflight refuses to run with a null mission slug...` and `buildIntegrationContext refuses to build a context for a null mission slug`; re-verify those specifically go red on the pre-fix code and green after, then move to CP 4 verification gates.
