# CP-5: Regression test

## Summary

Authored `test/mutation-gate-ratchet.test.js`: a self-contained regression
test (no network, no external tools beyond the StrykerJS devDependency the
gate itself already uses) that runs the **real** `mutation-gate` pipeline —
real `scopeFn` stub for the target file, but a real `spawnSync`, a real
`node_modules/.bin/stryker` binary, and a real fixture repo — end to end
twice:

1. Writes a fixture `lib/core/widget.js` (`add(a, b)`) and a **strong** test
   that asserts both `add(2,3) === 5` and `add(-1,1) === 0`. Runs
   `mutation-gate` against a fresh baseline path → asserts exit 0 and a
   baseline score of exactly `100` (every mutant killed).
2. Overwrites the test with a **shallow/weak** test (`typeof add ===
   'function'`, the exact "AI-generated shallow reproduction test" pattern
   the mission's Why Now section cites) and reruns `mutation-gate` against
   the *same* baseline path → asserts exit code `1`, a `ratchet FAILED`
   message naming `lib/core/widget.js`, and that the baseline file was
   **not** overwritten with the regressed score (still `100`).

## Bug found and fixed during CP-5

The first attempt at this test failed in a revealing way: running the gate
from *inside* a `node --test` process (exactly what this regression test
does) produced a mutation score of `0` even for the strong test that should
kill everything. Root cause: Stryker's `command` test runner spawns `node
--test <file>` per mutant, inheriting the parent process's environment. When
that parent is itself a `node --test` run, `NODE_TEST_CONTEXT` leaks into
the nested invocation, and Node treats it as a subtest of the outer run
instead of an independent process — the outer runner swallows the nested
run's pass/fail signal, so every mutant looked "Survived" regardless of
whether the injected mutation actually broke the test.

This is the same hazard `coverage-gate.ts` already guards against (it
explicitly `delete childEnv.NODE_TEST_CONTEXT` / `NODE_OPTIONS` before
spawning its own nested `node --test`). Fixed by applying the identical
guard in `runStryker()` (`lib/commands/mutation-gate.ts`): build a sanitized
`childEnv` with those two vars stripped and pass it via `spawnSyncFn`'s
`env` option. Re-verified: score returned to `100` for the strong test.
This also means the gate is now safe to run as part of `npm test` itself
(e.g. via `scripts/verify-local.sh integrate`, CP-7), not just from a bare
shell.

## Goal Check

| Success criterion | Evidence |
|---|---|
| `test/mutation-gate-ratchet.test.js` injects a surviving mutant and asserts the ratchet rejects it (exit code 1) | `test/mutation-gate-ratchet.test.js:77-116`, test `mutation-gate ratchet rejects a surviving-mutant regression (CP-5)` |
| Self-contained (no network, no external tools beyond the gate's own) | Test uses only `node:child_process`, `node:fs`, `node:os`, `node:path`, the already-installed `@stryker-mutator/core` bin, and `lib/commands/mutation-gate.js` — no fetches, no new deps |
| Regression test passes | `FORCE_COLOR=0 node --test test/mutation-gate-ratchet.test.js` → `tests 1, pass 1, fail 0` |
| Fix verified not to regress existing suite | `FORCE_COLOR=0 node --test test/mutation-gate.test.js test/mutation-scoper.test.js test/mutation-gate-ratchet.test.js` → `tests 18, pass 18, fail 0`; `./scripts/verify-local.sh static-analysis` → `ALL STAGES PASSED` |
| Env-leak fix | `lib/commands/mutation-gate.ts` `runStryker()` — strips `NODE_TEST_CONTEXT`/`NODE_OPTIONS` from the child env before spawning Stryker |

Next action: Write `docs/adr/adr-mutation-testing.md` (CP-6), including the
line-coverage-vs-mutation-score comparison (citing arxiv 2510.09907), the
pre-integrate lifecycle placement rationale, the regex-based (not
TS-compiler) callee resolution limitation from CP-2, the incremental
baseline-seeding decision from CP-4, and this checkpoint's
`NODE_TEST_CONTEXT` nested-test-runner hazard as a documented gotcha for
anyone extending the `command` test runner integration.
