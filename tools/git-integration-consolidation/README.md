# Git integration consolidation evidence (TASK-2622.09)

Historical evidence for the Git integration, rebase, landing, and closeout test
migration. The reviewer-facing ledger is `backlog/docs/task-2622.09-behavior-ledger.md`.
Nothing here selects tests; membership stays with `test/lib/test-categories.ts`,
`test/lib/test-tier-selection.ts`, and `test/lib/test-run-plan.ts`.

- `migration.json` maps every moved source file and its verbatim case titles to
  its destination suite, and lists the retained suites with the reason.
- `measurement.json` holds the focused before/after CPU and wall figures.
- `coverage-comparison.json` is the output of `compare-native-lines.mjs`
  (normalized executable-line identity and positive-hit comparison).
- `compare-native-lines.mjs <baseline.info> <candidate.info> [out.json]` compares two
  LCOV files from `tools/coverage-comparison/compare-slice-coverage.ts` and exits
  non-zero when a lost covered line or an inventory difference is not erased
  TypeScript syntax.

Raw LCOV files are not checked in.
