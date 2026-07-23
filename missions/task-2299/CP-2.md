# CP-2 — Add normalization helper and update affected rebase fakes

## Work summary

Added a test-local Git argument-normalization helper to both rebase test files and rewrote every fixed-index fake to check the normalized subcommand tail.

- Added `gitSubcommandArgs(args)` to `test/rebase.test.ts:13` and `test/rebase_diagnostics.test.ts:13`. It strips exactly the leading `-C <executionRoot>` and `-c <key=value>` global-option pairs and returns the tail whose index 0 is the Git subcommand. It does not accept malformed input loosely: only the two known global options (`-C`, `-c`) are skipped, each consuming its required value; any other leading token stops normalization so the subcommand position stays strict.
- Rewrote all fixed-index fakes to normalize before indexing:
  - `test/rebase.test.ts`: every `args[0]`/`args[1]`/`args[2]` subcommand check now reads `gitSubcommandArgs(args)[…]` — `fetch`, `checkout … [2]`, `add`, `status --porcelain`, `rebase --show-current`. Verified none remain: `grep -n "args\[0\]\|args\[1\]\|args\[2\]" test/rebase.test.ts` → no matches.
  - `test/rebase_diagnostics.test.ts:80-86`: `checkout`, `add`, `status --porcelain`, `rebase --show-current`, `fetch` normalized. Verified none remain via the same grep → no matches.
- Left order-independent `.includes(...)` matchers (`args.includes('rebase') && args.includes('main')`, `args.includes('branch') && args.includes('--list')`, `args.includes('--continue')`) unchanged: they hold no fixed-index assumption and already tolerate the `-C` prefix.
- Assertions were not touched — the strict subcommand/prefix expectations and retry/diagnostic assertions remain exactly as before.

Focused run now green: `node test/run-default-tests.js test/rebase.test.ts test/rebase_diagnostics.test.ts` → `tests 40 / pass 40 / fail 0`.

Lint/hygiene notes:
- No `.only`/`.skip` introduced: `grep -n "\.only\|\.skip" test/rebase.test.ts test/rebase_diagnostics.test.ts` → no matches.
- `npx tsc --noEmit` clean.
- The repository lint gate runs `eslint … src/` (`scripts/verify-local.sh:95`) and does not lint `test/`. `test/rebase.test.ts` and `test/rebase_diagnostics.test.ts` carry 34 pre-existing style errors (`curly`, unused `opts`); the count is identical before and after this change (confirmed by stashing), so no new lint findings were introduced. Changed lines match the surrounding single-line `if (...) return ...;` style.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Affected fakes explicitly normalize `-C <executionRoot>` before checking subcommand, no loose matching | `test/rebase.test.ts:13` (`gitSubcommandArgs`), `test/rebase_diagnostics.test.ts:13`; rewritten checks e.g. `test/rebase_diagnostics.test.ts:85` | PASS |
| `rebase caps failed continue retries when rebase remains active` records/asserts exactly three attempts | `test/rebase.test.ts:661` (`assert.equal(continueCalls, 3)`), test now passes | PASS |
| `rebase reports git output on failed continue attempt` asserts failed-continue output + hook diagnostic | `test/rebase_diagnostics.test.ts:96-98`, test now passes | PASS |
| Every nearby fixed-index fake updated | `test/rebase.test.ts`, `test/rebase_diagnostics.test.ts` — grep for `args[0]/[1]/[2]` returns no matches post-edit | PASS |
| Focused command green with mocked deps only | `node test/run-default-tests.js test/rebase.test.ts test/rebase_diagnostics.test.ts` → `pass 40 / fail 0` | PASS |
| `./scripts/verify-local.sh all` | deferred to CP-4 | PENDING |

Next action: In CP-3, re-read the two named tests to confirm their retry-cap and failed-continue diagnostic assertions are intact, then re-run the focused command and record per-criterion evidence.
