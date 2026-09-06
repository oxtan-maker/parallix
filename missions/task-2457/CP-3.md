# Checkpoint 3 — Runner wired into handoff, review, and integration

## Summary
Wired the generic, language-neutral runner (`src/adapters/config/repository-gates.ts`)
into the three lifecycle phases before each phase's transition/merge boundary,
and removed the hardcoded Node/`scripts/verify-local.sh`/Parallix-layout gate
assumption from the integration gate.

- **Handoff** (`src/application/handoff-command-use-case.ts`, `src/adapters/cli/commands/handoff.ts`):
  `runPhaseGates('handoff', { slug, checkoutPath: rootDir })` runs from the
  handoff checkout before any lane transition. A failing gate returns
  `{ ok: false, reason: 'gate-failed' }` and leaves the task in its current
  lane (active); a skipped/unconfigured phase proceeds. The handoff workflow
  port gains `HandoffRepositoryGatesPort` (`loadPhaseGates`, `runPhaseGates`)
  bound as `ports.repositoryGates` (`src/application/ports/handoff-workflow.ts`).
- **Review** (`src/adapters/review/review-commands.ts`): on `outcome === 'approve'`
  — the review → integration transition — `runPhaseGates('review', { slug, checkoutPath: worktree })`
  runs from the review checkout. A failing gate logs the failure, calls
  `exit(1)`, and returns, so the mission stays in review and never records the
  approve verdict.
- **Integration** (`src/adapters/cli/commands/integrate.ts`): after the resulting
  tree is finalized (`captureFinalIntegrationTree`) and before the merge,
  `loadPhaseGates(checkout, 'preIntegration')` + `runPhaseGates('integration', …)`
  run from the mission integration worktree. A failing gate throws
  `IntegrationAbort` before the merge. This replaces the previous hardcoded
  `./scripts/verify-local.sh integrate` invocation, so the live integration gate
  carries no Node/npm/tsx/`verify-local.sh`/Parallix-layout assumption.
  The TASK-2300 fail-closed invariant is repository-configured here: an empty
  resolved `preIntegration` list aborts the merge only when
  `adapters.gates.requirePreIntegration` is `true` (this repo opts in); an
  unconfigured repository proceeds without a lifecycle gate. The mandatory-gate
  message points at `adapters.gates.preIntegration` (task-2457 F12 dropped the
  dead `--no-integration-gates` suggestion). `--dry-run` short-circuits
  execution (plan-only) in `runPhaseGates`; `--real-agent`/`--real-agent-model`
  are threaded into the gate environment via `buildGateEnv`.

The runner itself owns no selection policy: which gates run is owned entirely by
`adapters.gates` in the repository's `workflow.config.json`. Generic gate
planning and execution contain no Node, npm, tsx, `scripts/verify-local.sh`, or
Parallix-directory/area rule.
- **Runner hardening** (re-homed from the removed `scripts/verify-local.sh` node
  driver): `buildGateEnv` scrubs `BASH_ENV` so an inherited non-interactive
  startup hook cannot alter a gate; it also deletes any inherited
  `PARALLIX_REAL_AGENT` / `PARALLIX_REAL_AGENT_MODEL` first, then sets them only
  when both a real agent and its model are supplied, so an ambient
  `PARALLIX_REAL_AGENT=codex` from an earlier session cannot leak into the
  `agent-smoke` gate. The default runner streams live output (`stdio: inherit`)
  and sets a 256 MiB `maxBuffer` so long gates (builds, test suites) do not die
  with `spawnSync`'s 1 MiB `ENOBUFS` default and report an unexplained
  `unknown` exit code; on failure both `stdout` and `stderr` are echoed so a
  test runner that reports failures on stdout is diagnosable.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Handoff gate runs before the transition and blocks on non-zero | `src/application/handoff-command-use-case.ts` pre-handoff block returns `{ ok:false, reason:'gate-failed' }`; `test/handoff-use-case.test.ts`, `"handoff use case blocks the transition when a pre-handoff gate fails"` | PASS |
| Review gate runs before the review→integration approve transition and blocks on non-zero | `src/adapters/review/review-commands.ts` approve branch calls `runPhaseGates('review', …)` then `exit(1)`; `test/review-commands-supplemental.test.ts`, `"submitReviewRound blocks approve when a pre-review gate fails"` | PASS |
| Integration gate runs before the merge and blocks on non-zero | `src/adapters/cli/commands/integrate.ts` runs `runPhaseGates('integration', …)` then `throw new IntegrationAbort()` before merge; `test/task-1039-integrate.test.ts`, `"integrate aborts before merge when a pre-integration gate fails"` | PASS |
| Integration merge gate fails closed only when the repo opts in (TASK-2300) | `src/adapters/cli/commands/integrate.ts` empty `preIntegration` + `requirePreIntegration:true` → aborts before merge; unconfigured → proceeds; `loadRequirePreIntegration` reads `adapters.gates.requirePreIntegration`; `test/task-1039-integrate.test.ts`, `"integrate fails closed when no pre-integration gates are configured"` (exit code 1) and `"integrate proceeds without a gate when the repository does not opt into requirePreIntegration"` | PASS |
| Mandatory-gate message no longer points at a rejected flag (F12) | `src/adapters/cli/commands/integrate.ts` message names `adapters.gates.preIntegration`, no `--no-integration-gates` clause | PASS |
| Runner scrubs BASH_ENV and real-agent overrides, streams live output, guards maxBuffer (ENOBUFS) | `src/adapters/config/repository-gates.ts` `buildGateEnv`/`runPhaseGates`; `test/task-2457-repro.test.ts`, `"buildGateEnv scrubs BASH_ENV and threads real-agent selection"`, `"dry run resolves the integration plan without executing any gate"` | PASS |
| Each phase receives mission slug, checkout path, exact phase id via env | `test/task-2457-repro.test.ts`, template tests `"configured passing gate for ${phase} executes once and receives the phase contract"` across handoff/review/integration; `buildGateEnv` sets `PARALLIX_MISSION_SLUG`/`PARALLIX_CHECKOUT_PATH`/`PARALLIX_PHASE` | PASS |
| Generic runner has no Node/npm/tsx/verify-local.sh/Parallix-layout policy | `src/adapters/config/repository-gates.ts` module comment + `loadPhaseGates`/`loadRepositoryGates` read only `adapters.gates`; integration gate no longer hardcodes `./scripts/verify-local.sh integrate` | PASS |
| Configured gate that passes permits the normal transition | `test/handoff-use-case.test.ts`, `"handoff use case proceeds when the pre-handoff gate passes"`; `test/review-commands-supplemental.test.ts`, `"submitReviewRound permits approve when the pre-review gate passes"`; `test/task-2457-repro.test.ts` passing-gate templates | PASS |

## Next action
CP 4: configure Parallix's own build, verification, workflow, and agent-smoke
gates through `workflow.config.json` `adapters.gates`; add execution/failure
coverage for all three phases; run `./scripts/verify-local.sh all`.
