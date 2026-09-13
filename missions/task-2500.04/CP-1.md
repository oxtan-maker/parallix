# CP-1 — Test-family inventory, semantic categories, and the proposed command contract

## Summary

CP-1 audited the repository's test runners and every discovered test family,
defined the four semantic verification categories and the permitted dependency
set for each lane, and fixed the stable command contract that CP-2 implements.
No runner behaviour changed in this checkpoint.

### Runners in use today

| Runner | Entry | What it selects |
|---|---|---|
| Default (hermetic) suite | `npm test` | `test/run-default-tests.ts` with no arguments |
| Integration suite | `npm run test:integration` | the same runner with `--integration` |
| Lifecycle E2E | `node --import tsx test/e2e-mission-lifecycle.test.ts` | invoked directly by the `workflow` gate |
| Real-agent smoke | `node --import tsx test/e2e-real-agent-smoke.test.ts` | invoked directly by the `custom-agent-smoke` / `agent-smoke` gate |
| Package audit | `npm run test:package-content` | `scripts/package-content-audit.ts` |
| Bundle smoke | `npm run test:bundle` | runs the built `build/px.mjs` |
| Typecheck | `npm run typecheck` | `tsconfig.json` + `tsconfig.scripts.json` |

Selection currently lives in `test/lib/test-run-plan.ts` and is **negative**:
a file lands in the integration lane when it matches `boundaryDependencyPattern`,
carries the `.integration.test.ts` suffix, or is listed in
`knownIntegrationTestFiles`; everything else silently becomes a default-suite
(unit) test. There is no CI/local distinction at all today.

### Measured inventory

Counted with `find test -name '*.test.ts'` and with `buildTestRunPlan` from
`test/lib/test-run-plan.ts` called for `[]` and for `['--integration']`:

| Bucket | Files |
|---|---|
| Discovered `*.test.ts` under `test/` and `test/adapters/` | 464 |
| Selected by `npm test` (default/hermetic) | 305 |
| Selected by `npm run test:integration` | 157 |
| Selected by neither (gate-only E2E) | 2 |

The two gate-only files are `test/e2e-mission-lifecycle.test.ts` and
`test/e2e-real-agent-smoke.test.ts`; `test/lib/test-run-plan.ts` filters both out
of root discovery by name. Every other discovered file is selected by exactly one
of the two commands, so the inventory is exhaustive with no silently dropped file.

### Environmental audit of the 157 integration files

Empirical run (`npm run test:integration`, isolated `HOME`/`PARALLIX_HOME`/
`FORGEJO_URL` supplied by the `test/bootstrap-parallix-home.ts` preload, no
`PARALLIX_REAL_AGENT*`, no Forgejo credentials, no operator model config):
`tests 2143`, `pass 2103`, `fail 15`, `duration_ms 63556`, wall clock 72.17 s.

The 15 failures collapsed to three files, and re-running just those three
resolved two of them as artefacts of this workstation's read-only `~/.npm`
(`npm error Log files were not written due to an error writing to the directory`),
not as a missing CI capability:

| File | Verdict |
|---|---|
| `test/task-2285-pack-install-smoke.test.ts` | passes once npm can write a cache; portable, CI-safe |
| `test/web-package-smoke.integration.test.ts` | passes once npm can write a cache; portable, CI-safe |
| `test/task-2270-graphify-exclusion.test.ts` | genuinely needs the `uv`-installed `graphify` binary; local-only |

External executables spawned by literal name across the 157 integration files:
`git` (306 call sites), `node` (10), `bash` (9), `npm` (4), `uv` (1), `tar` (1),
`bwrap` (1). `test/helpers/pty-smoke-harness.ts` additionally requires
`/usr/bin/script` and `/usr/bin/stty`, both present in the standard
GitHub-hosted Ubuntu runner image. `scripts/build-sea.ts` requires a Node
runtime with major `>= MINIMUM_SEA_NODE_MAJOR` (25) plus `postject`, and it
resolves that runtime from `PARALLIX_SEA_NODE`, `process.execPath`, `PATH`, or
an nvm install.

## Semantic categories and their permitted dependencies

| Category | Permitted dependencies | Forbidden |
|---|---|---|
| `unit` | in-process modules, injected doubles, the isolated temp `HOME`/`PARALLIX_HOME` from the bootstrap preload | real processes, real databases, real sockets, any external binary |
| `integration-ci` | `git`, `node`, `npm`, `bash`, `tar`, `/usr/bin/script`, `/usr/bin/stty`, the repository checkout, temp dirs, loopback sockets | local AI or model service, operator model configuration, Forgejo credentials or live Forgejo state, pre-existing worktrees outside the test's own temp roots, private local services, any binary outside the clean runner image |
| `integration-local` | everything `integration-ci` may use, plus workstation tooling (`bwrap`, `uv`/`graphify`) and a Node ≥ 25 SEA toolchain | still no live Forgejo credentials and no real model traffic (those belong to `agent-e2e`) |
| `agent-e2e` | a configured real agent runner and a reachable model backend, operator agent configuration, full mission lifecycle against real Git | — |

### Trust boundaries

- **GitHub CI (`unit` + `integration-ci`)** proves the code builds, typechecks,
  is internally consistent, and that its process/Git/SQLite/packaging boundaries
  behave on a clean checkout with no operator state.
- **Local Parallix verification (`integration-local` added)** additionally proves
  the confinement, external-tooling, and native-distribution behaviour that needs
  workstation packages.
- **Real-agent verification (`agent-e2e`)** is the only lane that proves a real
  agent runner and a real model drive a mission end to end.

## Proposed stable command contract (implemented in CP-2)

| Command | Lane |
|---|---|
| `npm test` | `unit` (unchanged) |
| `npm run test:integration:ci` | `integration-ci`, positively selected |
| `npm run test:integration:local` | `integration-local`, positively selected |
| `npm run test:integration` | the union, unchanged, so the existing `integration-suite` gate keeps its coverage |
| `npm run test:agent-e2e` | `test/e2e-real-agent-smoke.test.ts` |
| `npm run test:lifecycle-e2e` | `test/e2e-mission-lifecycle.test.ts` |
| `npm run test:ci` | GitHub-safe aggregate: typecheck, build, `unit`, `integration-ci`, bundle smoke, package-content audit |

Membership becomes positive: `test/lib/test-categories.ts` will carry an
explicit `integration-ci` list and an explicit `integration-local` list with a
recorded reason per local entry, and a new focused test will fail when a
discovered integration file appears in neither list.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every current test family is inventoried and no file is silently dropped | `buildTestRunPlan` in `test/lib/test-run-plan.ts` called with `[]` and `['--integration']` yields 305 + 157 files; `find test -name '*.test.ts'` yields 464; the 2 remaining files are `test/e2e-mission-lifecycle.test.ts` and `test/e2e-real-agent-smoke.test.ts` | PASS |
| The four semantic categories and their permitted dependencies are recorded | "Semantic categories and their permitted dependencies" table above; category names `unit`, `integration-ci`, `integration-local`, `agent-e2e` match the Backlog task's Mission Requirements | PASS |
| The environmental boundary of each integration family is derived from behaviour, not filenames | `npm run test:integration` run under the `test/bootstrap-parallix-home.ts` isolation preload: `tests 2143 / pass 2103 / fail 15`; the three failing files re-run individually to isolate workstation artefacts from real dependencies | PASS |
| Local-only dependencies are identified with their exact cause | `test/task-2270-graphify-exclusion.test.ts` spawns `uv`/`graphify`; `test/bubblewrap-worktree-git.test.ts` spawns `bwrap`; `test/task-2286-native-sea-smoke.test.ts` drives `scripts/build-sea.ts`, which requires Node major `>= MINIMUM_SEA_NODE_MAJOR` | PASS |
| CI/local/real-agent trust boundaries are stated before runner changes | "Trust boundaries" section above; the real-agent lane's existing obligations are described in `docs/real-agent-smoke.md` and enforced by the `agent-smoke` gate in `workflow.config.json` | PASS |
| A stable command contract is proposed before changing runners | "Proposed stable command contract" table above; current scripts are the `test`, `test:integration`, `typecheck`, `test:bundle`, `test:package-content` entries in `package.json` | PASS |
| Runtime baseline is captured for later comparison | `npm run test:integration` wall clock 72.17 s, reporter `duration_ms 63556`; `npm test` wall clock 41.71 s, reporter `tests 2521 / pass 2521 / fail 0`, `duration_ms 39172`, on this workstation | PASS |

Next action: CP-2 — add `test/lib/test-categories.ts` with the explicit
`integration-ci` / `integration-local` membership lists, teach
`buildTestRunPlan` the `--integration-ci` and `--integration-local` selectors,
add the `test:ci`, `test:integration:ci`, `test:integration:local`,
`test:agent-e2e`, and `test:lifecycle-e2e` scripts to `package.json`, and add
`test/test-categories.test.ts` proving an unclassified integration file fails
the suite and cannot reach the CI lane.
