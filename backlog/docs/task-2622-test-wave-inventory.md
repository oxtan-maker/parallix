# TASK-2622 test migration inventory

Planning snapshot captured 2026-09-30 at `78c1fc1464c931ec2afdbd92dc66975726dbe4f9`. This artifact is historical task evidence, not live product documentation or executable membership/cache authority.

## Population

610 test files; 341 task-named by filename glob test/task-*.test.ts (340 of them carry a numeric task ID task-\d+; the one difference is test/task-metadata-pure.test.ts, a textual suffix). Tiers: 397 unit, 203 integration-ci, 8 integration-local, 2 agent/lifecycle E2E. All actual test files are accounted for. The JSON contains each original path, SHA-256, current tier, proposed owner, migration task, task provenance, direct runtime/fixture references, direct state markers, potential transitive local-module count and routing confidence.

| Child | Proposed owner | Files | Unit | CI integration | Local integration | Agent E2E |
|---|---|---:|---:|---:|---:|---:|
| TASK-2622.06 | domain | 22 | 19 | 3 | 0 | 0 |
| TASK-2622.07 | lifecycle | 46 | 33 | 13 | 0 | 0 |
| TASK-2622.08 | review | 85 | 56 | 29 | 0 | 0 |
| TASK-2622.09 | integration | 91 | 54 | 37 | 0 | 0 |
| TASK-2622.10 | persistence | 48 | 19 | 29 | 0 | 0 |
| TASK-2622.11 | agents | 64 | 47 | 13 | 4 | 0 |
| TASK-2622.12 | recovery | 31 | 26 | 5 | 0 | 0 |
| TASK-2622.13 | metrics | 49 | 30 | 18 | 1 | 0 |
| TASK-2622.14 | cli-config | 35 | 23 | 12 | 0 | 0 |
| TASK-2622.15 | presentation | 60 | 48 | 12 | 0 | 0 |
| TASK-2622.16 | verification | 52 | 29 | 22 | 1 | 0 |
| TASK-2622.17 | distribution | 27 | 13 | 10 | 2 | 2 |

Owner routes are initial file-level proposals based on names, runtime imports and targeted source review. They are not reviewed assertion-level dispositions. Mixed files may split across contracts; secondary owners and ambiguous routes must be reviewed in .01 and the owning slice. Same-line coverage is insufficient evidence that two behavioral assertions are equivalent. Literal declaration counts are syntactic observations, not executed test counts. Support files and their direct test users are included; indirect consumers and assets require lifecycle review in .04.

## Dependency investigation candidates

| Root | Potential reachable production modules |
|---|---:|
| `test/bootstrap-parallix-home.ts` | 39 |
| `src/adapters/agents/launcher-selection.ts` | 37 |
| `src/composition/application-services.ts` | 246 |
| `src/adapters/filesystem/mission-utils.ts` | 11 |

Reachability follows TypeScript AST runtime import/export, literal dynamic import and module-mock/importFresh edges; type-only imports are excluded. It does not measure evaluated modules, CPU, external-package internals, nonliteral imports or filesystem/resource dependencies. Do not use it as a cache invalidation graph. .02 must profile runtime cost before .05 refactors these edges.

The common bootstrap imports launcher-selection, which eagerly imports all agent family implementations. The application-services composition entry point pulls many unrelated services/adapters into its potential closure. The test suite already guards legal architectural layers, so this is an investigation of runtime fan-out and test boundary selection, not proof of architecture violations.

## Wave execution

| Task | Outcome | Dependencies |
|---|---|---|
| TASK-2622.01 | Freeze behavior and coverage parity baseline for the test refactor | None |
| TASK-2622.02 | Profile dependency fan-out and separate worker setup from assertion cost | TASK-2622.01 |
| TASK-2622.03 | Evaluate compile-once ESM execution with unchanged test isolation | TASK-2622.04 |
| TASK-2622.04 | Consolidate fixture builders and reduce repeated bootstrap work safely | TASK-2622.02 |
| TASK-2622.05 | Reduce measured runtime dependency hotspots through explicit boundaries | TASK-2622.04 |
| TASK-2622.06 | Pilot behavior-owned domain and application contract suites | TASK-2622.05 |
| TASK-2622.07 | Consolidate Mission intake and lifecycle behavior tests | TASK-2622.10, TASK-2622.11 |
| TASK-2622.08 | Consolidate review authorization and provider behavior tests | TASK-2622.07 |
| TASK-2622.09 | Consolidate Git integration rebase and closeout safety tests | TASK-2622.08, TASK-2622.16 |
| TASK-2622.10 | Consolidate persistence migration and legacy content tests | TASK-2622.06 |
| TASK-2622.11 | Consolidate agent selection launching telemetry and confinement tests | TASK-2622.06 |
| TASK-2622.12 | Consolidate recovery supervision and current-work behavior tests | TASK-2622.08 |
| TASK-2622.13 | Consolidate metrics history and cohort behavior tests | TASK-2622.07 |
| TASK-2622.14 | Consolidate CLI configuration and discovery behavior tests | TASK-2622.12, TASK-2622.13 |
| TASK-2622.15 | Consolidate web TUI and board projection behavior tests | TASK-2622.14 |
| TASK-2622.16 | Consolidate coverage gate runner and architecture hygiene tests | TASK-2622.03, TASK-2622.06 |
| TASK-2622.17 | Consolidate packaging publication and end-to-end boundary tests | TASK-2622.09, TASK-2622.15 |
| TASK-2622.18 | Evaluate feature-scoped result reuse with complete dependency and coverage inputs | TASK-2622.17, TASK-2622.19 |
| TASK-2622.19 | Establish behavior-owned regression authoring and migration policy | TASK-2622.06 |
| TASK-2622.20 | Certify full behavior coverage parity and verification throughput | TASK-2622.18 |

Baseline -> cost attribution -> fixture foundation -> execution/dependency work -> pilot. Persistence, agents, verification and authoring establish stable foundations before lifecycle/review and their recovery, metrics, integration, CLI, presentation and E2E consumers. See the [dependency graph and scheduling lanes](task-2622-test-wave-schedule.md). Authoring policy starts after the pilot. Selective reuse is an optional evaluation after migration, and final parity/throughput certification depends on every disposition. The dependency task can conclude that production changes are unjustified; the compile/cache tasks can reject adoption.

No code has changed as part of planning. Existing measurements are historical; .01 refreshes the baseline against the chosen clean candidate. The final target is >=50% less unit-plus-CI-integration CPU, including compile/report cost. Whole-workflow throughput claims require the separate whole-gate CPU and representative five/ten-client evidence in ADR 0063.

## Evidence and authorities

- `test/lib/test-tier-selection.ts` and `test/lib/test-categories.ts`: current executable populations.
- `workflow.config.json` adapters.gates.preIntegration: mandatory px integrate gate graph; config/integration-pipelines.json belongs to standalone verify-local integrate.
- `tools/nx-evaluation/results.json`, `local-hybrid-gate-results.json`, `integration-isolation-results.json`: historical CPU/wall trials.
- `tools/nx-evaluation/coverage-attribution-probe.json`: unresolved native concurrent attribution evidence.
- ADR 0057: tier and trust decision; ADR 0062: native coverage/denominator; ADR 0063: previous performance findings and adoption criteria.
- Repository instructions also ask to read ADR 0059 before selection changes; that ADR now describes recovery supervision. Read both applicable instructions and ADR 0057 instead of silently interpreting the stale number.

Full inventory: [task-2622-test-wave-inventory.json](task-2622-test-wave-inventory.json).
