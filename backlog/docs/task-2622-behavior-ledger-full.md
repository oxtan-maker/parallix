# TASK-2622.01 — Behavior ledger (HISTORICAL ARTIFACT), FULL PER-UNIT ENUMERATION

> One record per discovered tested unit on pinned revision **b3459b62757740a109bc9d1a72b5ed981bda3909**.
> Per-unit schema: behavior, guarantee, tier, task-provenance, pinned assertion file:line, owning-contract, disposition. Same-line LCOV coverage is **never** treated as proof of equivalent behavior (AC#3).

| identity | behavior | tier | task-provenance | assertion (file:line) | owning-contract | disposition |
|---|---|---|---|---|---|---|
| test/active.test.ts | boundary | integration-ci | TASK-1324, TASK-1387, TASK-2377.05, TASK-2476, TASK-2521.03, TASK-2582, TASK-2606, task-088, task-1031, task-1038, task-1124, task-118, task-1210, task-1211, task-8 | test/active.test.ts:40 | cli-config | keep |
| test/adapters/board-projection-builder-cp3.test.ts | boundary | unit | TASK-1001, TASK-2000, TASK-2001, TASK-2002, TASK-3001, TASK-4001, TASK-5001 | test/adapters/board-projection-builder-cp3.test.ts:100 | presentation | keep |
| test/adapters/concrete-adapters-cp2.test.ts | boundary | unit | TASK-1001, task-9999 | test/adapters/concrete-adapters-cp2.test.ts:60 | domain | keep |
| test/adapters/mission-read-adapter.test.ts | boundary | unit | TASK-1001, TASK-2001, TASK-3001, TASK-4001, TASK-5001, TASK-6001, TASK-7001, TASK-8001, TASK-8002, TASK-8003, TASK-9001, task-9998, task-9999 | test/adapters/mission-read-adapter.test.ts:75 | domain | keep |
| test/adapters/repository-wins.test.ts | boundary | unit | TASK-999, task-001, task-002, task-003, task-004, task-005, task-006 | test/adapters/repository-wins.test.ts:64 | domain | keep |
| test/adapters/single-path-guardrail.test.ts | behavior | unit |  | test/adapters/single-path-guardrail.test.ts:80 | domain | keep |
| test/adapters/status-characterization-cp4.test.ts | boundary | unit | task-1031, task-1322, task-2302 | test/adapters/status-characterization-cp4.test.ts:76 | cli-config | keep |
| test/agent-config-resolver.test.ts | boundary | unit |  | test/agent-config-resolver.test.ts:42 | agents, cli-config | keep |
| test/agent-stream-parity.test.ts | boundary | unit |  | test/agent-stream-parity.test.ts:38 | agents | keep |
| test/agent-strip.test.ts | boundary | unit | task-2328, task-2340 | test/agent-strip.test.ts:49 | agents | keep |
| test/agents-limit-hit.test.ts | boundary | integration-ci | TASK-2328, task-1208, task-1404, task-1405, task-1412, task-2380, task-2536 | test/agents-limit-hit.test.ts:96 | agents | keep |
| test/agents.test.ts | boundary | integration-ci | TASK-1021, TASK-2294.01, TASK-2328, TASK-2582, task-088, task-095, task-1010, task-1025, task-1051, task-1117, task-1123, task-1214, task-1246, task-1256, task-1302, task-2222, task-2294, task-2322, task-2322.09, task-2390, task-2431, task-2489, task-2536 | test/agents.test.ts:44 | agents | keep |
| test/application-boundaries.test.ts | boundary | integration-ci |  | test/application-boundaries.test.ts:35 | domain | keep |
| test/application-contracts.test.ts | boundary | unit |  | test/application-contracts.test.ts:16 | domain | keep |
| test/application-services.test.ts | boundary | unit | TASK-2328, task-1 | test/application-services.test.ts:23 | metrics | keep |
| test/attention-orphaned-active-observable.test.ts | boundary | unit |  | test/attention-orphaned-active-observable.test.ts:96 | recovery, cli-config | keep |
| test/backlog-mission-materialization.test.ts | boundary | unit | task-2294 | test/backlog-mission-materialization.test.ts:18 | lifecycle | keep |
| test/backlog.test.ts | boundary | integration-ci | TASK-000, TASK-091, TASK-1048, TASK-1049, TASK-112, TASK-114, TASK-115, TASK-116, TASK-119, TASK-120, TASK-121.01, TASK-122, TASK-122.01, TASK-123, TASK-124, TASK-126, TASK-127, TASK-128, TASK-129, TASK-130, TASK-131, TASK-132, TASK-133, TASK-134, TASK-17, TASK-198, TASK-199, TASK-2104, TASK-2230, TASK-2231, TASK-2232, TASK-2233, TASK-2234, TASK-2235, TASK-2328, TASK-999, task-081, task-098, task-113, task-117, task-118, task-121, task-125 | test/backlog.test.ts:91 | agents | keep |
| test/backlog_gate.test.ts | boundary | unit |  | test/backlog_gate.test.ts:27 | verification | keep |
| test/backlog_reorder_completed_duplicate.test.ts | boundary | unit | TASK-1323, TASK-1343, TASK-1400, TASK-1500, TASK-1501 | test/backlog_reorder_completed_duplicate.test.ts:46 | integration | keep |
| test/board-controller.test.ts | boundary | unit | TASK-2322.05, task-0001 | test/board-controller.test.ts:41 | presentation | keep |
| test/board-event-guardrail.test.ts | behavior | unit | TASK-2347.02 | test/board-event-guardrail.test.ts:122 | metrics, presentation | keep |
| test/board-event-metrics-fixture.test.ts | boundary | integration-ci | task-0001 | test/board-event-metrics-fixture.test.ts:104 | metrics, presentation | keep |
| test/board-event-recorder.test.ts | boundary | integration-ci | TASK-2357, task-1 | test/board-event-recorder.test.ts:78 | metrics, presentation | keep |
| test/board-lane-events-migration.test.ts | boundary | integration-ci | task-1 | test/board-lane-events-migration.test.ts:66 | persistence, metrics, presentation | keep |
| test/board-metrics.test.ts | boundary | unit | TASK-2459, task-0001, task-0002, task-0003 | test/board-metrics.test.ts:43 | metrics, presentation | keep |
| test/board-no-bypass.test.ts | behavior | unit |  | test/board-no-bypass.test.ts:86 | presentation | keep |
| test/board-progress-events.test.ts | boundary | unit | TASK-2375, task-0001 | test/board-progress-events.test.ts:35 | presentation | keep |
| test/board-projections.test.ts | boundary | unit | task-0001, task-0002, task-0003, task-0004, task-0005, task-0006 | test/board-projections.test.ts:76 | presentation | keep |
| test/board-readers.test.ts | boundary | unit | TASK-2328, task-0001, task-0002, task-0003, task-0005, task-2401 | test/board-readers.test.ts:91 | presentation | keep |
| test/board-readers.worktree-amplification.test.ts | boundary | unit |  | test/board-readers.worktree-amplification.test.ts:89 | integration, presentation | keep |
| test/bootstrap-isolation.test.ts | behavior | integration-ci |  | test/bootstrap-isolation.test.ts:11 | verification | keep |
| test/bubblewrap-guard.test.ts | boundary | unit | task-2383 | test/bubblewrap-guard.test.ts:46 | agents | keep |
| test/bubblewrap-worktree-git.test.ts | boundary | integration-local | TASK-2391 | test/bubblewrap-worktree-git.test.ts:29 | agents, integration | keep |
| test/checkpoint-document.test.ts | boundary | unit | task-2525.04 | test/checkpoint-document.test.ts:25 | lifecycle | keep |
| test/claude.test.ts | boundary | unit | TASK-2328, task-1318, task-1322, task-2380, task-2525.05 | test/claude.test.ts:21 | agents | keep |
| test/cli-command-use-cases.test.ts | boundary | unit | task-2332.07 | test/cli-command-use-cases.test.ts:11 | lifecycle | keep |
| test/cli-format.test.ts | boundary | unit |  | test/cli-format.test.ts:21 | presentation | keep |
| test/cli-interface-migration.test.ts | boundary | unit | task-2332.15 | test/cli-interface-migration.test.ts:27 | persistence | keep |
| test/codex-mcp-worktree-repro.test.ts | regression | unit | task-2209 | test/codex-mcp-worktree-repro.test.ts:51 | agents, integration | keep |
| test/codex-telemetry.test.ts | boundary | unit | task-1251 | test/codex-telemetry.test.ts:53 | agents | keep |
| test/codex.test.ts | boundary | unit | TASK-2328, task-1322 | test/codex.test.ts:31 | agents | keep |
| test/command-dispatch-convergence.test.ts | boundary | unit | TASK-2332.05 | test/command-dispatch-convergence.test.ts:33 | domain | keep |
| test/config-command.test.ts | boundary | unit | task-2500.01 | test/config-command.test.ts:39 | cli-config | keep |
| test/config-contract-deferral.test.ts | boundary | unit | task-1233 | test/config-contract-deferral.test.ts:31 | cli-config | keep |
| test/confinement-launch.test.ts | boundary | unit | task-2513 | test/confinement-launch.test.ts:54 | agents | keep |
| test/confinement.test.ts | boundary | unit |  | test/confinement.test.ts:12 | agents | keep |
| test/coverage-gate.test.ts | boundary | unit | TASK-2547, TASK-2591, task-1209 | test/coverage-gate.test.ts:15 | verification | keep |
| test/current-work-publication.test.ts | boundary | unit | TASK-2370, TASK-2373 | test/current-work-publication.test.ts:117 | recovery | keep |
| test/current-work-reconciliation.test.ts | boundary | unit | task-2370 | test/current-work-reconciliation.test.ts:20 | recovery | keep |
| test/custom-capacity-cross-repo.integration.test.ts | boundary | integration-ci |  | test/custom-capacity-cross-repo.integration.test.ts:27 | agents | keep |
| test/custom-capacity-cross-repo.test.ts | boundary | unit |  | test/custom-capacity-cross-repo.test.ts:17 | agents | keep |
| test/custom-capacity-detached-child.test.ts | boundary | unit |  | test/custom-capacity-detached-child.test.ts:7 | agents | keep |
| test/custom-capacity-multiprocess-repro.test.ts | regression | integration-ci |  | test/custom-capacity-multiprocess-repro.test.ts:50 | agents | keep |
| test/default-test-suite.test.ts | behavior | unit | TASK-2328 | test/default-test-suite.test.ts:38 | verification | keep |
| test/dependency-graph.test.ts | boundary | unit | TASK-2332, TASK-2332.03, TASK-2332.06, TASK-2512, TASK-9999.01 | test/dependency-graph.test.ts:59 | domain | keep |
| test/diff.test.ts | boundary | unit | TASK-2328, task-1147 | test/diff.test.ts:47 | integration | keep |
| test/documentation-verification.test.ts | behavior | integration-ci |  | test/documentation-verification.test.ts:31 | verification | keep |
| test/domain-agent-selection.test.ts | boundary | unit |  | test/domain-agent-selection.test.ts:28 | agents, domain | keep |
| test/domain-attempt-guard.test.ts | boundary | unit | TASK-2322.02 | test/domain-attempt-guard.test.ts:125 | domain | keep |
| test/domain-authority.test.ts | boundary | unit | TASK-2294 | test/domain-authority.test.ts:19 | domain | keep |
| test/domain-consumer-requirements.test.ts | boundary | unit | TASK-2322.02 | test/domain-consumer-requirements.test.ts:56 | domain | keep |
| test/domain-import-boundary.test.ts | behavior | unit |  | test/domain-import-boundary.test.ts:55 | domain | keep |
| test/domain-mission.test.ts | boundary | unit | task-2294, task-2322, task-2322.09 | test/domain-mission.test.ts:32 | domain | keep |
| test/domain-outcomes.test.ts | boundary | unit | task-2294, task-2347.09 | test/domain-outcomes.test.ts:91 | domain | keep |
| test/domain-projections.test.ts | boundary | unit | TASK-2518, task-2294 | test/domain-projections.test.ts:81 | domain | keep |
| test/domain-review-workflow-state.test.ts | boundary | unit | TASK-2377.04, task-2322.12, task-2521.03 | test/domain-review-workflow-state.test.ts:50 | review | keep |
| test/draft-command-use-case.test.ts | boundary | unit | TASK-2332.10, task-1234.56 | test/draft-command-use-case.test.ts:123 | lifecycle | keep |
| test/draft-command.test.ts | boundary | integration-ci | TASK-1038, TASK-1352, TASK-2328, TASK-2471, TASK-2472, task-2468 | test/draft-command.test.ts:49 | lifecycle | keep |
| test/draft-extraction.test.ts | boundary | unit |  | test/draft-extraction.test.ts:19 | lifecycle | keep |
| test/draft.test.ts | boundary | integration-ci | TASK-2322.07, TASK-2328, TASK-2445, TASK-2471, TASK-2521.03, TASK-2521.04, TASK-2561, task-086, task-1207, task-1218, task-123, task-2389, task-2396, task-2496, task-8, task-999 | test/draft.test.ts:83 | lifecycle | keep |
| test/draft_preflight_modern.test.ts | boundary | integration-ci | TASK-093, TASK-099, TASK-2328, task-999 | test/draft_preflight_modern.test.ts:38 | lifecycle | keep |
| test/durable-state-policy.test.ts | behavior | integration-ci |  | test/durable-state-policy.test.ts:65 | persistence | keep |
| test/e2e-mission-lifecycle.test.ts | boundary | agent-e2e | TASK-2212, TASK-2322.12, TASK-2521.03, TASK-2595, task-2001, task-2002, task-2468, task-2510 | test/e2e-mission-lifecycle.test.ts:552 | distribution | keep |
| test/e2e-mission-sqlite-cutover.test.ts | boundary | integration-ci | TASK-2322.07 | test/e2e-mission-sqlite-cutover.test.ts:135 | persistence | keep |
| test/e2e-real-agent-smoke.test.ts | boundary | agent-e2e | TASK-1273, TASK-1351, TASK-2288, TASK-2322.08, TASK-2322.12, TASK-2328, TASK-2471, TASK-2521.03, TASK-2561, task-1359, task-2241, task-2553, task-9001, task-9002, task-9003 | test/e2e-real-agent-smoke.test.ts:257 | distribution, agents | keep |
| test/esm-only-guard.test.ts | boundary | unit |  | test/esm-only-guard.test.ts:12 | distribution | keep |
| test/execute-mission-adapters.test.ts | boundary | unit | TASK-2328, TASK-2373, task-1 | test/execute-mission-adapters.test.ts:38 | lifecycle | keep |
| test/execute-mission-characterization.test.ts | boundary | unit | TASK-2328, TASK-2332.04, task-1, task-2 | test/execute-mission-characterization.test.ts:104 | lifecycle | keep |
| test/execute-mission-service.test.ts | boundary | unit | task-1, task-2 | test/execute-mission-service.test.ts:76 | lifecycle | keep |
| test/external-target-resolution.test.ts | boundary | integration-ci | TASK-2328 | test/external-target-resolution.test.ts:71 | cli-config | keep |
| test/file-size-cap.test.ts | behavior | unit | TASK-2596, task-2489 | test/file-size-cap.test.ts:174 | verification | keep |
| test/first-run-config-autodetect.test.ts | boundary | unit |  | test/first-run-config-autodetect.test.ts:56 | cli-config | keep |
| test/fmt-enforcement.test.ts | behavior | unit |  | test/fmt-enforcement.test.ts:47 | cli-config | keep |
| test/fmt.test.ts | boundary | unit | TASK-2328 | test/fmt.test.ts:27 | presentation | keep |
| test/forgejo-api.test.ts | boundary | unit | TASK-2328 | test/forgejo-api.test.ts:84 | agents | keep |
| test/forgejo-identity-regression.test.ts | boundary | unit | task-1121, task-1122, task-1126, task-1127, task-1128, task-1129, task-9999 | test/forgejo-identity-regression.test.ts:47 | review | keep |
| test/forgejo-independence.test.ts | boundary | integration-ci | TASK-2328, TASK-2332.09, TASK-2512, task-1148 | test/forgejo-independence.test.ts:63 | review | keep |
| test/forgejo-lookup.test.ts | boundary | unit | TASK-2561, task-101, task-102 | test/forgejo-lookup.test.ts:25 | review | keep |
| test/forgejo-pr-round-sync.test.ts | boundary | integration-ci | task-2239, task-2240 | test/forgejo-pr-round-sync.test.ts:95 | review | keep |
| test/forgejo.test.ts | boundary | integration-ci | TASK-1100, TASK-204, TASK-205, TASK-2328, TASK-2379, TASK-999, task-001, task-081, task-097, task-098, task-099, task-100, task-101, task-104, task-1062, task-1089, task-1095, task-1107, task-111, task-1130, task-1134, task-121, task-1255, task-1317, task-200, task-201, task-202, task-203, task-2208, task-2520, task-2545, task-300 | test/forgejo.test.ts:103 | review | keep |
| test/gate-validation-refactor.test.ts | boundary | unit |  | test/gate-validation-refactor.test.ts:23 | verification | keep |
| test/gatekeeper-injection.test.ts | boundary | unit | task-1 | test/gatekeeper-injection.test.ts:13 | verification | keep |
| test/gatekeeper.test.ts | boundary | unit |  | test/gatekeeper.test.ts:39 | verification | keep |
| test/git-pure.test.ts | boundary | unit | TASK-2535 | test/git-pure.test.ts:22 | integration | keep |
| test/git.test.ts | boundary | unit | TASK-2328, task-1031, task-1322, task-1328 | test/git.test.ts:34 | integration | keep |
| test/git_hardening.test.ts | boundary | unit | TASK-2328 | test/git_hardening.test.ts:26 | integration | keep |
| test/github-pr-integration.test.ts | boundary | unit | task-2500.03 | test/github-pr-integration.test.ts:13 | review | keep |
| test/github-pr-observe-pure.test.ts | boundary | unit |  | test/github-pr-observe-pure.test.ts:22 | review | keep |
| test/github-pr.test.ts | boundary | unit |  | test/github-pr.test.ts:17 | review | keep |
| test/github-publish.test.ts | boundary | unit |  | test/github-publish.test.ts:308 | distribution | keep |
| test/gitignore.test.ts | boundary | unit | TASK-2328 | test/gitignore.test.ts:45 | integration | keep |
| test/handoff-use-case.test.ts | boundary | unit | TASK-2332.09, TASK-2379, TASK-2476, TASK-2521.03, task-2332 | test/handoff-use-case.test.ts:24 | lifecycle | keep |
| test/handoff.test.ts | boundary | integration-ci | TASK-2322.05, TASK-2322.07, TASK-2322.12, TASK-2328, TASK-2377.05, TASK-2521.03, task-098, task-1213, task-1228, task-1387, task-1388, task-2386 | test/handoff.test.ts:41 | lifecycle | keep |
| test/index.test.ts | boundary | unit | TASK-2277, TASK-2482, TASK-2490, TASK-2521.03, task-1038, task-1076, task-2582 | test/index.test.ts:27 | cli-config | keep |
| test/install.test.ts | behavior | integration-ci | task-1302 | test/install.test.ts:41 | distribution | keep |
| test/integrate-conflict.test.ts | boundary | integration-ci | TASK-2535, task-1 | test/integrate-conflict.test.ts:16 | integration | keep |
| test/integrate-exclusive-claim.test.ts | boundary | unit |  | test/integrate-exclusive-claim.test.ts:43 | integration | keep |
| test/integrate-exclusive-process.integration.test.ts | boundary | integration-ci |  | test/integrate-exclusive-process.integration.test.ts:63 | integration | keep |
| test/integrate-guard.test.ts | boundary | unit | task-1086 | test/integrate-guard.test.ts:70 | integration | keep |
| test/integrate-task-1410-stash-pop-corruption.test.ts | boundary | integration-ci | TASK-1410, task-1399, task-1403, task-1404 | test/integrate-task-1410-stash-pop-corruption.test.ts:186 | integration | keep |
| test/integrate-workflow-gate.test.ts | behavior | integration-ci |  | test/integrate-workflow-gate.test.ts:42 | integration, verification | keep |
| test/integrate.test.ts | boundary | integration-ci | TASK-2199, TASK-2230, TASK-2322.07, TASK-2322.08, TASK-2328, TASK-2379, TASK-2479, TASK-2595, task-082, task-097, task-098, task-099, task-103, task-1054, task-1062, task-113, task-118, task-1253, task-1322, task-1327, task-1402, task-1415, task-2000, task-2046, task-2200, task-2229, task-2244, task-2269, task-2300, task-2322, task-2376, task-2397, task-2460, task-2510, task-3000, task-4000 | test/integrate.test.ts:166 | integration | keep |
| test/integration-dispatch.test.ts | boundary | unit | task-2500.01 | test/integration-dispatch.test.ts:30 | integration | keep |
| test/integration-mode-cli.test.ts | boundary | unit | task-2500.01 | test/integration-mode-cli.test.ts:69 | integration | keep |
| test/integration-mode-config.test.ts | boundary | unit | task-2500.01 | test/integration-mode-config.test.ts:40 | cli-config, integration | keep |
| test/integration-pipelines.test.ts | boundary | integration-ci | TASK-2328, task-123, task-1233, task-1302, task-1362, task-1397, task-1419, task-2269, task-2292 | test/integration-pipelines.test.ts:67 | integration | keep |
| test/integration-recorded-contract.test.ts | boundary | unit | task-2543 | test/integration-recorded-contract.test.ts:43 | integration | keep |
| test/launcher-availability.test.ts | boundary | unit |  | test/launcher-availability.test.ts:25 | agents | keep |
| test/lifecycle-timing.test.ts | boundary | unit | TASK-2582, task-1 | test/lifecycle-timing.test.ts:16 | metrics | keep |
| test/limit-hit.test.ts | boundary | unit | TASK-2328 | test/limit-hit.test.ts:11 | agents | keep |
| test/measurement-store-cutover.test.ts | boundary | unit | TASK-2322.08, TASK-2577, task-9001 | test/measurement-store-cutover.test.ts:75 | persistence | keep |
| test/metric-contract.test.ts | behavior | unit |  | test/metric-contract.test.ts:23 | metrics | keep |
| test/mission-activity.test.ts | boundary | unit | task-1, task-2389, task-2399 | test/mission-activity.test.ts:57 | recovery | keep |
| test/mission-integration-service.test.ts | boundary | unit | TASK-2347.02, task-2322 | test/mission-integration-service.test.ts:58 | integration | keep |
| test/mission-persistence-authority-guard.test.ts | behavior | unit | TASK-2521.01 | test/mission-persistence-authority-guard.test.ts:139 | persistence | keep |
| test/mission-phase-stats.test.ts | boundary | unit | TASK-2328, task-1248, task-1285, task-1318, task-1342, task-9999 | test/mission-phase-stats.test.ts:33 | metrics | keep |
| test/mission-start-removal.test.ts | boundary | unit | task-2495 | test/mission-start-removal.test.ts:10 | lifecycle | keep |
| test/mission-utils-graphify.test.ts | boundary | unit | TASK-2328, task-2297 | test/mission-utils-graphify.test.ts:20 | distribution | keep |
| test/mission-utils-merge-noise.test.ts | boundary | unit | TASK-132, task-101, task-1010, task-1202, task-133 | test/mission-utils-merge-noise.test.ts:19 | integration | keep |
| test/mission-utils-paths.test.ts | boundary | unit | TASK-081, TASK-099, TASK-2328, task-118, task-119, task-120, task-1209, task-1297, task-130, task-132 | test/mission-utils-paths.test.ts:58 | integration | keep |
| test/mission-utils-worktree.test.ts | boundary | integration-ci | TASK-2328, task-1, task-130, task-131, task-132, task-200, task-201, task-202, task-203, task-204, task-205, task-206 | test/mission-utils-worktree.test.ts:53 | integration | keep |
| test/mistral.test.ts | boundary | integration-ci | TASK-2328 | test/mistral.test.ts:55 | agents | keep |
| test/nels.test.ts | boundary | integration-ci | task-001, task-1355 | test/nels.test.ts:14 | agents | keep |
| test/no-command-tty.test.ts | boundary | unit |  | test/no-command-tty.test.ts:35 | cli-config | keep |
| test/noise-reduction.test.ts | boundary | integration-ci | TASK-2328, task-1, task-2 | test/noise-reduction.test.ts:23 | integration | keep |
| test/opencode-export.test.ts | boundary | integration-ci | TASK-2328, task-1345 | test/opencode-export.test.ts:33 | agents | keep |
| test/opencode-launcher-telemetry.test.ts | boundary | unit | TASK-2328, task-1316, task-1339 | test/opencode-launcher-telemetry.test.ts:47 | agents | keep |
| test/opencode-retry.test.ts | boundary | unit |  | test/opencode-retry.test.ts:35 | agents, recovery | keep |
| test/opencode-telemetry.test.ts | boundary | unit |  | test/opencode-telemetry.test.ts:25 | agents | keep |
| test/opencode.test.ts | boundary | unit | TASK-2328, task-1322, task-1339 | test/opencode.test.ts:33 | agents | keep |
| test/operator-state-lifecycle.test.ts | boundary | unit |  | test/operator-state-lifecycle.test.ts:15 | persistence | keep |
| test/operator-state-scope.integration.test.ts | boundary | integration-ci |  | test/operator-state-scope.integration.test.ts:19 | persistence | keep |
| test/package-persistent-data.test.ts | behavior | integration-ci | TASK-2285, TASK-2322.08, TASK-2328 | test/package-persistent-data.test.ts:50 | persistence, distribution | keep |
| test/persistence-characterization.test.ts | boundary | unit | task-0001, task-0002, task-9999 | test/persistence-characterization.test.ts:123 | persistence | keep |
| test/persistence-domain-mapping.test.ts | boundary | unit | TASK-2322.02 | test/persistence-domain-mapping.test.ts:66 | persistence | keep |
| test/persistence-inventory-guardrail.test.ts | behavior | unit | TASK-2322.01, TASK-2322.08, TASK-2322.12, TASK-2373, TASK-2431, TASK-2465, TASK-2483 | test/persistence-inventory-guardrail.test.ts:141 | persistence | keep |
| test/persistent-data-migration.test.ts | boundary | unit | TASK-2322.08, TASK-2328 | test/persistent-data-migration.test.ts:25 | persistence | keep |
| test/pi-runner.test.ts | boundary | unit | task-2208, task-2311, task-2337 | test/pi-runner.test.ts:35 | agents | keep |
| test/post-integrate-hook.test.ts | regression | unit | task-1402, task-2510 | test/post-integrate-hook.test.ts:22 | integration | keep |
| test/product-config-cp.test.ts | boundary | integration-ci | TASK-2535, task-1 | test/product-config-cp.test.ts:29 | cli-config | keep |
| test/product-config-validation.test.ts | boundary | integration-ci |  | test/product-config-validation.test.ts:47 | cli-config | keep |
| test/product-config.test.ts | boundary | integration-ci | TASK-2328, task-2337, task-2455.03 | test/product-config.test.ts:34 | cli-config | keep |
| test/production-composition-capabilities.test.ts | boundary | unit |  | test/production-composition-capabilities.test.ts:21 | domain | keep |
| test/prompt-split.test.ts | boundary | unit | TASK-2465, TASK-2521.03, task-2602 | test/prompt-split.test.ts:38 | distribution | keep |
| test/px-entry.test.ts | behavior | unit |  | test/px-entry.test.ts:13 | cli-config | keep |
| test/px-runner.test.ts | behavior | integration-ci | TASK-2521.03 | test/px-runner.test.ts:33 | distribution | keep |
| test/px-runtime-smoke.test.ts | behavior | integration-ci |  | test/px-runtime-smoke.test.ts:29 | cli-config | keep |
| test/px-shell-init.test.ts | boundary | integration-ci | task-1, task-1381, task-1390 | test/px-shell-init.test.ts:59 | cli-config | keep |
| test/qwen-launcher.test.ts | boundary | unit | TASK-1398 | test/qwen-launcher.test.ts:24 | agents | keep |
| test/qwen-limit-detection.test.ts | boundary | unit |  | test/qwen-limit-detection.test.ts:8 | agents | keep |
| test/qwen-telemetry.test.ts | boundary | unit |  | test/qwen-telemetry.test.ts:39 | agents | keep |
| test/rebase-use-case.test.ts | boundary | integration-ci | TASK-2377.05, task-2332, task-2332.12, task-2494 | test/rebase-use-case.test.ts:109 | integration | keep |
| test/rebase.test.ts | boundary | integration-ci | TASK-2328, task-1015, task-1018, task-1033, task-1035, task-1057, task-1322, task-1350, task-2323 | test/rebase.test.ts:42 | integration | keep |
| test/rebase_diagnostics.test.ts | boundary | integration-ci | task-1077, task-1322 | test/rebase_diagnostics.test.ts:75 | integration | keep |
| test/rebase_hardening.test.ts | boundary | integration-ci | task-1077 | test/rebase_hardening.test.ts:32 | integration | keep |
| test/recover-command.test.ts | boundary | unit | task-1 | test/recover-command.test.ts:10 | recovery | keep |
| test/redgreen.test.ts | boundary | unit | task-1, task-123, task-9 | test/redgreen.test.ts:10 | verification | keep |
| test/refresh-global-px-script.test.ts | boundary | integration-ci | task-1424 | test/refresh-global-px-script.test.ts:24 | integration | keep |
| test/repair-handoff.test.ts | boundary | unit | TASK-2328, task-1037, task-1121, task-1124, task-2213, task-2215, task-2233, task-2497, task-9001 | test/repair-handoff.test.ts:45 | lifecycle | keep |
| test/repository-gates.integration.test.ts | boundary | integration-ci | task-2558, task-2586 | test/repository-gates.integration.test.ts:23 | verification | keep |
| test/repository-gates.test.ts | boundary | integration-ci | TASK-2457, TASK-2519, task-1, task-2558, task-9 | test/repository-gates.test.ts:39 | verification | keep |
| test/resolve-conflict.test.ts | boundary | integration-ci | TASK-2294.01, TASK-2328, TASK-2385, task-097, task-108, task-2386 | test/resolve-conflict.test.ts:43 | integration | keep |
| test/retired-workflow-path-write-guard.test.ts | behavior | unit | TASK-2521.01 | test/retired-workflow-path-write-guard.test.ts:192 | persistence | keep |
| test/review-adapter-noop.test.ts | boundary | unit | task-1 | test/review-adapter-noop.test.ts:40 | review | keep |
| test/review-artifact-dispatcher.test.ts | boundary | unit | TASK-2274, TASK-2377.04 | test/review-artifact-dispatcher.test.ts:46 | review | keep |
| test/review-artifacts.test.ts | boundary | integration-ci | TASK-2322.12, TASK-2328, TASK-2521.03, task-1255, task-1264, task-1271, task-9001 | test/review-artifacts.test.ts:36 | review | keep |
| test/review-autoderive.test.ts | boundary | integration-ci | TASK-2328, TASK-999 | test/review-autoderive.test.ts:100 | review | keep |
| test/review-backfill.test.ts | boundary | integration-ci | TASK-2322.12 | test/review-backfill.test.ts:46 | review | keep |
| test/review-commands-additional.test.ts | boundary | integration-ci | TASK-2328 | test/review-commands-additional.test.ts:24 | review | keep |
| test/review-commands-supplemental.test.ts | boundary | integration-ci | TASK-2328, TASK-2457, task-1223, task-1255 | test/review-commands-supplemental.test.ts:16 | review | keep |
| test/review-commands.test.ts | boundary | unit | TASK-2328, task-1, task-1259, task-1311, task-2322, task-2436, task-2490 | test/review-commands.test.ts:31 | review | keep |
| test/review-events.test.ts | boundary | integration-ci | TASK-2322.12, TASK-2328, TASK-2521.03 | test/review-events.test.ts:72 | review | keep |
| test/review-identity-placeholder.test.ts | boundary | integration-ci | TASK-2521.03, task-1051 | test/review-identity-placeholder.test.ts:22 | review | keep |
| test/review-identity.test.ts | boundary | integration-ci | TASK-2328 | test/review-identity.test.ts:69 | review | keep |
| test/review-prompts.test.ts | boundary | integration-ci | TASK-2521.03, task-001, task-089, task-121, task-1264, task-1325, task-1407, task-1430, task-2337, task-2362, task-2483, task-9001 | test/review-prompts.test.ts:26 | review | keep |
| test/review-round-loop.test.ts | boundary | unit | TASK-2478, task-2378 | test/review-round-loop.test.ts:162 | review | keep |
| test/review-state-class.test.ts | boundary | integration-ci | TASK-2328, TASK-2377.04, task-1, task-1305 | test/review-state-class.test.ts:24 | review | keep |
| test/review-state.test.ts | boundary | integration-ci | TASK-2377.04 | test/review-state.test.ts:15 | review | keep |
| test/review-static-evidence.test.ts | boundary | unit | TASK-2328, TASK-2437.01, task-1234 | test/review-static-evidence.test.ts:30 | review | keep |
| test/review-stats.test.ts | boundary | unit | TASK-2328, task-2213 | test/review-stats.test.ts:60 | metrics, review | keep |
| test/review-verdict.test.ts | boundary | unit |  | test/review-verdict.test.ts:8 | review | keep |
| test/review.test.ts | boundary | integration-ci | TASK-1041, TASK-2198, TASK-2328, TASK-2377.02, TASK-2377.04, TASK-2490, task-089, task-1016, task-1028, task-1031, task-1069, task-1087, task-1105, task-1136, task-1223, task-1303, task-1327, task-2197 | test/review.test.ts:220 | review | keep |
| test/running-sessions.test.ts | boundary | unit | task-2217, task-2328, task-2340 | test/running-sessions.test.ts:61 | agents, recovery | keep |
| test/runtime-benchmark.test.ts | boundary | unit |  | test/runtime-benchmark.test.ts:13 | distribution | keep |
| test/runtime-matrix.test.ts | boundary | integration-ci | TASK-2328 | test/runtime-matrix.test.ts:79 | agents | keep |
| test/session-marker-repository.test.ts | boundary | integration-ci | TASK-2322.09, task-0001, task-0002 | test/session-marker-repository.test.ts:88 | persistence, agents | keep |
| test/setup-review.test.ts | boundary | integration-ci | TASK-2328 | test/setup-review.test.ts:67 | review | keep |
| test/sonarqube-cloud-wiring.test.ts | boundary | integration-ci | TASK-2546, TASK-2547, task-2560 | test/sonarqube-cloud-wiring.test.ts:47 | verification | keep |
| test/sonarqube-reliability-repairs.test.ts | boundary | unit | task-1 | test/sonarqube-reliability-repairs.test.ts:22 | verification | keep |
| test/sonarqube-s2871-sorts.test.ts | boundary | unit |  | test/sonarqube-s2871-sorts.test.ts:38 | verification | keep |
| test/spawn-tee.test.ts | boundary | unit | TASK-2328, task-2386 | test/spawn-tee.test.ts:88 | agents | keep |
| test/sqlite-adapter-cp1.test.ts | boundary | integration-ci | task-2521 | test/sqlite-adapter-cp1.test.ts:52 | persistence | keep |
| test/sqlite-async-cascade-cp3.test.ts | boundary | integration-ci |  | test/sqlite-async-cascade-cp3.test.ts:65 | persistence | keep |
| test/sqlite-importer-cp4.test.ts | boundary | integration-ci | task-2294, task-2295 | test/sqlite-importer-cp4.test.ts:65 | persistence | keep |
| test/sqlite-mission-store.integration.test.ts | boundary | integration-ci | TASK-2322.07, task-2294, task-2521.01, task-2521.03 | test/sqlite-mission-store.integration.test.ts:207 | persistence | keep |
| test/sqlite-ports-cp2.test.ts | boundary | integration-ci | task-2294 | test/sqlite-ports-cp2.test.ts:89 | persistence | keep |
| test/sqlite-recovery-cp5.test.ts | boundary | integration-ci | task-2294, task-2295 | test/sqlite-recovery-cp5.test.ts:64 | persistence, recovery | keep |
| test/stale-push.test.ts | regression | unit |  | test/stale-push.test.ts:18 | integration | keep |
| test/startup-preflight.test.ts | boundary | integration-ci | TASK-2200, TASK-2328, task-2604 | test/startup-preflight.test.ts:42 | metrics | keep |
| test/state-map.test.ts | boundary | unit |  | test/state-map.test.ts:23 | domain | keep |
| test/statistics-service.test.ts | boundary | unit | Task-1, task-2, task-3 | test/statistics-service.test.ts:21 | metrics | keep |
| test/stats-active-breakdown.test.ts | boundary | unit | TASK-2328, task-1001, task-1002, task-1003, task-1354, task-1355, task-1409, task-2213 | test/stats-active-breakdown.test.ts:92 | metrics, cli-config | keep |
| test/stats-backfill-branches.test.ts | boundary | unit | TASK-2535, task-1, task-2, task-3 | test/stats-backfill-branches.test.ts:34 | metrics | keep |
| test/stats-backfill-helpers.test.ts | boundary | unit |  | test/stats-backfill-helpers.test.ts:6 | metrics, cli-config | keep |
| test/stats-backfill-pure.test.ts | boundary | unit | TASK-2535 | test/stats-backfill-pure.test.ts:10 | metrics | keep |
| test/stats-backfill.test.ts | boundary | integration-ci | TASK-2000, TASK-2001, TASK-2002, TASK-2003, TASK-2007, TASK-2008, TASK-2009, TASK-2328, TASK-2376, task-2006 | test/stats-backfill.test.ts:160 | metrics | keep |
| test/stats-command-routing.test.ts | boundary | unit | TASK-2328, task-1285 | test/stats-command-routing.test.ts:19 | metrics | keep |
| test/stats-command-use-case.test.ts | boundary | unit | task-1, task-2 | test/stats-command-use-case.test.ts:21 | metrics | keep |
| test/stats-csv-authority-guard.test.ts | boundary | unit | TASK-2322.08, TASK-2328 | test/stats-csv-authority-guard.test.ts:61 | metrics | keep |
| test/stats-normalization.test.ts | boundary | unit |  | test/stats-normalization.test.ts:30 | metrics | keep |
| test/stats-report-rendering-pure.test.ts | boundary | unit | TASK-2535, task-1, task-2, task-3 | test/stats-report-rendering-pure.test.ts:36 | metrics, presentation | keep |
| test/stats-report.test.ts | boundary | unit |  | test/stats-report.test.ts:29 | metrics | keep |
| test/stats.test.ts | boundary | integration-ci | TASK-2000, TASK-2322.08, TASK-2322.12, TASK-2328, TASK-2363, TASK-2378, task-0999, task-1000, task-1001, task-1002, task-1003, task-1054, task-1246, task-1251, task-1301, task-1314, task-1318, task-1339, task-1342, task-1414, task-2001, task-2002, task-2213, task-2362, task-3000, task-3001, task-3002, task-3003, task-3004, task-3005, task-3010 | test/stats.test.ts:83 | metrics | keep |
| test/status-command-use-case.test.ts | boundary | unit | task-1001, task-1234, task-2332.13 | test/status-command-use-case.test.ts:17 | cli-config | keep |
| test/status.test.ts | boundary | unit | TASK-2322.07, TASK-2328, task-001, task-1031, task-1322 | test/status.test.ts:20 | cli-config | keep |
| test/storage.test.ts | boundary | unit | TASK-2322.08, TASK-2328 | test/storage.test.ts:20 | persistence | keep |
| test/sync-merged-retry.test.ts | boundary | unit | task-1065, task-2520 | test/sync-merged-retry.test.ts:64 | integration, recovery | keep |
| test/task-1036-review-fallback.test.ts | boundary | unit | TASK-1036, TASK-2328, task-2513 | test/task-1036-review-fallback.test.ts:54 | review | keep |
| test/task-1039-handoff.test.ts | boundary | unit |  | test/task-1039-handoff.test.ts:75 | lifecycle | keep |
| test/task-1039-integrate-v3.test.ts | boundary | unit | TASK-2328 | test/task-1039-integrate-v3.test.ts:50 | integration | keep |
| test/task-1039-integrate.test.ts | boundary | unit | TASK-2328, TASK-2457 | test/task-1039-integrate.test.ts:126 | integration | keep |
| test/task-1048-regression.test.ts | boundary | integration-ci | TASK-1048, TASK-2328 | test/task-1048-regression.test.ts:66 | review | keep |
| test/task-1049-force-push.test.ts | boundary | integration-ci | TASK-2328, task-1049, task-1089, task-1335 | test/task-1049-force-push.test.ts:103 | integration | keep |
| test/task-1079-review-blocked-fallback.test.ts | boundary | unit | TASK-1079, TASK-2328, task-2477 | test/task-1079-review-blocked-fallback.test.ts:49 | review | keep |
| test/task-1080-sync-merged-hardening.test.ts | boundary | integration-ci | task-1080, task-2520 | test/task-1080-sync-merged-hardening.test.ts:62 | integration | keep |
| test/task-1104-call-order.test.ts | boundary | unit | TASK-2328, task-1104 | test/task-1104-call-order.test.ts:116 | review | keep |
| test/task-1104-rebase-cleanup.test.ts | boundary | integration-ci | TASK-1104, TASK-2377.02 | test/task-1104-rebase-cleanup.test.ts:66 | integration | keep |
| test/task-1107-repro.test.ts | regression | unit | TASK-2328, TASK-2377.02, task-1, task-1107, task-9999 | test/task-1107-repro.test.ts:39 | review | keep |
| test/task-1109.test.ts | boundary | integration-ci | TASK-2322.12, TASK-2328, TASK-2479, task-1109 | test/task-1109.test.ts:178 | integration | keep |
| test/task-1124-integrate.test.ts | boundary | unit | TASK-2328, TASK-2377.05, task-1121, task-1124 | test/task-1124-integrate.test.ts:20 | integration | keep |
| test/task-1135-coverage.test.ts | boundary | unit | TASK-2322.08, TASK-2328, task-1135 | test/task-1135-coverage.test.ts:42 | verification | keep |
| test/task-1135-review-fallback.test.ts | boundary | unit | TASK-2328 | test/task-1135-review-fallback.test.ts:84 | review | keep |
| test/task-1209-artifact-dir.test.ts | boundary | unit | task-1209, task-999 | test/task-1209-artifact-dir.test.ts:32 | review | keep |
| test/task-1209-review-loop.test.ts | boundary | unit | TASK-2328, task-1209, task-999 | test/task-1209-review-loop.test.ts:62 | review | keep |
| test/task-1219-fallback.test.ts | boundary | unit | TASK-2379, TASK-2479, task-1219 | test/task-1219-fallback.test.ts:58 | integration | keep |
| test/task-1221-stale-blocked-relaunch.test.ts | regression | unit | TASK-2328, task-1221 | test/task-1221-stale-blocked-relaunch.test.ts:77 | review | keep |
| test/task-1268-diff-scoped-area.test.ts | boundary | unit | TASK-2328, task-1268 | test/task-1268-diff-scoped-area.test.ts:18 | integration | keep |
| test/task-1268-pre-review-gate-per-round.test.ts | boundary | unit | TASK-2328, TASK-2377.03, TASK-2478, task-1268 | test/task-1268-pre-review-gate-per-round.test.ts:63 | review, verification | keep |
| test/task-1272-standalone-cycle.test.ts | boundary | integration-ci | TASK-2328, TASK-2521.03, task-1272 | test/task-1272-standalone-cycle.test.ts:60 | review | keep |
| test/task-1272-standalone-rebase.test.ts | boundary | integration-ci | TASK-2328, task-1272, task-2592 | test/task-1272-standalone-rebase.test.ts:70 | integration | keep |
| test/task-1383-active-gate-failure-prompt.test.ts | boundary | unit | task-1039, task-1121, task-1124, task-1383 | test/task-1383-active-gate-failure-prompt.test.ts:32 | cli-config, verification | keep |
| test/task-1385-pre-review-gate.test.ts | boundary | unit | TASK-2328, TASK-2377.03, task-1385 | test/task-1385-pre-review-gate.test.ts:56 | review, verification | keep |
| test/task-1390-shell-init-shebang.test.ts | behavior | integration-ci | TASK-2288, task-1390 | test/task-1390-shell-init-shebang.test.ts:32 | cli-config | keep |
| test/task-1391-import-equals-syntax.test.ts | behavior | unit | task-1391 | test/task-1391-import-equals-syntax.test.ts:75 | distribution | keep |
| test/task-1396-repro.test.ts | regression | unit | task-1396 | test/task-1396-repro.test.ts:50 | cli-config | keep |
| test/task-1415-closed-mission-counts.test.ts | boundary | integration-ci | TASK-1388, task-1409, task-1415 | test/task-1415-closed-mission-counts.test.ts:109 | persistence | keep |
| test/task-1416-repro.test.ts | regression | integration-ci | TASK-2328, task-1416, task-2536 | test/task-1416-repro.test.ts:149 | agents | keep |
| test/task-1424-post-integrate-publish-reinstall.test.ts | regression | integration-ci | TASK-2285, TASK-2322.08, TASK-2328 | test/task-1424-post-integrate-publish-reinstall.test.ts:74 | integration, distribution | keep |
| test/task-1431-integration-preflight-repro.test.ts | regression | unit | TASK-2328, TASK-2479, task-1431 | test/task-1431-integration-preflight-repro.test.ts:99 | integration | keep |
| test/task-2200-classification-bug-label.test.ts | boundary | unit | task-2200 | test/task-2200-classification-bug-label.test.ts:57 | lifecycle | keep |
| test/task-2202-repair-handoff-autocommit.test.ts | boundary | unit | task-2202, task-2480 | test/task-2202-repair-handoff-autocommit.test.ts:49 | lifecycle | keep |
| test/task-2203-publish-proof-refresh-order.test.ts | boundary | integration-ci | TASK-2604, task-2200, task-2203 | test/task-2203-publish-proof-refresh-order.test.ts:60 | distribution | keep |
| test/task-2204-integrate-no-variant-a.test.ts | boundary | unit | task-2204 | test/task-2204-integrate-no-variant-a.test.ts:18 | integration | keep |
| test/task-2206-post-integrate-hook-errors.test.ts | regression | integration-ci | task-2206 | test/task-2206-post-integrate-hook-errors.test.ts:100 | integration | keep |
| test/task-2211-codex-isolation-repro.test.ts | regression | unit | TASK-2328, task-2211 | test/task-2211-codex-isolation-repro.test.ts:29 | agents | keep |
| test/task-2212-repro.test.ts | regression | integration-ci | TASK-2198, task-2001, task-2212 | test/task-2212-repro.test.ts:59 | integration | keep |
| test/task-2214-repro.test.ts | regression | unit |  | test/task-2214-repro.test.ts:10 | lifecycle | keep |
| test/task-2215-missing-error-bounce.test.ts | boundary | unit | task-2213, task-2215, task-2521.06 | test/task-2215-missing-error-bounce.test.ts:25 | recovery | keep |
| test/task-2220-repro.test.ts | regression | integration-ci | TASK-2322.12, task-2220 | test/task-2220-repro.test.ts:26 | review | keep |
| test/task-2225-package-root.test.ts | boundary | unit | TASK-2322.08, TASK-2328, task-2225 | test/task-2225-package-root.test.ts:66 | distribution | keep |
| test/task-2228-distribution-verification.test.ts | boundary | unit | TASK-2285, TASK-2328 | test/task-2228-distribution-verification.test.ts:39 | verification | keep |
| test/task-2231-unit-tests-hang-repro.test.ts | regression | integration-ci | TASK-2328, task-2231 | test/task-2231-unit-tests-hang-repro.test.ts:73 | verification | keep |
| test/task-2233-reviewer-non-submission-bounce.test.ts | regression | unit | TASK-2328, TASK-2377.04, task-2233, task-9001 | test/task-2233-reviewer-non-submission-bounce.test.ts:114 | review, recovery | keep |
| test/task-2234-push-to-reviewer-autobounce.test.ts | boundary | integration-ci | TASK-2328, task-2234 | test/task-2234-push-to-reviewer-autobounce.test.ts:49 | review, recovery | keep |
| test/task-2236-pi-e2e-repro.test.ts | regression | unit | TASK-2328, TASK-2500.04, task-2236 | test/task-2236-pi-e2e-repro.test.ts:20 | agents | keep |
| test/task-2239-rereview-after-response.test.ts | regression | integration-ci | task-2239 | test/task-2239-rereview-after-response.test.ts:68 | review | keep |
| test/task-2241-tmp-cleanup-repro.test.ts | regression | integration-ci | TASK-2328, task-2241 | test/task-2241-tmp-cleanup-repro.test.ts:37 | verification | keep |
| test/task-2242-backlog-drift.test.ts | boundary | unit | TASK-2328, task-100, task-2200, task-2242, task-99 | test/task-2242-backlog-drift.test.ts:25 | integration | keep |
| test/task-2243-probe-abort-promotion.test.ts | boundary | unit | TASK-2243 | test/task-2243-probe-abort-promotion.test.ts:115 | integration | keep |
| test/task-2261-checkpoint-gates-repro.test.ts | regression | unit | TASK-2377.05, task-2261 | test/task-2261-checkpoint-gates-repro.test.ts:59 | lifecycle, verification | keep |
| test/task-2265-codex-mcp-worktree-repro.test.ts | regression | unit | task-2265 | test/task-2265-codex-mcp-worktree-repro.test.ts:30 | agents, integration | keep |
| test/task-2266-codex-isolation-repro.test.ts | regression | unit | task-2266 | test/task-2266-codex-isolation-repro.test.ts:35 | agents | keep |
| test/task-2270-graphify-exclusion.test.ts | behavior | integration-local | task-0000, task-2270 | test/task-2270-graphify-exclusion.test.ts:15 | distribution | keep |
| test/task-2273-review-gate-ownership.test.ts | boundary | integration-ci | TASK-2332.09, task-2273 | test/task-2273-review-gate-ownership.test.ts:33 | review, verification | keep |
| test/task-2279-assets-and-rollback-shim.test.ts | behavior | unit | TASK-2288, task-2279 | test/task-2279-assets-and-rollback-shim.test.ts:20 | distribution | keep |
| test/task-2284-catalog-round-trip.test.ts | behavior | unit | TASK-1, TASK-1374, TASK-2284, TASK-2307, TASK-9999, task-1373, task-1385, task-2347 | test/task-2284-catalog-round-trip.test.ts:88 | agents | keep |
| test/task-2285-pack-install-smoke.test.ts | behavior | integration-ci | TASK-2286, task-2285, task-2431 | test/task-2285-pack-install-smoke.test.ts:58 | distribution | keep |
| test/task-2285-release-metadata.test.ts | boundary | unit | TASK-2282, TASK-2328, TASK-2381, task-2285, task-2286 | test/task-2285-release-metadata.test.ts:30 | distribution | keep |
| test/task-2286-native-sea-smoke.test.ts | boundary | integration-local | TASK-2328, task-2286 | test/task-2286-native-sea-smoke.test.ts:107 | distribution | keep |
| test/task-2286-sea-stop-rules.test.ts | boundary | unit | task-2286 | test/task-2286-sea-stop-rules.test.ts:25 | distribution | keep |
| test/task-2294.01-repro.test.ts | regression | unit | TASK-2294.01 | test/task-2294.01-repro.test.ts:74 | integration | keep |
| test/task-2297-graphify-codex-repro.test.ts | regression | unit | task-2294, task-2297 | test/task-2297-graphify-codex-repro.test.ts:35 | agents, distribution | keep |
| test/task-2311-console-empty-repro.test.ts | regression | unit | task-2311 | test/task-2311-console-empty-repro.test.ts:84 | agents | keep |
| test/task-2312-label-sync.test.ts | boundary | integration-ci | TASK-201, TASK-202, TASK-203, TASK-204 | test/task-2312-label-sync.test.ts:21 | cli-config | keep |
| test/task-2313-repro.test.ts | regression | integration-ci | TASK-2313 | test/task-2313-repro.test.ts:115 | presentation | keep |
| test/task-2317-context-compaction.test.ts | boundary | unit | TASK-2328, TASK-2377.03, task-2317, task-2465 | test/task-2317-context-compaction.test.ts:21 | review | keep |
| test/task-2318-temp-directory-leaks.test.ts | behavior | integration-ci | TASK-2328, task-2318, task-2326, task-2500 | test/task-2318-temp-directory-leaks.test.ts:114 | verification | keep |
| test/task-2319-notices-git-tracking.test.ts | behavior | integration-ci | task-2319 | test/task-2319-notices-git-tracking.test.ts:32 | distribution | keep |
| test/task-2322-05-cli-characterization.test.ts | boundary | unit | task-4243, task-4244, task-4245 | test/task-2322-05-cli-characterization.test.ts:86 | lifecycle | keep |
| test/task-2322-05-mission-sqlite-fixture.test.ts | boundary | integration-ci | TASK-2322.05, TASK-2347.02, task-2322 | test/task-2322-05-mission-sqlite-fixture.test.ts:131 | persistence, domain | keep |
| test/task-2322-05-mission-use-cases.test.ts | boundary | integration-ci | TASK-1, TASK-2322.05, TASK-2347.02, task-2322, task-9999 | test/task-2322-05-mission-use-cases.test.ts:170 | lifecycle | keep |
| test/task-2322-agent-block-import.test.ts | boundary | unit |  | test/task-2322-agent-block-import.test.ts:48 | domain, agents | keep |
| test/task-2322-agent-block-service.test.ts | boundary | unit |  | test/task-2322-agent-block-service.test.ts:24 | domain, agents | keep |
| test/task-2322-persistence-adr.test.ts | behavior | unit |  | test/task-2322-persistence-adr.test.ts:29 | persistence | keep |
| test/task-2322.11-operator-state.test.ts | boundary | integration-ci | task-2322 | test/task-2322.11-operator-state.test.ts:110 | persistence | keep |
| test/task-2322.12-review-recovery.integration.test.ts | boundary | integration-ci | TASK-2322.12, TASK-2377.04 | test/task-2322.12-review-recovery.integration.test.ts:131 | review, recovery | keep |
| test/task-2322.12-stray-persistence.test.ts | behavior | integration-ci | TASK-2322.12 | test/task-2322.12-stray-persistence.test.ts:83 | persistence | keep |
| test/task-2332-status-review-history.test.ts | boundary | unit | TASK-2332 | test/task-2332-status-review-history.test.ts:199 | review, cli-config | keep |
| test/task-2332.09-handoff-composition.test.ts | behavior | unit | task-2332.09 | test/task-2332.09-handoff-composition.test.ts:16 | lifecycle | keep |
| test/task-2332.14-review-use-case.test.ts | boundary | unit | task-2332.14 | test/task-2332.14-review-use-case.test.ts:19 | review | keep |
| test/task-2335-reviewer-family-repro.test.ts | regression | unit | TASK-2328, TASK-2335, task-2322.12, task-999 | test/task-2335-reviewer-family-repro.test.ts:82 | review | keep |
| test/task-2336-repro.test.ts | regression | unit | task-2336 | test/task-2336-repro.test.ts:46 | agents | keep |
| test/task-2337-repro.test.ts | regression | integration-ci | TASK-2328, TASK-2337, TASK-2363 | test/task-2337-repro.test.ts:59 | persistence | keep |
| test/task-2339-aggregate-read-during-write.test.ts | boundary | integration-ci | task-2339, task-9002 | test/task-2339-aggregate-read-during-write.test.ts:131 | persistence | keep |
| test/task-2339-review-store-bindings.test.ts | boundary | unit | TASK-2582, task-9001 | test/task-2339-review-store-bindings.test.ts:69 | review | keep |
| test/task-2339-self-review-forbidden.test.ts | boundary | unit | TASK-2328, task-9001 | test/task-2339-self-review-forbidden.test.ts:28 | review | keep |
| test/task-2339-submit-for-review-idempotent.test.ts | boundary | unit | task-2339 | test/task-2339-submit-for-review-idempotent.test.ts:76 | review | keep |
| test/task-2339-writes-outlive-close.test.ts | boundary | integration-ci | task-2339, task-9003, task-999 | test/task-2339-writes-outlive-close.test.ts:51 | persistence | keep |
| test/task-2340-hook-rebounce.test.ts | boundary | unit | TASK-2369.17, TASK-2377.03, TASK-2377.05, task-2340 | test/task-2340-hook-rebounce.test.ts:13 | recovery | keep |
| test/task-2341-review-store-wiring.test.ts | boundary | unit | task-2341 | test/task-2341-review-store-wiring.test.ts:63 | review | keep |
| test/task-2342-consume-human-notes-dedup.test.ts | boundary | unit | TASK-2328, task-2342 | test/task-2342-consume-human-notes-dedup.test.ts:47 | review | keep |
| test/task-2342-missionstore-repro.test.ts | regression | unit | TASK-2328, task-2342 | test/task-2342-missionstore-repro.test.ts:22 | review | keep |
| test/task-2343-board-projection-repro.test.ts | regression | integration-ci | TASK-2343 | test/task-2343-board-projection-repro.test.ts:212 | presentation | keep |
| test/task-2343-lifecycle-persistence.test.ts | boundary | unit | task-2343 | test/task-2343-lifecycle-persistence.test.ts:56 | persistence | keep |
| test/task-2344-review-history-status-repro.test.ts | regression | unit | task-2344 | test/task-2344-review-history-status-repro.test.ts:92 | review, cli-config | keep |
| test/task-2345-repro.test.ts | regression | integration-ci | task-2345 | test/task-2345-repro.test.ts:22 | agents | keep |
| test/task-2347-01-repository-identity-repro.test.ts | regression | integration-ci | task-2347.01, task-2347.05, task-7001, task-9001 | test/task-2347-01-repository-identity-repro.test.ts:190 | metrics | keep |
| test/task-2347-06-repro.test.ts | regression | unit | task-0010, task-0020, task-0030, task-2347, task-2347.06 | test/task-2347-06-repro.test.ts:41 | metrics | keep |
| test/task-2347.02-lifecycle-history.test.ts | boundary | integration-ci | TASK-2347.02, task-2347 | test/task-2347.02-lifecycle-history.test.ts:130 | metrics | keep |
| test/task-2347.02-repro.test.ts | regression | integration-ci | TASK-2347.02, task-2347 | test/task-2347.02-repro.test.ts:102 | metrics | keep |
| test/task-2347.03-inverted-dwell-repro.test.ts | regression | unit | task-0001, task-0002, task-2347.03 | test/task-2347.03-inverted-dwell-repro.test.ts:42 | metrics | keep |
| test/task-2347.04-throughput-truthful.test.ts | boundary | unit |  | test/task-2347.04-throughput-truthful.test.ts:44 | metrics | keep |
| test/task-2347.05-cycle-time-vs-runtime.test.ts | boundary | unit | TASK-2363, task-2347.05 | test/task-2347.05-cycle-time-vs-runtime.test.ts:150 | metrics | keep |
| test/task-2347.07-statistics-provenance.repro.test.ts | regression | unit |  | test/task-2347.07-statistics-provenance.repro.test.ts:35 | metrics | keep |
| test/task-2347.08-own-statistics-semantics-repro.test.ts | regression | unit | Task-2347.08 | test/task-2347.08-own-statistics-semantics-repro.test.ts:54 | metrics | keep |
| test/task-2347.08-statistics-boundaries.test.ts | behavior | unit | task-2347.08, task-2369.02 | test/task-2347.08-statistics-boundaries.test.ts:16 | metrics | keep |
| test/task-2347.09-bounce-rate.test.ts | boundary | unit | task-2347.09 | test/task-2347.09-bounce-rate.test.ts:89 | recovery | keep |
| test/task-2347.09-cohort-metrics.test.ts | boundary | unit | task-0001, task-0002, task-0003, task-0004, task-0005, task-0006, task-0007, task-0008, task-0009, task-0010, task-2347.09 | test/task-2347.09-cohort-metrics.test.ts:141 | metrics | keep |
| test/task-2347.09-cohort-presentation.test.ts | boundary | unit | task-2347.09 | test/task-2347.09-cohort-presentation.test.ts:44 | metrics, presentation | keep |
| test/task-2347.10-repro.test.ts | regression | integration-ci | TASK-2328, task-2347.10 | test/task-2347.10-repro.test.ts:163 | metrics | keep |
| test/task-2348-implementer-attribution.test.ts | boundary | integration-ci | task-2348 | test/task-2348-implementer-attribution.test.ts:90 | metrics | keep |
| test/task-2349-integrate-stage-commit-race.test.ts | boundary | integration-ci | TASK-2376, TASK-2533, task-2349 | test/task-2349-integrate-stage-commit-race.test.ts:94 | integration | keep |
| test/task-2350-reconcile-interrupted-handoff.test.ts | boundary | integration-ci | task-2350 | test/task-2350-reconcile-interrupted-handoff.test.ts:34 | lifecycle | keep |
| test/task-2351-agent-selection-snapshot-adapter.test.ts | boundary | unit |  | test/task-2351-agent-selection-snapshot-adapter.test.ts:20 | agents | keep |
| test/task-2351-agent-selection-snapshot-repro.test.ts | regression | unit | TASK-2351 | test/task-2351-agent-selection-snapshot-repro.test.ts:28 | agents | keep |
| test/task-2351-agent-selection-telemetry.test.ts | boundary | unit |  | test/task-2351-agent-selection-telemetry.test.ts:12 | agents | keep |
| test/task-2351-review-loop-selection.test.ts | boundary | unit | TASK-2351, TASK-2478 | test/task-2351-review-loop-selection.test.ts:27 | review | keep |
| test/task-2353-rebounce-reproduction.test.ts | regression | unit | TASK-2377.03, task-2353 | test/task-2353-rebounce-reproduction.test.ts:69 | recovery | keep |
| test/task-2357-certification.test.ts | boundary | integration-ci | TASK-2357, TASK-2363, task-100, task-101, task-102, task-103, task-104, task-105, task-106, task-107, task-200 | test/task-2357-certification.test.ts:217 | persistence | keep |
| test/task-2357.a-historical-intake.test.ts | boundary | integration-ci | TASK-2357 | test/task-2357.a-historical-intake.test.ts:63 | metrics, lifecycle | keep |
| test/task-2357.b-canonical-repository-identity.test.ts | boundary | integration-ci | TASK-2357, task-100 | test/task-2357.b-canonical-repository-identity.test.ts:73 | metrics | keep |
| test/task-2357.c-unknown-review-fix-rounds.test.ts | boundary | integration-ci | TASK-2357, task-201, task-202, task-203, task-204 | test/task-2357.c-unknown-review-fix-rounds.test.ts:78 | review | keep |
| test/task-2357.d-completion-population.test.ts | boundary | integration-ci | TASK-2357, task-301, task-302, task-303 | test/task-2357.d-completion-population.test.ts:79 | metrics | keep |
| test/task-2357.e-legacy-history-scope.test.ts | boundary | integration-ci | TASK-123, TASK-2357, task-900 | test/task-2357.e-legacy-history-scope.test.ts:61 | metrics | keep |
| test/task-2357.g-per-metric-evidence.test.ts | boundary | integration-ci | TASK-2357, task-6 | test/task-2357.g-per-metric-evidence.test.ts:75 | metrics | keep |
| test/task-2358-multi-round-repro.test.ts | regression | unit | task-2358 | test/task-2358-multi-round-repro.test.ts:188 | review | keep |
| test/task-2359-repro.test.ts | regression | unit | TASK-2521.03, task-2359 | test/task-2359-repro.test.ts:23 | review | keep |
| test/task-2361-bug-frequency.test.ts | boundary | unit | TASK-2001, TASK-2002, TASK-2003, TASK-2004, TASK-2005, TASK-2006, TASK-2007, TASK-2008, TASK-2009, TASK-2010, TASK-2011, TASK-2012, TASK-2013, TASK-2020, TASK-2021, TASK-2305, TASK-9999 | test/task-2361-bug-frequency.test.ts:45 | metrics | keep |
| test/task-2363-decision-window.test.ts | boundary | unit | TASK-2363 | test/task-2363-decision-window.test.ts:18 | metrics | keep |
| test/task-2363-flow-presentation.test.ts | boundary | unit | TASK-2363 | test/task-2363-flow-presentation.test.ts:47 | presentation | keep |
| test/task-2363-production-certification.test.ts | boundary | integration-ci | TASK-2363, task-2357 | test/task-2363-production-certification.test.ts:78 | presentation | keep |
| test/task-2363-repository-identity.test.ts | boundary | integration-ci | TASK-2363, task-2357, task-400, task-401, task-402 | test/task-2363-repository-identity.test.ts:56 | metrics | keep |
| test/task-2363-review-fix-rounds.test.ts | boundary | integration-ci | TASK-2357, TASK-2363, task-500, task-501 | test/task-2363-review-fix-rounds.test.ts:63 | review | keep |
| test/task-2363-weekly-decision-window.test.ts | boundary | unit | TASK-2363, task-0600, task-0601 | test/task-2363-weekly-decision-window.test.ts:51 | metrics | keep |
| test/task-2363-windowed-cohorts.test.ts | boundary | integration-ci | TASK-2363, task-2357, task-300, task-301 | test/task-2363-windowed-cohorts.test.ts:55 | metrics | keep |
| test/task-2364-owner-assumption.test.ts | boundary | unit | TASK-2328, task-2364 | test/task-2364-owner-assumption.test.ts:20 | review | keep |
| test/task-2365-tmp-reclamation.test.ts | boundary | unit | task-2339, task-2365 | test/task-2365-tmp-reclamation.test.ts:34 | verification | keep |
| test/task-2366-repro.test.ts | regression | unit | task-2366 | test/task-2366-repro.test.ts:19 | lifecycle | keep |
| test/task-2367-certification.test.ts | boundary | integration-ci | TASK-2367, task-2357 | test/task-2367-certification.test.ts:25 | persistence | keep |
| test/task-2367-integration-completion-repro.test.ts | regression | integration-ci | TASK-2367 | test/task-2367-integration-completion-repro.test.ts:76 | integration | keep |
| test/task-2367-regressions.test.ts | boundary | integration-ci | TASK-2367, task-2357 | test/task-2367-regressions.test.ts:28 | persistence | keep |
| test/task-2367-repair.test.ts | boundary | integration-ci | TASK-2367, task-2002, task-2322.07, task-2324, task-2329 | test/task-2367-repair.test.ts:24 | persistence | keep |
| test/task-2367-telemetry-schema.test.ts | boundary | integration-ci | TASK-2367 | test/task-2367-telemetry-schema.test.ts:18 | agents | keep |
| test/task-2368-agent-running-review-detection.test.ts | boundary | unit | TASK-2368, task-2274 | test/task-2368-agent-running-review-detection.test.ts:104 | agents, review, recovery | keep |
| test/task-2369-regressions.test.ts | boundary | integration-ci | TASK-2367, TASK-2369, task-2357, task-2363, task-2371 | test/task-2369-regressions.test.ts:252 | persistence | keep |
| test/task-2369.05-integrate-gates.test.ts | boundary | unit | TASK-2369.05 | test/task-2369.05-integrate-gates.test.ts:39 | integration, verification | keep |
| test/task-2369.13-bounce-output-elision.test.ts | boundary | unit | TASK-2369.13, TASK-2377.05 | test/task-2369.13-bounce-output-elision.test.ts:21 | recovery | keep |
| test/task-2370-repro.test.ts | regression | integration-ci | TASK-2370, TASK-2444, task-0001 | test/task-2370-repro.test.ts:131 | domain | keep |
| test/task-2373-current-work-workflow.test.ts | boundary | unit | TASK-2373 | test/task-2373-current-work-workflow.test.ts:129 | recovery | keep |
| test/task-2373-liveness.test.ts | boundary | unit | TASK-2373, TASK-2375 | test/task-2373-liveness.test.ts:38 | recovery | keep |
| test/task-2373-needs-you.test.ts | boundary | unit | TASK-2373 | test/task-2373-needs-you.test.ts:108 | lifecycle | keep |
| test/task-2373-operation-aware.test.ts | boundary | unit | TASK-2373 | test/task-2373-operation-aware.test.ts:45 | recovery | keep |
| test/task-2373-operator-rail.test.ts | boundary | unit | task-2408 | test/task-2373-operator-rail.test.ts:28 | recovery | keep |
| test/task-2373-refresh-performance.test.ts | boundary | unit |  | test/task-2373-refresh-performance.test.ts:22 | presentation | keep |
| test/task-2373-repro.test.ts | regression | unit | TASK-2373, TASK-2375, task-0001, task-0002, task-0003 | test/task-2373-repro.test.ts:140 | recovery | keep |
| test/task-2373-shutdown.test.ts | boundary | integration-ci | TASK-2373, TASK-2375, TASK-2377, TASK-2601, task-2286 | test/task-2373-shutdown.test.ts:42 | recovery | keep |
| test/task-2375-active-invocation-overlap.test.ts | boundary | integration-ci | TASK-2375, task-9101 | test/task-2375-active-invocation-overlap.test.ts:160 | cli-config | keep |
| test/task-2375-current-work-operation-repro.test.ts | regression | integration-ci | TASK-2375, task-9101 | test/task-2375-current-work-operation-repro.test.ts:105 | recovery | keep |
| test/task-2375-metrics-cache-and-liveness.test.ts | boundary | unit | TASK-2375, task-9901 | test/task-2375-metrics-cache-and-liveness.test.ts:161 | recovery, metrics | keep |
| test/task-2376-lifecycle-timing.test.ts | boundary | integration-local | TASK-2376, TASK-2378 | test/task-2376-lifecycle-timing.test.ts:119 | metrics, domain | keep |
| test/task-2377-02-pre-review-rebase-inprocess.test.ts | boundary | unit | TASK-2377.02, task-2369.13, task-2377, task-2476 | test/task-2377-02-pre-review-rebase-inprocess.test.ts:105 | integration, review | keep |
| test/task-2377-repro.test.ts | regression | unit | TASK-2328, TASK-2377 | test/task-2377-repro.test.ts:75 | agents | keep |
| test/task-2377-sigint-pty-repro.test.ts | regression | unit | TASK-2377, TASK-2377.01 | test/task-2377-sigint-pty-repro.test.ts:35 | presentation | keep |
| test/task-2377.03-rebound-kernel.test.ts | boundary | unit | TASK-2377.03, task-2386, task-2413, task-2525.05 | test/task-2377.03-rebound-kernel.test.ts:55 | recovery | keep |
| test/task-2377.04-drop-retry-counters-migration.test.ts | boundary | unit | TASK-2328, TASK-2377.04, task-0016 | test/task-2377.04-drop-retry-counters-migration.test.ts:100 | persistence, recovery | keep |
| test/task-2377.04-per-round-rebound-cap.test.ts | boundary | unit | TASK-2328, TASK-2377.04, TASK-2478 | test/task-2377.04-per-round-rebound-cap.test.ts:99 | recovery | keep |
| test/task-2377.05-handoff-bounce.test.ts | boundary | unit | TASK-2377.05 | test/task-2377.05-handoff-bounce.test.ts:45 | lifecycle, recovery | keep |
| test/task-2377.05-integrate-squash-bounce.test.ts | boundary | integration-ci | TASK-2377.05 | test/task-2377.05-integrate-squash-bounce.test.ts:186 | integration, recovery | keep |
| test/task-2377.05-kernel-only-bounce.test.ts | boundary | unit | TASK-2377.04, TASK-2377.05, TASK-2512 | test/task-2377.05-kernel-only-bounce.test.ts:116 | recovery | keep |
| test/task-2378-authoritative-stats.test.ts | boundary | integration-ci | TASK-2378, task-2376 | test/task-2378-authoritative-stats.test.ts:186 | metrics | keep |
| test/task-2379-approval-boundary-repro.test.ts | regression | integration-ci | TASK-2379 | test/task-2379-approval-boundary-repro.test.ts:137 | review | keep |
| test/task-2381-repro.test.ts | regression | unit | TASK-2328, TASK-2381 | test/task-2381-repro.test.ts:38 | distribution | keep |
| test/task-2384-reviewer-self-review-approval-owed.test.ts | boundary | unit | task-2384 | test/task-2384-reviewer-self-review-approval-owed.test.ts:30 | review | keep |
| test/task-2385-stale-review-round-repro.test.ts | regression | unit | TASK-2385 | test/task-2385-stale-review-round-repro.test.ts:51 | review | keep |
| test/task-2387-board-current-work.test.ts | boundary | unit | task-2387 | test/task-2387-board-current-work.test.ts:66 | recovery, presentation | keep |
| test/task-2388-repro.test.ts | regression | unit | task-2388, task-5000 | test/task-2388-repro.test.ts:47 | agents | keep |
| test/task-2392-active-lane-repro.test.ts | regression | unit | TASK-2392 | test/task-2392-active-lane-repro.test.ts:49 | lifecycle, cli-config | keep |
| test/task-2393-current-work-attribution-repro.test.ts | regression | unit | TASK-2393 | test/task-2393-current-work-attribution-repro.test.ts:71 | recovery | keep |
| test/task-2397-integrate-active-approved-recovery.test.ts | boundary | integration-ci | TASK-2328, TASK-2397 | test/task-2397-integrate-active-approved-recovery.test.ts:135 | integration, recovery, cli-config | keep |
| test/task-2398-approve-fixing-round.test.ts | boundary | unit | TASK-2398, TASK-2489, task-2380 | test/task-2398-approve-fixing-round.test.ts:178 | review | keep |
| test/task-2401-review-projection-queries.test.ts | boundary | unit | task-2401 | test/task-2401-review-projection-queries.test.ts:65 | review | keep |
| test/task-2402-focused-mission-status.test.ts | boundary | unit | TASK-2400, TASK-2402, task-9001, task-9002, task-9003, task-9004, task-9999 | test/task-2402-focused-mission-status.test.ts:253 | cli-config | keep |
| test/task-2406-draft-current-work.test.ts | boundary | unit | task-2406 | test/task-2406-draft-current-work.test.ts:41 | lifecycle, recovery | keep |
| test/task-2407-snapshot-worktree-topology-runtime-repro.test.ts | regression | unit | task-2407 | test/task-2407-snapshot-worktree-topology-runtime-repro.test.ts:45 | integration | keep |
| test/task-2408-board-hallucinated-content-repro.test.ts | regression | unit | task-2406, task-2408, task-9000 | test/task-2408-board-hallucinated-content-repro.test.ts:72 | presentation | keep |
| test/task-2411-integrate-work-detection.test.ts | boundary | unit | task-2411 | test/task-2411-integrate-work-detection.test.ts:71 | integration | keep |
| test/task-2413-proof-reuse.test.ts | boundary | integration-ci | TASK-2413, task-1, task-2, task-2573 | test/task-2413-proof-reuse.test.ts:39 | verification | keep |
| test/task-2413-publication-seam.test.ts | boundary | integration-ci | TASK-2413, task-2373.01, task-9998, task-9999 | test/task-2413-publication-seam.test.ts:29 | distribution | keep |
| test/task-2413-recovery-dossier.test.ts | boundary | unit | TASK-2413 | test/task-2413-recovery-dossier.test.ts:45 | recovery | keep |
| test/task-2413-repro.test.ts | regression | integration-ci | TASK-2413, task-2373.01 | test/task-2413-repro.test.ts:34 | recovery | keep |
| test/task-2415-pre-review-gate-repair-continues.test.ts | boundary | unit | TASK-2415 | test/task-2415-pre-review-gate-repair-continues.test.ts:99 | review, verification | keep |
| test/task-2416-review-family-repro.test.ts | regression | unit | TASK-2416 | test/task-2416-review-family-repro.test.ts:143 | review | keep |
| test/task-2419-status-pr-branch-repro.test.ts | regression | unit | task-2402, task-2419 | test/task-2419-status-pr-branch-repro.test.ts:74 | cli-config | keep |
| test/task-2420-integrate-recovery-assigned-reviewer.test.ts | boundary | integration-ci | TASK-2420 | test/task-2420-integrate-recovery-assigned-reviewer.test.ts:73 | review, integration, recovery | keep |
| test/task-2423-repro.test.ts | regression | unit | TASK-2423 | test/task-2423-repro.test.ts:26 | verification | keep |
| test/task-2424-repro.test.ts | regression | integration-ci | task-2424 | test/task-2424-repro.test.ts:11 | presentation | keep |
| test/task-2425-repro.test.ts | regression | unit | task-2425 | test/task-2425-repro.test.ts:30 | presentation | keep |
| test/task-2426-repro.test.ts | regression | integration-ci | task-2426, task-2427 | test/task-2426-repro.test.ts:65 | domain | keep |
| test/task-2427-board-draft.test.ts | boundary | unit | task-2427 | test/task-2427-board-draft.test.ts:136 | presentation, lifecycle | keep |
| test/task-2428-review-board-characterization.test.ts | boundary | unit | task-2428 | test/task-2428-review-board-characterization.test.ts:23 | review, presentation | keep |
| test/task-2428-review-board-safety.test.ts | boundary | unit | TASK-2521.03, task-2428 | test/task-2428-review-board-safety.test.ts:17 | presentation, review | keep |
| test/task-2429-board-integrate.test.ts | boundary | unit | task-2429 | test/task-2429-board-integrate.test.ts:44 | presentation, integration | keep |
| test/task-2433-web-mutation.integration.test.ts | boundary | integration-ci | TASK-2425, TASK-2433, task-9999 | test/task-2433-web-mutation.integration.test.ts:127 | presentation | keep |
| test/task-2436-board-handoff-resume.test.ts | boundary | unit | TASK-2436 | test/task-2436-board-handoff-resume.test.ts:189 | presentation, domain, lifecycle | keep |
| test/task-2438-worktree-board-repro.test.ts | regression | integration-ci | task-2438 | test/task-2438-worktree-board-repro.test.ts:103 | presentation, integration | keep |
| test/task-2439-rebounce-review-submit-repro.test.ts | regression | unit | task-2439 | test/task-2439-rebounce-review-submit-repro.test.ts:25 | review, recovery | keep |
| test/task-2440-repro.test.ts | regression | integration-ci | task-2440, task-2441 | test/task-2440-repro.test.ts:58 | persistence | keep |
| test/task-2441-mission-title-repro.test.ts | regression | integration-ci | task-2441, task-4401, task-4402, task-4403, task-4404 | test/task-2441-mission-title-repro.test.ts:114 | lifecycle | keep |
| test/task-2442-repro.test.ts | regression | unit | task-2442 | test/task-2442-repro.test.ts:197 | presentation | keep |
| test/task-2443-repro.test.ts | regression | integration-ci | task-2443, task-2557 | test/task-2443-repro.test.ts:53 | agents | keep |
| test/task-2444-attention-queue-repro.test.ts | regression | unit | task-2337, task-2444 | test/task-2444-attention-queue-repro.test.ts:37 | recovery | keep |
| test/task-2445-prevent-direct-backlog-activation.test.ts | boundary | unit | task-2445 | test/task-2445-prevent-direct-backlog-activation.test.ts:36 | lifecycle | keep |
| test/task-2446-repro.test.ts | regression | unit | TASK-2438, TASK-2492, task-2446 | test/task-2446-repro.test.ts:38 | persistence | keep |
| test/task-2447-repro.test.ts | regression | unit | TASK-2447 | test/task-2447-repro.test.ts:48 | presentation | keep |
| test/task-2452-repro.test.ts | regression | unit |  | test/task-2452-repro.test.ts:16 | presentation | keep |
| test/task-2453-repro.test.ts | regression | unit | TASK-2453 | test/task-2453-repro.test.ts:22 | presentation | keep |
| test/task-2454-web-board-draft-repro.test.ts | regression | integration-ci | TASK-2454, task-2400 | test/task-2454-web-board-draft-repro.test.ts:104 | presentation | keep |
| test/task-2455-config-exit-status-repro.test.ts | regression | integration-ci | task-2455 | test/task-2455-config-exit-status-repro.test.ts:24 | cli-config | keep |
| test/task-2455.01-target-user-repro.test.ts | regression | unit | TASK-2455.01 | test/task-2455.01-target-user-repro.test.ts:37 | cli-config | keep |
| test/task-2455.02-task-provider-config-repro.test.ts | regression | unit | task-2455, task-2455.02 | test/task-2455.02-task-provider-config-repro.test.ts:36 | cli-config | keep |
| test/task-2456-handoff-retry-duplicate-lane-event.test.ts | boundary | unit | TASK-2456 | test/task-2456-handoff-retry-duplicate-lane-event.test.ts:125 | lifecycle, recovery, metrics | keep |
| test/task-2459-repro.test.ts | regression | unit | task-0001, task-2459 | test/task-2459-repro.test.ts:41 | domain | keep |
| test/task-2461-claude-stream-render.test.ts | boundary | unit |  | test/task-2461-claude-stream-render.test.ts:50 | agents, presentation | keep |
| test/task-2466-cancel-surfaces.test.ts | boundary | integration-ci | TASK-2466 | test/task-2466-cancel-surfaces.test.ts:50 | lifecycle | keep |
| test/task-2466-mission-cancel.test.ts | boundary | integration-ci | TASK-2466 | test/task-2466-mission-cancel.test.ts:138 | lifecycle | keep |
| test/task-2468-adhoc-lifecycle-repro.test.ts | regression | integration-ci | TASK-2468, TASK-2521.03 | test/task-2468-adhoc-lifecycle-repro.test.ts:384 | lifecycle | keep |
| test/task-2468-prompt-parity.test.ts | boundary | unit | TASK-1000, TASK-2468 | test/task-2468-prompt-parity.test.ts:66 | lifecycle | keep |
| test/task-2468-slug-namespace.test.ts | boundary | unit | TASK-2468 | test/task-2468-slug-namespace.test.ts:19 | lifecycle | keep |
| test/task-2473-resume-review-repro.test.ts | regression | unit | TASK-2473, task-2465 | test/task-2473-resume-review-repro.test.ts:226 | review | keep |
| test/task-2477-review-presentation.test.ts | boundary | unit | TASK-2477, task-999 | test/task-2477-review-presentation.test.ts:70 | review, presentation | keep |
| test/task-2478-correction-presentation.test.ts | boundary | unit | TASK-2478, task-999 | test/task-2478-correction-presentation.test.ts:74 | presentation | keep |
| test/task-2478-invalidate-blocker.test.ts | boundary | unit | TASK-2478 | test/task-2478-invalidate-blocker.test.ts:160 | recovery | keep |
| test/task-2478-revision-integrity.test.ts | boundary | unit | TASK-2478 | test/task-2478-revision-integrity.test.ts:55 | review | keep |
| test/task-2483-completed-controls.test.ts | boundary | unit | TASK-2521.03, task-2483 | test/task-2483-completed-controls.test.ts:44 | review | keep |
| test/task-2484-npm-metadata-urls-repro.test.ts | regression | integration-ci | task-2484 | test/task-2484-npm-metadata-urls-repro.test.ts:67 | distribution | keep |
| test/task-2489-lead-from-worktree.test.ts | boundary | integration-ci | task-2489 | test/task-2489-lead-from-worktree.test.ts:41 | integration | keep |
| test/task-2489-recovery-supervisor.test.ts | boundary | integration-ci | task-2489 | test/task-2489-recovery-supervisor.test.ts:123 | recovery | keep |
| test/task-2492-already-merged-detection.test.ts | boundary | integration-ci | TASK-2492, task-2481 | test/task-2492-already-merged-detection.test.ts:58 | integration | keep |
| test/task-2492-integrate-gate-bounce.test.ts | boundary | integration-ci | TASK-2492 | test/task-2492-integrate-gate-bounce.test.ts:193 | verification, integration, recovery | keep |
| test/task-2492-integration-gate-rebound.test.ts | boundary | unit | TASK-2492 | test/task-2492-integration-gate-rebound.test.ts:46 | recovery, verification | keep |
| test/task-2494-repro.test.ts | regression | unit | TASK-2494 | test/task-2494-repro.test.ts:144 | integration | keep |
| test/task-2498-review-null-agent-board.test.ts | boundary | unit | TASK-2498 | test/task-2498-review-null-agent-board.test.ts:54 | agents, presentation, review | keep |
| test/task-2500-integrate-mode-dispatch.test.ts | boundary | unit | task-2500, task-2500.01, task-2506, task-2517 | test/task-2500-integrate-mode-dispatch.test.ts:181 | integration | keep |
| test/task-2502-codeql-clean-cache.test.ts | behavior | integration-ci | TASK-2502 | test/task-2502-codeql-clean-cache.test.ts:22 | verification | keep |
| test/task-2502-codeql-regression.test.ts | boundary | unit | TASK-2502 | test/task-2502-codeql-regression.test.ts:24 | verification | keep |
| test/task-2502-codeql-suite-flag.test.ts | behavior | integration-ci | TASK-2502 | test/task-2502-codeql-suite-flag.test.ts:20 | verification | keep |
| test/task-2503-repro.test.ts | regression | unit | TASK-2503 | test/task-2503-repro.test.ts:145 | integration | keep |
| test/task-2504-repro.test.ts | regression | unit | TASK-2504 | test/task-2504-repro.test.ts:55 | verification | keep |
| test/task-2506-dry-run-rebase.test.ts | boundary | unit | TASK-2506 | test/task-2506-dry-run-rebase.test.ts:59 | integration | keep |
| test/task-2506-integrate-rebase.test.ts | boundary | unit | TASK-2506 | test/task-2506-integrate-rebase.test.ts:150 | integration | keep |
| test/task-2508-interrupted-landed-integration-repro.test.ts | regression | unit | task-2508 | test/task-2508-interrupted-landed-integration-repro.test.ts:42 | integration | keep |
| test/task-2509-local-version-allocation.test.ts | behavior | integration-ci | task-2509 | test/task-2509-local-version-allocation.test.ts:16 | distribution | keep |
| test/task-2509-release-publish.test.ts | boundary | unit | task-2509 | test/task-2509-release-publish.test.ts:10 | distribution | keep |
| test/task-2509-release-workflow.test.ts | behavior | integration-ci | task-2509, task-2522 | test/task-2509-release-workflow.test.ts:9 | distribution | keep |
| test/task-2515-integration-lifecycle-not-masked.test.ts | boundary | unit | TASK-2515 | test/task-2515-integration-lifecycle-not-masked.test.ts:82 | integration | keep |
| test/task-2516-recover-landed-mission-repro.test.ts | regression | integration-ci | TASK-2516 | test/task-2516-recover-landed-mission-repro.test.ts:18 | recovery, integration | keep |
| test/task-2517-cp3-landed-closeout.test.ts | boundary | integration-ci | TASK-2517, task-2397 | test/task-2517-cp3-landed-closeout.test.ts:124 | integration | keep |
| test/task-2517-integrate-rebound-landing-guard.test.ts | boundary | unit | TASK-2517 | test/task-2517-integrate-rebound-landing-guard.test.ts:38 | integration, recovery | keep |
| test/task-2517-landed-squash-base-branch-detection.test.ts | boundary | integration-ci | TASK-2517 | test/task-2517-landed-squash-base-branch-detection.test.ts:31 | integration | keep |
| test/task-2517-sc4-landed-guard.test.ts | boundary | unit | TASK-2517 | test/task-2517-sc4-landed-guard.test.ts:26 | integration | keep |
| test/task-2518-board-action-vocabulary-repro.test.ts | regression | unit | TASK-2518 | test/task-2518-board-action-vocabulary-repro.test.ts:72 | presentation | keep |
| test/task-2520-diverged-base-reconcile.test.ts | boundary | unit | task-2520 | test/task-2520-diverged-base-reconcile.test.ts:80 | integration | keep |
| test/task-2520-integrate-rebase-state.test.ts | boundary | unit | TASK-2520 | test/task-2520-integrate-rebase-state.test.ts:76 | integration | keep |
| test/task-2520-rebase-inprogress.test.ts | boundary | unit | TASK-2520 | test/task-2520-rebase-inprogress.test.ts:82 | integration | keep |
| test/task-2520-resume-landing.test.ts | boundary | unit | TASK-2520 | test/task-2520-resume-landing.test.ts:113 | integration | keep |
| test/task-2521-03-context-cli.integration.test.ts | boundary | integration-ci | TASK-2521.03, task-2521 | test/task-2521-03-context-cli.integration.test.ts:95 | lifecycle, domain | keep |
| test/task-2521-03-context-discovery.test.ts | boundary | unit | TASK-2521.03 | test/task-2521-03-context-discovery.test.ts:46 | cli-config | keep |
| test/task-2521-03-mutation-parity.test.ts | boundary | unit | TASK-2521.03, TASK-2521.04 | test/task-2521-03-mutation-parity.test.ts:70 | lifecycle | keep |
| test/task-2521-03-prompt-authority.test.ts | behavior | unit | TASK-2521.03 | test/task-2521-03-prompt-authority.test.ts:30 | lifecycle | keep |
| test/task-2521-03-review-verbs.test.ts | boundary | unit | TASK-2521.03, task-3000, task-9 | test/task-2521-03-review-verbs.test.ts:54 | review | keep |
| test/task-2521-03-review-write.test.ts | boundary | unit | TASK-2521.03, task-2521 | test/task-2521-03-review-write.test.ts:72 | review | keep |
| test/task-2521-03-status-projection.test.ts | boundary | unit | TASK-2521.03, task-2521 | test/task-2521-03-status-projection.test.ts:64 | cli-config | keep |
| test/task-2521.04-imported-mission-board-path.test.ts | boundary | unit | TASK-9101, TASK-9102, TASK-9104, TASK-9105, task-2521.04 | test/task-2521.04-imported-mission-board-path.test.ts:108 | presentation | keep |
| test/task-2521.04-legacy-mission-import.test.ts | boundary | unit | TASK-2500, TASK-2521.06, TASK-2521.07, TASK-8000, TASK-9001, TASK-9002, TASK-9003, TASK-9004, TASK-9005, TASK-9006, TASK-9007, TASK-9008, TASK-9009, TASK-9010, TASK-9011, TASK-9012, TASK-9013, TASK-9014, TASK-9015, TASK-9016, TASK-9017, TASK-9018, TASK-9019, TASK-9020, TASK-9021, TASK-9022, task-2521.04 | test/task-2521.04-legacy-mission-import.test.ts:124 | persistence | keep |
| test/task-2521.04-legacy-trace-commit.integration.test.ts | boundary | integration-ci | TASK-2521.04, TASK-2521.07, TASK-9001, TASK-9002, TASK-9003, TASK-9004, TASK-9005, TASK-9006, TASK-9007, TASK-9008, task-2521.06 | test/task-2521.04-legacy-trace-commit.integration.test.ts:98 | persistence | keep |
| test/task-2521.04-mission-dependencies.integration.test.ts | boundary | integration-ci | TASK-2521.04, task-2521 | test/task-2521.04-mission-dependencies.integration.test.ts:74 | lifecycle | keep |
| test/task-2521.04-mission-dependencies.test.ts | boundary | unit | TASK-2521.01, TASK-2521.04, task-2521.03 | test/task-2521.04-mission-dependencies.test.ts:42 | lifecycle | keep |
| test/task-2521.06-audit.integration.test.ts | boundary | integration-ci | TASK-2576, TASK-9001, TASK-9008, task-2521, task-2521.06, task-2550, task-9002, task-9003, task-9004, task-9005, task-9006, task-9007, task-9009 | test/task-2521.06-audit.integration.test.ts:28 | persistence | keep |
| test/task-2521.06-legacy-task-content.test.ts | boundary | integration-ci | TASK-7, TASK-8, task-2521, task-2521.06, task-9008, task-9009 | test/task-2521.06-legacy-task-content.test.ts:23 | persistence | keep |
| test/task-2524-slug-duplicate-closeout-repro.test.ts | regression | unit | TASK-2524 | test/task-2524-slug-duplicate-closeout-repro.test.ts:23 | lifecycle, integration | keep |
| test/task-2525.03-sonar-enforcement.test.ts | boundary | integration-ci | TASK-2525.03, TASK-2547, TASK-2566, task-2525.05, task-2550 | test/task-2525.03-sonar-enforcement.test.ts:34 | verification | keep |
| test/task-2526-web-summary-repro.test.ts | regression | unit | TASK-2526 | test/task-2526-web-summary-repro.test.ts:59 | presentation | keep |
| test/task-2528-repro.test.ts | regression | unit | TASK-2528 | test/task-2528-repro.test.ts:118 | verification | keep |
| test/task-2530-backup-retention-repro.test.ts | regression | unit | task-2530 | test/task-2530-backup-retention-repro.test.ts:88 | persistence | keep |
| test/task-2532-stale-integration-state-repro.test.ts | regression | integration-ci | TASK-2532, task-001, task-002 | test/task-2532-stale-integration-state-repro.test.ts:105 | integration | keep |
| test/task-2533-squash-payload-pathspec-quotes.test.ts | boundary | integration-ci | TASK-2533, task-2521.01, task-2534, task-9001 | test/task-2533-squash-payload-pathspec-quotes.test.ts:28 | integration | keep |
| test/task-2534-backlog-repo-state.test.ts | boundary | unit | TASK-2534 | test/task-2534-backlog-repo-state.test.ts:14 | persistence | keep |
| test/task-2534-stale-backlog-copy-landing-repro.test.ts | regression | integration-ci | TASK-2534, TASK-9001, TASK-9002, TASK-9003, task-2478, task-2489 | test/task-2534-stale-backlog-copy-landing-repro.test.ts:34 | integration | keep |
| test/task-2536-ambiguous-launch-no-global-block.test.ts | boundary | unit | task-2536 | test/task-2536-ambiguous-launch-no-global-block.test.ts:89 | agents | keep |
| test/task-2537-squash-closeout-unstaged-task-path.test.ts | boundary | integration-ci | TASK-2533, TASK-2537, task-9002 | test/task-2537-squash-closeout-unstaged-task-path.test.ts:33 | integration | keep |
| test/task-2542-repro.test.ts | regression | unit | TASK-2542 | test/task-2542-repro.test.ts:52 | verification | keep |
| test/task-2543-integration-repair.test.ts | boundary | unit | task-2543 | test/task-2543-integration-repair.test.ts:50 | integration | keep |
| test/task-2543-revoke-review.test.ts | boundary | unit | task-2543 | test/task-2543-revoke-review.test.ts:29 | review | keep |
| test/task-2547-coverage-merge.test.ts | boundary | unit | TASK-2547 | test/task-2547-coverage-merge.test.ts:23 | verification | keep |
| test/task-2547-repro.test.ts | regression | unit | TASK-2547 | test/task-2547-repro.test.ts:45 | verification | keep |
| test/task-2548-lcov-summary.test.ts | boundary | unit | task-2548 | test/task-2548-lcov-summary.test.ts:16 | verification | keep |
| test/task-2550-repro.test.ts | regression | unit | TASK-2528, TASK-2550 | test/task-2550-repro.test.ts:196 | integration | keep |
| test/task-2551-recovery-post-integrate-hook.test.ts | regression | unit | TASK-2551 | test/task-2551-recovery-post-integrate-hook.test.ts:37 | integration, recovery | keep |
| test/task-2551-sonar-branch-cleanup.test.ts | boundary | integration-ci | TASK-2551 | test/task-2551-sonar-branch-cleanup.test.ts:27 | verification | keep |
| test/task-2554-guard.test.ts | behavior | integration-ci | TASK-2554 | test/task-2554-guard.test.ts:109 | verification | keep |
| test/task-2554-repro.test.ts | regression | integration-ci | TASK-2554 | test/task-2554-repro.test.ts:39 | persistence | keep |
| test/task-2555-rebase-stale-approval.test.ts | regression | integration-ci | TASK-2543, TASK-2555 | test/task-2555-rebase-stale-approval.test.ts:34 | review, integration | keep |
| test/task-2555-stand-down.test.ts | boundary | unit | TASK-2543, TASK-2555 | test/task-2555-stand-down.test.ts:60 | review, domain | keep |
| test/task-2557-sandbox-px-write.test.ts | boundary | integration-local | TASK-2557, task-2443, task-2599 | test/task-2557-sandbox-px-write.test.ts:216 | agents | keep |
| test/task-2560-file-free-typed-missions-repro.test.ts | regression | unit | task-2560 | test/task-2560-file-free-typed-missions-repro.test.ts:23 | persistence | keep |
| test/task-2561-lifecycle-unblock.test.ts | boundary | unit | TASK-2561, task-2547 | test/task-2561-lifecycle-unblock.test.ts:73 | lifecycle | keep |
| test/task-2561-repro.test.ts | regression | unit | TASK-2521.03, TASK-2561, task-2332.09, task-2547, task-2553 | test/task-2561-repro.test.ts:84 | integration | keep |
| test/task-2565-lifecycle-repro.test.ts | regression | unit | TASK-2565 | test/task-2565-lifecycle-repro.test.ts:34 | integration | keep |
| test/task-2566-sonar-boundary-repro.test.ts | regression | integration-ci | TASK-2586 | test/task-2566-sonar-boundary-repro.test.ts:12 | verification | keep |
| test/task-2569-backup-retention-repro.test.ts | regression | unit | task-2569 | test/task-2569-backup-retention-repro.test.ts:29 | persistence | keep |
| test/task-2576-agent-activity-repro.test.ts | regression | unit | TASK-2576 | test/task-2576-agent-activity-repro.test.ts:32 | agents, recovery | keep |
| test/task-2577-tmp-fixture-leaks-repro.test.ts | regression | integration-ci | TASK-2577, task-2339, task-2521.04 | test/task-2577-tmp-fixture-leaks-repro.test.ts:149 | verification | keep |
| test/task-2578-pre-integration-gate-tui-repro.test.ts | regression | unit | TASK-2578 | test/task-2578-pre-integration-gate-tui-repro.test.ts:46 | verification, presentation | keep |
| test/task-2580-active-persisted-mission-repro.test.ts | regression | integration-ci | task-2580 | test/task-2580-active-persisted-mission-repro.test.ts:77 | cli-config | keep |
| test/task-2581-recovery-advice-repro.test.ts | regression | unit | task-2581 | test/task-2581-recovery-advice-repro.test.ts:14 | recovery | keep |
| test/task-2582-lifecycle-ordering.test.ts | boundary | integration-ci | TASK-2582, task-2322, task-2397, task-2420, task-2456 | test/task-2582-lifecycle-ordering.test.ts:155 | lifecycle | keep |
| test/task-2582-repro.test.ts | regression | integration-ci | TASK-2579, TASK-2582 | test/task-2582-repro.test.ts:104 | review | keep |
| test/task-2583-pi-progress-repro.test.ts | regression | unit | task-2583 | test/task-2583-pi-progress-repro.test.ts:51 | agents | keep |
| test/task-2585-github-publication-proof.test.ts | boundary | integration-ci | task-2585 | test/task-2585-github-publication-proof.test.ts:38 | verification | keep |
| test/task-2585-workflow-proof-reuse.test.ts | behavior | integration-ci | task-2585 | test/task-2585-workflow-proof-reuse.test.ts:11 | verification | keep |
| test/task-2586-coverage-reporter-repro.test.ts | regression | unit | TASK-2586 | test/task-2586-coverage-reporter-repro.test.ts:29 | verification | keep |
| test/task-2590-file-timing-profile.test.ts | behavior | unit | TASK-2590 | test/task-2590-file-timing-profile.test.ts:35 | verification | keep |
| test/task-2592-autocommit-nonmission.test.ts | boundary | unit | task-2592 | test/task-2592-autocommit-nonmission.test.ts:32 | review | keep |
| test/task-2593-status-all-checkpoints.test.ts | boundary | unit | TASK-2593 | test/task-2593-status-all-checkpoints.test.ts:71 | cli-config, lifecycle | keep |
| test/task-2594-repro.test.ts | regression | unit | TASK-2521.07, TASK-2594 | test/task-2594-repro.test.ts:49 | lifecycle | keep |
| test/task-2595-squash-landing-commit-message.test.ts | boundary | integration-ci | TASK-2595, task-9101, task-9102, task-9103, task-9104 | test/task-2595-squash-landing-commit-message.test.ts:44 | integration | keep |
| test/task-2598-claude-credential-cell.test.ts | boundary | integration-local | TASK-2598 | test/task-2598-claude-credential-cell.test.ts:51 | agents | keep |
| test/task-2598-repro.test.ts | regression | integration-local | TASK-2598 | test/task-2598-repro.test.ts:44 | agents | keep |
| test/task-2600-repro.test.ts | regression | unit | TASK-2600 | test/task-2600-repro.test.ts:87 | review | keep |
| test/task-2601-repro.test.ts | regression | integration-ci | TASK-2521.03, TASK-2601, TASK-2604, task-2599 | test/task-2601-repro.test.ts:39 | integration | keep |
| test/task-2603-repro.test.ts | regression | unit | TASK-2603 | test/task-2603-repro.test.ts:14 | integration | keep |
| test/task-2604-repro.test.ts | regression | unit | TASK-2604 | test/task-2604-repro.test.ts:32 | integration | keep |
| test/task-2605-repro.test.ts | regression | unit | TASK-2605, task-2595 | test/task-2605-repro.test.ts:29 | integration | keep |
| test/task-2606-repro.test.ts | regression | unit | TASK-2606 | test/task-2606-repro.test.ts:48 | cli-config | keep |
| test/task-2614-local-autoinstall-repro.test.ts | regression | unit | TASK-2614 | test/task-2614-local-autoinstall-repro.test.ts:9 | distribution | keep |
| test/task-2616-qwen-403-vibe-rate-limit.test.ts | boundary | unit | task-2616 | test/task-2616-qwen-403-vibe-rate-limit.test.ts:15 | agents | keep |
| test/task-2621-repro.test.ts | regression | integration-ci | task-2621 | test/task-2621-repro.test.ts:86 | distribution | keep |
| test/task-metadata-pure.test.ts | boundary | unit | TASK-2535, task-1, task-9 | test/task-metadata-pure.test.ts:23 | cli-config | keep |
| test/task_1004.test.ts | boundary | unit | TASK-093, TASK-099, TASK-1004 | test/task_1004.test.ts:44 | integration | keep |
| test/telemetry-stubs.test.ts | boundary | unit | TASK-2328, task-1288 | test/telemetry-stubs.test.ts:65 | agents | keep |
| test/test-categories.test.ts | behavior | unit | TASK-2500.04, task-0000 | test/test-categories.test.ts:39 | verification | keep |
| test/test-hygiene.test.ts | behavior | integration-ci | TASK-2277 | test/test-hygiene.test.ts:39 | verification | keep |
| test/tui-action-bar.test.ts | boundary | unit |  | test/tui-action-bar.test.ts:15 | presentation | keep |
| test/tui-characterization-cp1.test.ts | boundary | unit | task-1234, task-2329, task-99, task-9999 | test/tui-characterization-cp1.test.ts:71 | presentation | keep |
| test/tui-command-flow.test.ts | boundary | integration-ci |  | test/tui-command-flow.test.ts:77 | presentation | keep |
| test/tui-command-guardrail.test.ts | behavior | unit |  | test/tui-command-guardrail.test.ts:19 | presentation | keep |
| test/tui-confirmation.test.ts | boundary | unit | task-2307 | test/tui-confirmation.test.ts:11 | presentation | keep |
| test/tui-flow-panel.test.ts | boundary | unit |  | test/tui-flow-panel.test.ts:59 | cli-config, presentation | keep |
| test/tui-headless-isolation.test.ts | behavior | unit |  | test/tui-headless-isolation.test.ts:105 | presentation | keep |
| test/tui-import-boundary.test.ts | behavior | unit |  | test/tui-import-boundary.test.ts:63 | presentation | keep |
| test/tui-lane-columns.test.ts | boundary | unit | task-0001, task-0002, task-0003, task-0008, task-0009, task-0012, task-1234, task-9999 | test/tui-lane-columns.test.ts:44 | presentation | keep |
| test/tui-navigation.test.ts | boundary | unit | task-0002, task-0004 | test/tui-navigation.test.ts:22 | presentation | keep |
| test/tui-outcome-banner.test.ts | boundary | unit |  | test/tui-outcome-banner.test.ts:22 | presentation | keep |
| test/tui-pty-smoke.test.ts | behavior | integration-ci |  | test/tui-pty-smoke.test.ts:34 | presentation | keep |
| test/tui-responsive-layout.test.ts | boundary | unit | task-1234 | test/tui-responsive-layout.test.ts:135 | presentation | keep |
| test/tui-rollback-proof.test.ts | behavior | unit | TASK-2288, TASK-2431 | test/tui-rollback-proof.test.ts:26 | presentation | keep |
| test/tui-shell-component.test.ts | boundary | unit | task-9999 | test/tui-shell-component.test.ts:157 | presentation | keep |
| test/tui-spawn.test.ts | behavior | integration-ci | TASK-2288 | test/tui-spawn.test.ts:45 | presentation | keep |
| test/tui-wave-3-component.test.ts | boundary | unit | task-9, task-9999 | test/tui-wave-3-component.test.ts:28 | presentation | keep |
| test/tui-wave-4-attention.test.ts | boundary | unit | TASK-2307, task-1001, task-1002, task-2001, task-2370, task-2408, task-3001, task-4001, task-4002, task-4003, task-4004, task-5001, task-6001, task-7001, task-7002, task-8001, task-8002, task-9001 | test/tui-wave-4-attention.test.ts:106 | presentation, recovery | keep |
| test/type-only-coverage.integration.test.ts | boundary | integration-ci |  | test/type-only-coverage.integration.test.ts:24 | verification | keep |
| test/type-only-coverage.test.ts | boundary | unit |  | test/type-only-coverage.test.ts:22 | verification | keep |
| test/typescript-test-authoring.test.ts | behavior | unit | TASK-2277 | test/typescript-test-authoring.test.ts:20 | verification | keep |
| test/unit-test-budget-reporter.test.ts | behavior | unit |  | test/unit-test-budget-reporter.test.ts:19 | verification | keep |
| test/unit-test-timeout-guard.test.ts | behavior | integration-local | TASK-2326 | test/unit-test-timeout-guard.test.ts:40 | verification | keep |
| test/verification-helpers.test.ts | boundary | unit |  | test/verification-helpers.test.ts:19 | verification, cli-config | keep |
| test/verification.test.ts | boundary | integration-ci | TASK-2328, task-2273 | test/verification.test.ts:23 | verification | keep |
| test/verify-local-integrate.test.ts | behavior | integration-ci | task-2292, task-2300, task-2414 | test/verify-local-integrate.test.ts:59 | integration, verification | keep |
| test/web-board-drag.test.ts | boundary | unit | task-2436 | test/web-board-drag.test.ts:10 | presentation | keep |
| test/web-board-interaction.test.ts | boundary | unit | task-2436, task-2553 | test/web-board-interaction.test.ts:64 | presentation | keep |
| test/web-board-render.test.ts | boundary | unit | TASK-2434, TASK-2576, task-0001, task-0002, task-0003, task-0004, task-0005, task-0006, task-0009, task-0010, task-1111, task-1112, task-1113, task-1114, task-1115, task-9999 | test/web-board-render.test.ts:104 | presentation | keep |
| test/web-client-snapshot.test.ts | boundary | unit | task-2433 | test/web-client-snapshot.test.ts:34 | presentation | keep |
| test/web-command-request.test.ts | boundary | unit | TASK-2433 | test/web-command-request.test.ts:28 | presentation | keep |
| test/web-host.integration.test.ts | boundary | integration-ci | TASK-2432 | test/web-host.integration.test.ts:173 | presentation | keep |
| test/web-mission-card-render.test.ts | boundary | unit | task-1234 | test/web-mission-card-render.test.ts:50 | presentation | keep |
| test/web-package-smoke.integration.test.ts | behavior | integration-ci |  | test/web-package-smoke.integration.test.ts:39 | presentation, distribution | keep |
| test/web-security-policy.test.ts | boundary | unit |  | test/web-security-policy.test.ts:29 | presentation | keep |
| test/web-stream.test.ts | boundary | unit |  | test/web-stream.test.ts:37 | presentation | keep |
| test/web-transport.test.ts | boundary | unit | TASK-2447, task-1001, task-1002, task-1003, task-1004, task-1005, task-1006, task-1007, task-1008, task-1009, task-1010, task-1234 | test/web-transport.test.ts:72 | presentation | keep |
