# ADR 0062: Node native test coverage replaces c8

- Status: **Accepted**
- Date: 2026-09-27
- Task: TASK-2591
- Related: ADR 0057 (verification tiers and trust model), ADR 0060 (SonarQube analysis)

## Context

Until TASK-2586 the local coverage gate wrapped `node --test` in c8. TASK-2547
and TASK-2586 moved GitHub `ci-required` and the local pre-integration gates to
Node's built-in `--experimental-test-coverage`, but that path did not keep the
c8 contract: it had no include or exclude patterns and no way to report source
files that no test loads. The c8 runner (`coverage-gate.ts` with its raw
`NODE_V8_COVERAGE` scratch, orphan-recovery manifest and `/tmp` sweeper)
stayed in the tree after c8 itself was removed from the dependencies.

Node 26.7 added `--test-coverage-include-all`. This ADR records whether native
coverage with that flag is equivalent to the historical c8 contract, and
whether it makes integration-test CI faster.

The historical c8 contract was:

- denominator `src/**/*.ts`, with `test/**`, `prompts/**`, `config/*.json`,
  `.workflow/**` and `node_modules/**` excluded after source-map remapping;
- `--all`: source files that no test loads are reported at 0%;
- LCOV output, with a line threshold passed as `--lines` (the pipeline used
  `--threshold 0`; SonarQube owns the new-code coverage condition, ADR 0060).

## Measurement

The comparison harness is
`tools/coverage-comparison/compare-coverage-paths.ts`. It runs the
`integration-ci` population with the argv that `npm run
test:integration:ci:prebuilt` builds, changing only the coverage
implementation. Results are in
`tools/coverage-comparison/comparison-results.json`. The measurements used
Node 26.10.0: 26.7.0 could not be installed offline, and 26.5.0 lacks the flag.
The machine was shared, so each variant ran twice and the medians are reported.

| Variant | Node | Median wall time | Files | Untested files reported | Files outside `src/` |
|---|---|---|---|---|---|
| no coverage | 26.10.0 | 92.2 s | – | – | – |
| c8 (historical contract) | 26.10.0 | 149.8 s | 332 | 32 | 0 |
| native, include-all + patterns + source maps | 26.10.0 | 147.8 s | 332 | 33 | 0 |
| native, current CI flags (one run) | 24.21.0 | 181.8 s | 332 | 0 | 33 |

`tools/coverage-comparison/bundle-attribution-probe/run.sh` reproduces the
line-attribution findings on a four-file fixture.

## Findings

- **File set.** With `--test-coverage-include-all` and the same include and
  exclude patterns, native coverage reports exactly the 332 `src/**/*.ts` files
  that c8 reports; neither tool reports a file the other does not. The
  pre-existing native CI path omitted the 33 unloaded source files and instead
  reported 33 non-source files (`build/px.mjs`, `package.json`, temporary
  scripts).
- **Source maps are required.** Without `--enable-source-maps`, native
  coverage attributes V8 ranges to the tsx-transpiled line positions. Wherever
  type-only code is erased, the reported lines no longer match the `.ts` source.
  The pre-existing native CI path had this defect. With the flag, in-process
  and tsx-subprocess attribution matches c8 line for line on executable lines.
- **Type-only lines.** Native coverage omits lines that type stripping erases
  (`import type`, interfaces, type aliases). c8 counts them as covered, or as
  uncovered in unloaded files. These lines are not executable.
- **Bundled subprocesses.** Integration tests spawn the prebuilt, minified
  `build/px.mjs`. c8 remaps that bundle through `px.mjs.map` and marks every
  line of each bundled source file as covered, including functions that never
  ran. The probe shows `neverCalled` reported as covered. Native coverage
  does not attribute bundle execution to `src/`. This is the only behavioral
  gap, and the c8 side of it is not measurement: it is why c8 reports 94.3% of
  lines against native's 77.6%, and why 244 files differ line by line.
- **Thresholds and reporting.** Native coverage writes LCOV through
  `--test-reporter=lcov` and enforces a line threshold through
  `--test-coverage-lines`. The per-tier LCOV fragments still merge through
  `npm run coverage:merge`.
- **Speed.** On the same Node version native coverage is not materially faster
  than c8: 147.8 s against 149.8 s, within run-to-run noise. Coverage adds about
  55 s over an uninstrumented run for either tool. Both Node 26 coverage paths
  finished well inside the one measured run of the Node 24 CI path (181.8 s).
  Without a Node 24 uninstrumented baseline, that difference cannot be split
  between the Node version and the coverage flags.

## Decision

- Coverage runs use Node native coverage on Node 26.7 or newer with
  `--enable-source-maps`, `--test-coverage-include-all`,
  `--test-coverage-include=src/**/*.ts` and the historical exclude patterns.
  The runner selects a Node 26.7+ executable for coverage runs and fails with
  an explicit message when none is available. GitHub `ci-required` installs
  Node 26.
- No c8 machinery is retained. The one gap, attributing bundled-subprocess
  execution to sources, is not closed correctly by c8: it credits unexecuted
  code. Keeping c8 would preserve inflated numbers, not a coverage guarantee.
- The obsolete c8 runner in `coverage-gate.ts` is removed: its scratch
  directories, orphan-recovery manifest and `/tmp` sweeper go with it. The LCOV
  normalisation and merge used by `npm run coverage:merge`, and the
  tier-authority test selection, remain.
- The runner keeps one raw V8 setting: `NODE_V8_COVERAGE` points at a
  repo-local scratch directory, which the runner deletes. The native payload
  is about 1.2 GB per integration-ci run. Without the setting it would be
  written to the shared tmpfs `/tmp`.
- LCOV normalization removes comment-only and blank lines and local export
  lists from the line denominator. Native include-all reports these as
  zero-hit lines even though they contain no executable code. Runtime imports,
  re-exports and untested runtime statements remain in the denominator.

## Consequences

Reported line coverage drops, because c8's whole-file credit for bundled code
is gone and unloaded files are counted. Neither change weakens a threshold:
the pipeline threshold stays 0, and SonarQube's new-code condition is
unchanged. It now sees accurate line attribution. Code reached only through the
prebuilt bundle reads as uncovered unless a test also exercises it in-process
or through a tsx subprocess.
