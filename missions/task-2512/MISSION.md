# Mission: Thin the integrate CLI adapter and retire the application→adapter exception (task-2512)

## Goal
Turn `src/adapters/cli/commands/integrate.ts` (2,108 lines / ~114 KB) into a thin
adapter that binds concrete infrastructure to application-owned ports and delegates
sequencing, following the shape already proven by `src/adapters/cli/commands/handoff.ts`
(198 lines) over `src/application/handoff-command-use-case.ts`; and empty
`productionDependencyExceptions` in `src/adapters/architecture/boundary-guards.ts` by
relocating the goal-check evidence helpers that `src/application/handoff-command-use-case.ts`
imports from `src/adapters/review/review-static-evidence.ts`, so the canonical dependency
graph holds with no owned exceptions at all.

## Why Now
The single remaining application→adapter exception (`handoff-command-use-case.ts` →
`review-static-evidence.ts`) is owned by TASK-2369.13, which is already `done`. An
exception whose removal owner has shipped is an exception nobody will remove; per the
rationale in `src/adapters/architecture/boundary-guards.ts`, that is exactly how a
temporary allowlist becomes permanent architecture. Separately, `src/adapters/README.md`
records under "Known outstanding debt" that `integrate.ts` combines request handling,
rendering, and workflow sequencing while wiring 9 sibling adapter packages, and that
nothing in CI fails on it — the retired fan-out rule could not distinguish a mechanism
from a sequencer. The integrate command is also the repo's highest-churn workflow
(TASK-2492, TASK-2500, TASK-2506, TASK-2508 all landed in it recently), so every new
integration behavior currently lands in the least-guarded file in the tree.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: 2,108 adapter lines to relocate behind a port contract; `test/integrate.test.ts`
  (~103 KB) and eight other suites import named symbols from the adapter and must keep
  importing them; module-level mock seams (`test/lib/module-mock.ts`) require call-time
  namespace access in the new port bindings.

## Scope
- Move the goal-check evidence helpers used by the application (`collectGoalCheckEvidenceRows`,
  `findUnverifiableGoalCheckRow`, plus their internal dependencies `evidenceCellHasVerifiableReference`,
  `collectRepoTestNames`, `canonicalSourceContainsFile`) out of `src/adapters/review/review-static-evidence.ts`
  into an application-owned module, and re-export them from the adapter module so review-side
  callers keep their current import paths.
- Set `productionDependencyExceptions` to `[]` in `src/adapters/architecture/boundary-guards.ts`.
- Introduce an application-owned integrate workflow port contract (alongside the existing
  `IntegrateWorkflowPort` in `src/application/ports/cli-workflows.ts`) covering the concrete
  mechanisms the current adapter reaches: git, backlog, Forgejo, filesystem/mission-utils,
  verification, agents, product config, repository gates, review state, and the post/conflict/gates
  integrate helper modules.
- Move the integrate sequencing — `integrate()`, `buildIntegrationContext`, `evaluateTaskStatusForIntegration`,
  `promoteTaskForIntegrationIfNeeded`, `recoverMissionForIntegration`, `recoveryEstablishesApproval`,
  `resolveAuthoritativeApprovalAt`, `printIntegrationPreflight`, `buildIntegrationReadiness`,
  `printIntegrationReadiness`, `runIntegrationRebase`, `predictIntegrationRebase`, `parseIntegrateArgs`,
  `resolveBounceImplementer`, `resolveIntegrationTaskPath`, `isCwdInsideMissionWorktree` — into
  application modules that depend only on those ports.
- Leave `src/adapters/cli/commands/integrate.ts` as the port-binding plus re-export barrel that
  preserves every symbol currently exported from it.
- Add a regression guard that fails if the exception list is repopulated or the adapter regrows:
  an assertion in `test/dependency-graph.test.ts` (or a sibling test registered per AGENTS.md
  test-tier rules) on `productionDependencyExceptions.length === 0` and on the adapter's line ceiling.

## Out of Scope
- `src/adapters/cli/commands/handoff.ts` and the handoff use case beyond the helper relocation
  required to clear the exception.
- `integrate-gates.ts`, `integrate-gate-rebound.ts`, `integrate-conflict.ts`, `integrate-post.ts`
  internals — they stay where they are and keep their current exports; only their call sites move.
- Any change to integration behavior, CLI flags, gate selection, or `workflow.config.json`
  `adapters.gates.preIntegration`.
- Reinstating a fan-out-count rule in `src/adapters/architecture/boundary-guards.ts`; the retired
  rule's failure mode (a count cannot distinguish a mechanism from a sequencer) is unchanged.
- The SQLite, web board, and TUI surfaces.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: `productionDependencyExceptions` in `src/adapters/architecture/boundary-guards.ts` is the
  empty array, and `findProductionDependencyViolations(process.cwd())` returns `[]` — verified by
  `npm test -- test/dependency-graph.test.ts`.
- SC2: `src/application/handoff-command-use-case.ts` contains no import whose specifier resolves
  under `src/adapters/`; `grep -n "adapters/" src/application/handoff-command-use-case.ts` returns
  only prose comment lines, no `import` statement.
- SC3: `src/adapters/review/review-static-evidence.ts` still exports `formatStaticReviewFindings`,
  `formatStaticReviewSuccess`, `collectGoalCheckEvidenceRows`, `collectRepoTestNames`,
  `canonicalSourceContainsFile`, `evidenceCellHasVerifiableReference`, `findUnverifiableGoalCheckRow`,
  and `performStaticReview` (re-exports count), so `src/adapters/cli/commands/handoff.ts` and
  review callers compile unchanged.
- SC4: `src/adapters/cli/commands/integrate.ts` is at most 450 lines (`wc -l`), down from 2,108,
  and contains no `child_process` import and no multi-step integration sequencing — its function
  bodies are port bindings, re-exports, and delegation to the application use case.
- SC5: The default export of `src/adapters/cli/commands/integrate.ts` and every named symbol in its
  current export list remains importable with the same signature: `integrate`, `detectChangedAreas`,
  `parseFilesToAreas`, `loadIntegrationConfig`, `getIntegrationGatePlan`, `printIntegrationGatePlan`,
  `buildIntegrationGateEnv`, `captureFinalIntegrationTree`, `parseIntegrateArgs`,
  `resolveIntegrationVerificationWorktree`, `buildIntegrationVerificationInvocation`,
  `executeIntegrationGates`, `orderIntegrationGates`, `gateMatchesChangedAreas`,
  `buildIntegrationContext`, `getPrimaryWorktree`, `VARIANT_B_AUTOMATION_SUMMARY`,
  `evaluateTaskStatusForIntegration`, `promoteTaskForIntegrationIfNeeded`, `recoverMissionForIntegration`,
  `printIntegrationPreflight`, `isIntendedPayloadAtHead`, `runIntegrationRebase`,
  `predictIntegrationRebase`, `buildIntegrationReadiness`, `printIntegrationReadiness`,
  `classifyHookFailure`, plus the `integrate-conflict.ts` and `integrate-post.ts` re-export blocks.
- SC6: The `options` injection seams the suites rely on keep working through the adapter:
  `missionServicesFn`, `exitFn`, `startAgentFn`, `transitionTaskFn`, `applyAgentFallbackFn`,
  `selectAgentFn`, `workflowLauncherStatusFn`, `routeIntegrationGateFailureFn`.
- SC7: These suites pass unmodified except for import-path adjustments: `test/integrate.test.ts`,
  `test/integrate-guard.test.ts`, `test/integrate-workflow-gate.test.ts`,
  `test/task-2369.05-integrate-gates.test.ts`, `test/task-2492-integrate-gate-bounce.test.ts`,
  `test/task-2500-integrate-mode-dispatch.test.ts`, `test/task-2506-integrate-rebase.test.ts`,
  `test/task-1431-integration-preflight-repro.test.ts`, `test/task-2379-approval-boundary-repro.test.ts`,
  `test/task-2378-authoritative-stats.test.ts`, `test/task-2340-hook-rebounce.test.ts`.
  No assertion may be deleted or weakened to make a suite pass.
- SC8: A test asserts both regression guards — `productionDependencyExceptions.length === 0` and the
  ≤450-line ceiling on `src/adapters/cli/commands/integrate.ts` — and fails when either is violated.
- SC9: `./scripts/verify-local.sh all` and `./scripts/verify-local.sh static-analysis` both exit 0 on
  the final tree.
- SC10: `src/adapters/README.md` "Known outstanding debt" no longer claims `integrate.ts` sequences
  workflow with 9 sibling packages if that is no longer true after the move; the section states the
  post-mission truth (handoff-style adapters excluded, remaining sequencers named).

## Risks and Assumptions
- Risk: `test/integrate.test.ts` (~103 KB) mocks concrete adapter modules by path via
  `test/lib/module-mock.ts`. Port bindings must resolve their dependencies at call time through
  imported namespaces (the pattern in `createHandoffPorts`), or mocks stop being observed and
  suites fail in ways that look like behavior changes. Mitigation: port bindings follow the
  handoff adapter pattern exactly.
- Risk: moving sequencing changes module load order for `process.exit` / `exitFn` handling; a
  mis-threaded `exitFn` turns a controlled non-zero exit into a thrown error inside the board
  integrate service (`createBoardIntegrateService` in `src/composition/application-services.ts`).
- Risk: this is a Large-bucket mission (ADR 0047: 73% historical rework rate above 235 NEL).
  Mitigation: checkpoint boundaries are independently verifiable; CP-1 lands the exception removal
  as a standalone, revertible change.
- Assumption: `evidenceCellHasVerifiableReference` and its helpers already take a `FileSystemPort`
  argument and use no adapter-only mechanism beyond it, so relocation is a move plus re-export,
  not a rewrite.
- Assumption: the four `integrate-*` helper modules stay adapter-side; the application reaches them
  through ports rather than importing them, so no new application→adapter edge is created while
  removing the old one.
- Assumption: `npm test` per-test budgets (AGENTS.md: 500 ms unit authoring target, 1,000 ms hard cap)
  still hold for relocated tests without new mocks.

## Checkpoints
- CP 1: Retire the application→adapter exception. Relocate the goal-check evidence helpers into an
  application-owned module, re-export them from `src/adapters/review/review-static-evidence.ts`,
  set `productionDependencyExceptions` to `[]`, and add the `length === 0` assertion. Covers SC1,
  SC2, SC3.
- CP 2: Define the integrate workflow port contract in the application layer and bind it in the
  adapter, with the integrate entry point still delegating to the existing implementation. No
  sequencing moved yet; every export and injection seam still resolves. Covers SC5, SC6 as a
  pre-move baseline.
- CP 3: Move the sequencing — context building, preflight/readiness, task-status evaluation,
  promotion, recovery, rebase prediction, argument parsing, and the `integrate()` body — into the
  application modules behind the CP-2 ports; reduce the adapter to bindings and re-exports under
  the 450-line ceiling. Covers SC4, SC7.
- CP 4: Land the regression guard and documentation truth-up, then run the gates. Covers SC8, SC9, SC10.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section — that exact heading
- A 3-column pipe-delimited markdown table with columns: `| Criterion | Evidence | Status |`
- One row per success criterion this checkpoint claims (CP-1: SC1–SC3; CP-2: SC5, SC6; CP-3: SC4, SC7;
  CP-4: SC8–SC10), each citing durable evidence Parallix verifies today:
  1. **Recognized repo commands or paths** — e.g. `` `npm test -- test/dependency-graph.test.ts` ``,
     `` `npm test -- test/integrate.test.ts` ``, `` `./scripts/verify-local.sh static-analysis` ``,
     `` `./scripts/verify-local.sh all` ``, or `` `wc -l src/adapters/cli/commands/integrate.ts` ``
  2. **Test names** — e.g. `"dependency graph production scan has no violation outside the owned allowlist"`
     (must match a test name that exists in the repo)
  3. **Test file paths** — e.g. `test/dependency-graph.test.ts`, `test/integrate.test.ts`
  4. **ADR references** — e.g. `ADR 0051` for the UI-neutral application boundary, `ADR 0047` for the
     NEL size budget, `ADR 0057` for verification tiers (each must exist under `docs/adr/`)
  5. **File:line references** — accepted where nothing else pins the claim, but discouraged: line
     numbers rot as soon as either file is edited, so prefer the four forms above
- Raw `stat`, `ls`, `wc`, or `grep` output and prose may appear as supplemental context, but never
  alone: pair every shell excerpt with a test name, test file path, ADR reference, or recognized
  repo command. A row whose only evidence is terminal output or a sentence of prose does not count
  as evidence and will be treated as an unverified claim.
- A non-generic `Next action:` line at the bottom naming the next concrete step by file or criterion.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| SC1 exception list is empty | `npm test -- test/dependency-graph.test.ts`, `"dependency graph production scan has no violation outside the owned allowlist"` | PASS |
| SC4 adapter under line ceiling | `wc -l src/adapters/cli/commands/integrate.ts` reports 412, asserted by `test/dependency-graph.test.ts` | PASS |
| SC9 verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`
- [ ] `./scripts/verify-local.sh static-analysis`

## Restricted Areas
- `workflow.config.json` (`adapters.gates.preIntegration`) and `config/integration-pipelines.json` —
  gate selection is out of scope.
- `docs/adr/` — no ADR may be added or amended; ADR 0051's boundary is applied, not changed.
- `src/domain/` — this refactor moves adapter sequencing into the application layer; domain rules
  stay untouched.
- `scripts/verify-local.sh` — the gate script is the measuring instrument, not a target.
- `backlog/` beyond `backlog/tasks/task-2512 - architectural-refactor.md`.

## Stop Rules
- Stop if preserving any symbol in SC5 or any seam in SC6 requires changing a caller in
  `src/composition/`, `src/adapters/review/review-loop.ts`, or a suite's assertions — report the
  symbol and the caller instead of widening the diff.
- Stop if a suite in SC7 can only be made green by deleting, skipping, or weakening an assertion.
- Stop if clearing the exception would require a new application→adapter edge anywhere else, or a
  new entry in `productionDependencyExceptions`.
- Stop if the 450-line ceiling in SC4 cannot be met without relocating `integrate-gates.ts`,
  `integrate-gate-rebound.ts`, `integrate-conflict.ts`, or `integrate-post.ts` — report the actual
  achievable line count with its breakdown rather than expanding scope.
- Stop if CP-3 changes observable integration behavior (flag handling, gate ordering, merge/closeout
  sequence, exit codes) rather than relocating it.
- Stop if `./scripts/verify-local.sh all` fails twice on the same root cause after a fix attempt.
