# CP-3: Gates run against the committed tree; final Goal Check

Both declared gates pass against the committed tree. `static-analysis` was run
fresh in this checkpoint; the `all` gate (docs + full default suite) was run
against the identical source tree that is now committed (only the CP-2
checkpoint document and two new files were uncommitted at that time, and neither
is part of the test suite).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `px mission-start` absent from CLI registration, help, suggestions, and dispatch; cannot reach preflight | `src/composition/create-cli.ts` registry has no `'mission-start'` entry; `src/interfaces/cli/runtime.ts` `KNOWN_COMMANDS` and `printUsage` drop it; `test/mission-start-removal.test.ts`, `"px mission-start resolves to Unknown command and never reaches preflight"` | PASS |
| Command adapter/entry removed; no production import or reference to the removed command module | `grep -rn "mission-start" src/` returns no matches; module is now `src/adapters/cli/startup-preflight.ts`; `src/adapters/mission/execute-mission-adapters.ts:235` `preflight: startupPreflight` | PASS |
| `px active` continues to execute startup preflight | `test/active.test.ts`, `"active() success path: preflight, launch, and handoff run in order"` and `"active() exits 1 when preflight fails"`; `test/execute-mission-adapters.test.ts`, `"workspace adapter runs the execute preflight quiet"` | PASS |
| Live prompts contain no `px mission-start` instruction; historical records unchanged | `grep -rn "mission-start" prompts/act-on-review-core.md prompts/draft-core.md` → no matches; `git log --oneline -- missions/` shows no modification under this mission's parent | PASS |
| Focused regression tests + `static-analysis` pass with no `.only`/`.skip`/unrelated changes | `test/mission-start-removal.test.ts`; `./scripts/verify-local.sh static-analysis` → all 4 stages PASS; `./scripts/verify-local.sh all` → 2520 pass / 0 fail | PASS |
## Gate evidence

- `./scripts/verify-local.sh static-analysis` → `Static Analysis Gate: ALL STAGES PASSED`
  (ESLint clean, `npm run typecheck` clean, test-hygiene clean, test typecheck clean).
- `./scripts/verify-local.sh all` → `node scripts/verify-docs.mjs` PASS; `npm test`
  → 2520 pass / 0 fail / 0 skipped (suite budget 180000 ms, elapsed ~33 s).
- Focused regression re-run against committed tree: `node --experimental-test-module-mocks --import tsx --test test/mission-start-removal.test.ts test/index.test.ts test/execute-mission-adapters.test.ts test/active.test.ts` → 143 pass / 0 fail.

## Scope compliance

- `px active` startup preflight preserved (renamed module, same logic).
- No replacement command, dependency, or compatibility shim added for `mission-start`.
- Historical mission records, archived backlog entries, and unrelated prompts untouched.
- No out-of-scope production change rides this branch. The round-1 review-workflow change (`f6c6c3513`) and the round-2 command-completion-contract rewrite (`fa3938c31`) were both re-homed off this branch (task-2490 and task-2497 respectively). Branch tip is command removal alone. The task-2350 Review-aggregate start guard lives on `main` (refined as `if (requireReviewAggregate && !persisted && (!isFreshStart || interruptedHandoff || !knownMission))`), not on this branch.

Next action: mission complete — all declared checkpoints committed and both
gates pass.
