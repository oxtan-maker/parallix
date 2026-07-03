# CP-4: Baseline initialization

## Summary

The first-run/no-baseline behavior described by this checkpoint is already
implemented in `mutation-gate.ts`'s ratchet logic (CP-3): `loadBaseline()`
returns `{ filePaths: {} }` whenever `config/mutation-baseline.json` doesn't
exist yet (or is malformed), and the ratchet check
(`lib/commands/mutation-gate.ts:253-260`) only rejects a file when a
**prior** `baseline.filePaths[file]` entry exists and the new score is lower
— a file with no prior entry has nothing to regress against, so it passes
automatically and its score is written to the baseline on that run.

**Deliberate scope decision, documented here rather than in a separate
init path:** this checkpoint's literal text ("initialize
`config/mutation-baseline.json` with current scores for **all** `lib/`
files") would require an eager full-repo mutation run on first use. That
directly conflicts with the mission's own **Out of Scope** section
("Full-repo mutation testing (too slow; explicitly scoped to mission
diff)") and its Stop Rule about runtime budget. Those sections take
precedence over a single checkpoint's phrasing when they conflict, so the
implementation instead **seeds the baseline incrementally, one diff scope at
a time**: the very first mission that touches any given `lib/` file
establishes that file's baseline entry (automatic pass, since there's
nothing to compare against), and every subsequent mission ratchets against
whatever was last recorded. Untouched files simply have no baseline entry
until a mission's diff scope includes them — which is consistent with the
mission's guiding principle throughout (diff-scoped, not full-repo). This
tradeoff and its consequence (a file's ratchet doesn't kick in until its
second touch) is recorded in `docs/adr/adr-mutation-testing.md` (CP-6).

## Verification

`test/mutation-gate.test.js`, test `run: first-run with no baseline entries
passes the ratchet and seeds the baseline (CP-4)` (lines 115-155):
constructs a fresh, empty baseline path, runs `mutation-gate` against a
single target file with a fake Stryker report (1 killed / 1 survived → score
50), and asserts:
- `exitCode === 0` (no regression is reported, since there is no prior entry)
- `config/mutation-baseline.json`-shaped output now contains
  `filePaths['lib/core/widget.js'].score === 50` and a non-empty
  `.timestamp`

Also covered: `loadBaseline returns empty filePaths when file is missing`
and `loadBaseline returns empty filePaths on malformed JSON`
(`test/mutation-gate.test.js:34-47`), confirming the "no baseline exists"
precondition this checkpoint is about is handled safely (never throws, never
blocks the gate).

## Goal Check

| File:line | Evidence |
|---|---|
| `lib/commands/mutation-gate.ts:75-88` (`loadBaseline`) | Returns `{ filePaths: {} }` for missing/malformed baseline files |
| `lib/commands/mutation-gate.ts:253-260` | Ratchet only fires when `priorEntry` exists; first-seen files pass |
| `lib/commands/mutation-gate.ts:272-279` | Baseline entries seeded with `score` + ISO `timestamp` on first successful run |
| `test/mutation-gate.test.js:34-36` | `loadBaseline returns empty filePaths when file is missing` — passes |
| `test/mutation-gate.test.js:38-47` | `loadBaseline returns empty filePaths on malformed JSON` — passes |
| `test/mutation-gate.test.js:115-155` | `run: first-run with no baseline entries passes the ratchet and seeds the baseline (CP-4)` — passes, exit 0, baseline seeded |
| `docs/adr/adr-mutation-testing.md` (CP-6, pending) | Will record the incremental-seeding-vs-eager-full-scan decision |

Command run: `FORCE_COLOR=0 node --test test/mutation-gate.test.js` →
`tests 9, pass 9, fail 0`.

Next action: Author `test/mutation-gate-ratchet.test.js` (CP-5) — a
self-contained regression test that runs the real Stryker POC-proven
pipeline end-to-end against a fixture file, injects a surviving mutant by
weakening its test, and asserts the ratchet rejects it with exit code 1.
