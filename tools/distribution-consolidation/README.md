# Distribution consolidation evidence (TASK-2622.17)

Historical evidence for the packaging, publication, installation, native SEA, assets, graphify, and
end-to-end boundary test migration. The reviewer-facing ledger is
`backlog/docs/task-2622.17-behavior-ledger.md`. Nothing here selects tests; membership stays with
`test/lib/test-categories.ts`, `test/lib/test-tier-selection.ts`, `test/lib/test-run-plan.ts`, and
`test/lib/shared-unit-files.json`.

- `migration.json` maps every moved source file and its verbatim case titles to its destination suite,
  and lists the retained suites with their tier.
- `measurement.json` holds the focused before/after CPU and wall figures.
- `coverage-comparison.json` is the output of `tools/git-integration-consolidation/compare-native-lines.mjs`
  (normalized executable-line identity and positive-hit comparison).

Raw LCOV files are not checked in.
