# CP-3 — Confirm retained named assertions and re-run focused command

## Work summary

Verified that the two named tests keep their retry-cap and failed-continue diagnostic assertions after the fixture normalization, and re-ran the focused command.

- `rebase caps failed continue retries when rebase remains active` still records and asserts exactly three `git rebase --continue` attempts and the recovery hint:
  - `test/rebase.test.ts:678` — `assert.equal(continueCalls, 3);`
  - `test/rebase.test.ts:680` — `assert.match(capturedStderr.join('\n'), /after 3 failed --continue attempt/);`
  - `test/rebase.test.ts:681` — `assert.match(capturedStderr.join('\n'), /git rebase --skip/);`
- `rebase reports git output on failed continue attempt` still asserts the failed `git rebase --continue` output/stderr and the hook diagnostic:
  - `test/rebase_diagnostics.test.ts:113` — `assert.match(combined, /git rebase --continue failed/i);`
  - `test/rebase_diagnostics.test.ts:114` — `assert.match(combined, /--- Git Output ---/);`
  - `test/rebase_diagnostics.test.ts:115` — `assert.match(combined, /another hook failed/);` (the injected failed-continue stderr from `test/rebase_diagnostics.test.ts:100`)
- Focused re-run green with mocked dependencies only: `node test/run-default-tests.js test/rebase.test.ts test/rebase_diagnostics.test.ts` → `tests 40 / pass 40 / fail 0`, including both named tests (`✔ rebase caps failed continue retries when rebase remains active`, `✔ rebase reports git output on failed continue attempt`).
- Hermeticity preserved: all Git access in the touched tests goes through the injected `gitFn` fake and other injected `*Fn` dependencies; no real Git or Forgejo is contacted.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Affected fakes explicitly normalize `-C <executionRoot>` before checking subcommand, no loose matching | `test/rebase.test.ts:13` (`gitSubcommandArgs`), `test/rebase_diagnostics.test.ts:85` | PASS |
| `rebase caps failed continue retries when rebase remains active` asserts exactly three attempts | `test/rebase.test.ts:678`, `test/rebase.test.ts:680` | PASS |
| `rebase reports git output on failed continue attempt` asserts failed-continue output + hook diagnostic | `test/rebase_diagnostics.test.ts:113`, `test/rebase_diagnostics.test.ts:115` | PASS |
| Every nearby fixed-index fake updated to normalized args | `test/rebase.test.ts`, `test/rebase_diagnostics.test.ts` (grep `args[0]/[1]/[2]` → no matches) | PASS |
| Focused command completes with mocked deps only | `node test/run-default-tests.js test/rebase.test.ts test/rebase_diagnostics.test.ts` → `pass 40 / fail 0` | PASS |
| `./scripts/verify-local.sh all` | deferred to CP-4 | PENDING |

Next action: In CP-4, run `./scripts/verify-local.sh all` on the committed tree and record the final criterion-by-criterion Goal Check with the gate result.
