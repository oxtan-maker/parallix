# CP-4 — Documentation and final verification

## Summary

Recorded the required MINOR changelog entry and updated the authoritative local
tarball installation instructions. The documentation now states that `npm
pack` runs the production build, that an installed `px` executes
`dist/px.js`, and that source-checkout development continues through the
sibling-`.js` `build:cjs` compatibility runtime.

The pre-review rerun exposed one unrelated handoff call-order test whose mocks
did not provide the newly required transition-lease lookup. A subsequent
rerun completed every assertion but was terminated by its supervisor after the
Node test runner printed the final TAP summary. The default runner now uses
Node's `--test-force-exit` flag on the Node releases that support it, retaining
the declared Node 20.0–20.13 compatibility; its focused contract test covers
both sides of the Node 20.14 boundary. The root package-lock metadata now
matches the dist bin entry in `package.json`. `./scripts/verify-local.sh all`
completed with 884 passing tests and no failures. `graphify update .` could not be run because
the `graphify` executable is not installed; the graph output was absent before
the mission began.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CommonJS manifest directs main, bin, and supported exports to dist and encapsulates internals | `package.json:7`, `package.json:8`, `package.json:10`, `package.json:12` | PASS |
| Build emits dist JavaScript and source maps; prepack produces the artifact; entries enable source maps | `tsconfig.json:6`, `tsconfig.json:8`, `package.json:56`, `px.ts:30`, `index.ts:16` | PASS |
| Tarball includes permitted runtime content and excludes sources, tests, development configuration, and operator state | `package.json:39`, `test/task-1424-post-integrate-publish-reinstall.test.js:83`, `test/task-1424-post-integrate-publish-reinstall.test.js:85`; ADR 0044 | PASS |
| Temporary-prefix install runs dist/px.js and named read-only commands outside the checkout | "installed dist-layout tarball runs read-only commands outside the checkout"; `test/task-1424-post-integrate-publish-reinstall.test.js:97`, `test/task-1424-post-integrate-publish-reinstall.test.js:101` | PASS |
| Persistent-data and publish/reinstall successors execute the dist layout | "global tarball reinstall preserves PARALLIX_HOME stats and agent blocklist"; `test/package-persistent-data.test.js:80` | PASS |
| MINOR release record and accurate installation instructions are present | `CHANGELOG.md:36`, `docs/authority-reference.md:328` | PASS |
| T4/T5 scope was not pulled forward: sibling development runtime and freshness guard remain | `package.json:54`, `package.json:55`, `package.json:58`, `lib/core/build-freshness.ts:82` | PASS |
| Transition-lease handoff test remains isolated from Forgejo | `test/task-1104-call-order.test.js:187`; "performHandoff follows the sequence: createPr -> gatekeeper -> transitionTask -> push" | PASS |
| Completed Node test runs return control without dropping Node 20.0–20.13 support | `test/run-default-tests.js:13`, `test/run-default-tests.js:110`; "default test runner routes every moved group to integration and excludes it from default" | PASS |
| Root lockfile describes the dist package entry | `package-lock.json:9`, `package-lock.json:12`, `package.json:3`, `package.json:10` | PASS |
| Required mission gate passes | `./scripts/verify-local.sh all` | PASS — 884 tests passed |

Next action: retain the committed checkpoint set for Parallix lifecycle processing; do not transition this task or run review/integration commands from this mission branch.
