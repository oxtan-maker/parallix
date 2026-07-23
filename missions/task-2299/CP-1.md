# CP-1 — Inspect rebase Git fakes and document the normalization contract

## Work summary

Reproduced the regression and mapped the stale-index audit surface.

- Confirmed production change: commit `6f401e34a` made every rebase-path Git call execution-root-aware by prefixing `-C <executionRoot>` (and the existing `-c core.editor=true -c merge.autoedit=no` config pairs) ahead of the Git subcommand — see `src/platform/runtime/lib/commands/rebase.ts:125` (initial rebase), `:249` (`rebase --continue`), `:279`/`:282`/`:284` (checkout/add), `:318` (`status --porcelain`), `:323`/`:330`/`:347`/`:384`/`:395`/`:457` (`rebase --show-current`).
- Reproduced RED baseline with `node test/run-default-tests.js test/rebase.test.ts test/rebase_diagnostics.test.ts`:
  - `rebase caps failed continue retries when rebase remains active` fails `1 !== 3` at `test/rebase.test.ts:661`.
  - `rebase reports git output on failed continue attempt` fails: continue-failure diagnostics empty at `test/rebase_diagnostics.test.ts:96`.
- Root cause: fakes read the Git subcommand at fixed `args[0]`/`args[1]`/`args[2]`, but the subcommand is now shifted right by the `-C <executionRoot>` prefix, so `checkout`/`add`/`status`/`rebase --continue`/`rebase --show-current` branches never match and the retry/diagnostic paths are masked.

### Affected fixed-index fakes (audit surface, bounded to the two named test files)

- `test/rebase.test.ts`: lines 183, 210, 240, 262, 290, 437, 515, 519, 522, 531, 576, 588, 591, 632, 636, 639, 647, 650, 689, 693, 696, 705, 709.
- `test/rebase_diagnostics.test.ts`: lines 38, 78, 80, 81, 85, 86.
- `.includes(...)`-based matchers (e.g. `args.includes('rebase') && args.includes('main')`, `args.includes('branch') && args.includes('--list')`, `args.includes('--continue')`) are order-independent and already tolerate the `-C` prefix; they are demonstrated not to hold a fixed-index assumption and are left unchanged.

### Intended normalization contract (for CP-2)

Add a test-local helper `gitSubcommandArgs(args)` in each file that strips exactly the leading Git global options — `-C <executionRoot>` and `-c <key=value>` pairs — and returns the tail whose index 0 is the Git subcommand. Rewrite each fixed-index fake to test the normalized tail (`sub[0]`, `sub[1]`, `sub[2]`). This normalizes the `-C <executionRoot>` prefix explicitly, without loose whole-array matching that would accept malformed commands.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Affected fakes explicitly normalize `-C <executionRoot>` before checking subcommand (contract defined) | `src/platform/runtime/lib/commands/rebase.ts:125`, `src/platform/runtime/lib/commands/rebase.ts:249` (prefix source); audit list above | PENDING (design set, edits in CP-2) |
| `rebase caps failed continue retries when rebase remains active` asserts exactly three attempts | `test/rebase.test.ts:661` (RED: `1 !== 3`) | RED (to fix) |
| `rebase reports git output on failed continue attempt` asserts failed-continue output/hook diagnostic | `test/rebase_diagnostics.test.ts:96` (RED: empty output) | RED (to fix) |
| Every nearby fixed-index fake identified | `test/rebase.test.ts` lines 183–709, `test/rebase_diagnostics.test.ts` lines 38–86 (enumerated above) | PASS |
| Focused command reproduces | `node test/run-default-tests.js test/rebase.test.ts test/rebase_diagnostics.test.ts` | RED (baseline captured) |
| `./scripts/verify-local.sh all` | deferred to CP-4 | PENDING |

Next action: In CP-2, add the `gitSubcommandArgs` helper to `test/rebase.test.ts` and `test/rebase_diagnostics.test.ts` and rewrite each enumerated fixed-index fake to use the normalized tail.
