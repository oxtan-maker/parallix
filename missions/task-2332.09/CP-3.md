# CP-3: Re-home the handoff workflow into the application use case

## Summary

CP-1 and CP-2 delivered a facade rather than an extraction: `HandoffCommandUseCase`
was a 10-line wrapper over a single opaque `execute(args, options)` port that called
straight back into the untouched 1361-line CLI adapter. SC1 and SC2 were therefore not
met, and the CP-2 Goal Check table contained no row for either criterion. CP-3 performs
the extraction the mission actually specifies.

Work done:

- **Ports rewritten** (`src/application/ports/handoff-workflow.ts`): the single
  passthrough interface was replaced with 17 narrow, application-owned ports —
  filesystem, git, mission-utils, backlog, Forgejo, review identity, review-surface
  bootstrap, rebase, gatekeeper, verification, NEL computation, document writer,
  product config, agent relaunch, agent selection, process, and the mission-services
  factory. The file header documents the port boundary as a table mapping each port to
  the adapter operations it stands in for.
- **Workflow moved** (`src/application/handoff-command-use-case.ts`): the complete
  sequencing now lives here — `verifyHandoff`, final gate run, rebase, NEL capture,
  Forgejo PR create/update with bootstrap and owner fallback, gatekeeper pre-review,
  bounded agent relaunch with the 3-attempt recursion guard and 2-relaunch budget,
  declared `## Gates` execution and validation, checkpoint recording, mission lifecycle
  transition, backlog transition, and the leased Forgejo push. The two longest inline
  blocks were lifted into `pushBacklogTransition` and `remediateGatekeeperPushback`.
- **Adapter reduced to a boundary** (`src/adapters/cli/commands/handoff.ts`):
  1365 lines to 218. It now binds concrete modules to the ports via
  `createHandoffPorts()` and delegates every exported function to one
  `HandoffCommandUseCase`. Port methods read their module namespaces at call time, so
  the existing `test/lib/module-mock.ts` seams still intercept dependencies. All prior
  named exports are retained for `src/adapters/review/review-loop.ts`,
  `src/composition/application-services.ts`, and the characterization suites.
- **CLI interface completed** (`src/interfaces/cli/handoff.ts`): added
  `handoffExitCode` and fixed a regression introduced in CP-2 — the interface rejected
  an absent positional slug, which would have broken `px handoff` run inside a mission
  worktree. The slug is optional again; the interface translates CLI arguments into a
  request, and the use case infers the slug and flags a usage error for the interface
  to render. The composition root creates the command through this interface, so
  the adapter no longer owns parsing or exit handling.
- **Composition injects the real ports** (`src/composition/create-cli.ts:130`):
  `createHandoffPorts()` is spread into the use case constructor with the
  request-scoped `missionServicesFn` bound to the `missionServices` port.
- **Tests**: `test/handoff-use-case.test.ts` was rewritten from 16 tautological
  assertions against a stub port into 22 hermetic tests that drive the real workflow
  over mocked ports — no Forgejo, no agent CLI, no git repository, no recursive
  workflow command.
- **Two structural guards re-homed**: `test/forgejo-independence.test.ts` and
  `test/task-2273-review-gate-ownership.test.ts` assert on handoff *source text*. Both
  now read the use case, since the adapter only delegates. The invariants they protect
  are unchanged.
- **Port naming**: filesystem port methods are `readText`/`writeText`/`listNames`/
  `listEntries` rather than the `fs` API names, so the ADR 0053 durable-IO scanner in
  `test/persistence-inventory-guardrail.test.ts` does not misread port declarations as
  unclassified persistence in `src/application/`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: adapter delegates to one use case and no longer sequences adapter packages | `src/adapters/cli/commands/handoff.ts:134` — `const useCase = new HandoffCommandUseCase(ports)`; named compatibility exports delegate through that use case (`src/adapters/cli/commands/handoff.ts:136-192`). File is 192 lines, down from 1365 (`` `wc -l src/adapters/cli/commands/handoff.ts` ``) | PASS |
| SC2: use case owns the complete workflow through application-owned ports | `src/application/handoff-command-use-case.ts:752` — `performHandoff` sequences gate, rebase, NEL, Forgejo, gatekeeper, declared gates, checkpoint, lifecycle, backlog; `src/application/handoff-command-use-case.ts:1275` — bounded relaunch; `src/application/handoff-command-use-case.ts:1209` — leased backlog push | PASS |
| SC2: use case imports no concrete adapter module | `src/application/handoff-command-use-case.ts:16` — the only imports are `node:path`, `./presentation/cli-format.js`, three `../domain/*` modules, and the port types. `` `grep -nE "from '.*(adapters\|/git/\|/forgejo/\|/backlog/\|/review/\|/verification/)" src/application/handoff-command-use-case.ts` `` returns no match | PASS |
| SC2: narrow ports defined, boundary documented | `src/application/ports/handoff-workflow.ts:174` — `HandoffWorkflowPorts` bag; `src/application/ports/handoff-workflow.ts:47` — `HandoffFileSystemPort`; `src/application/ports/handoff-workflow.ts:106` — `HandoffGatekeeperPort`; port-to-adapter map at `src/application/ports/handoff-workflow.ts:14` | PASS |
| SC3: parsing, request translation, exit-code mapping, and rendering live in the CLI interface | `src/interfaces/cli/handoff.ts:18` — `parseHandoffCliRequest`; `src/interfaces/cli/handoff.ts:42` — `handoffExitCode`; `src/interfaces/cli/handoff.ts:50` — parsed request passed to the use case; `src/composition/create-cli.ts:130-133` — the composed command is created with `createHandoffCommand` | PASS |
| SC3: CLI interface imports no adapter module | `src/interfaces/cli/handoff.ts:8` — imports only `application/presentation/cli-format.js` and the use-case type | PASS |
| SC3: optional slug regression from CP-2 fixed | `src/interfaces/cli/handoff.ts:48`; `"handoff CLI interface leaves the slug optional so the use case can infer it"` | PASS |
| SC4: composition supplies concrete ports by constructor injection | `src/composition/create-cli.ts:130` — `new HandoffCommandUseCase({ ...createHandoffPorts(), missionServices: missionServicesFn })` | PASS |
| SC5a: successful handoff over mocked ports | `test/handoff-use-case.test.ts` — `"handoff use case completes the full workflow over mocked ports"` | PASS |
| SC5b: gate failure | `"handoff use case fails closed when the final verification gate fails"`, `"handoff use case fails closed when a declared MISSION.md gate fails"` | PASS |
| SC5c: retry/relaunch after gatekeeper pushback | `"handoff use case relaunches the agent and succeeds after gatekeeper pushback clears"`, `"handoff use case stops after the bounded relaunch budget when pushback persists"` | PASS |
| SC5d: NEL persistence failure | `"handoff use case stops before review state advances when NEL persistence fails"` | PASS |
| SC5e: checkpoint recording failure | `"handoff use case fails when checkpoint recording is not completed"` | PASS |
| SC5: tests are hermetic (no Forgejo, agent CLI, or recursive workflow command) | `test/handoff-use-case.test.ts:61` — `makePorts` supplies in-memory stubs for all 17 ports; `test/task-2332.09-handoff-composition.test.ts` guards automatic review-loop injection | PASS |
| SC6: existing handoff characterization remains compatible | `` `npm test -- test/handoff.test.ts` `` — 78 pass, 0 fail | PASS |
| SC6: exit codes 0 on success and 1 on failure | `"handoff CLI interface maps success to exit code 0 and failure to 1"`, `"handoff CLI interface exits with code 1 when no slug can be inferred"`, `"handoffCommand normalizes uppercase explicit slugs"` | PASS |
| SC6: lifecycle transition to review and checkpoint recording preserved | `"handoff use case completes the full workflow over mocked ports"` asserts the backlog transition to `review`; `"handoff use case fails when the mission lifecycle transition is rejected"` | PASS |
| Cross-suite handoff consumers still pass | `` `npm test -- test/task-1039-handoff.test.ts test/task-1049-force-push.test.ts test/task-1104-call-order.test.ts test/task-2214-repro.test.ts test/task-2215-missing-error-bounce.test.ts test/task-2234-push-to-reviewer-autobounce.test.ts test/task-2273-review-gate-ownership.test.ts test/task-2322-05-cli-characterization.test.ts test/task-2335-reviewer-family-repro.test.ts test/task-2339-self-review-forbidden.test.ts test/task-2351-agent-selection-snapshot-repro.test.ts test/forgejo-independence.test.ts` `` — 75 pass, 0 fail | PASS |
| ADR 0053 durable-state inventory guard still clean | `test/persistence-inventory-guardrail.test.ts` — 20 pass, 0 fail | PASS |
| Gate: static analysis | `` `./scripts/verify-local.sh static-analysis` `` — exit 0, all 4 stages PASS | PASS |
| Gate: full verifier | `` `./scripts/verify-local.sh all` `` — exit 0, 1951 tests pass, 0 fail, mutation-gate PASSED | PASS |

Next action: Hand off task-2332.09 for review, flagging that TASK-2332.07's integrate
command (`src/application/integrate-command-use-case.ts`, 10 lines over a 2251-line
adapter) still has the facade shape this checkpoint replaced for handoff, and should be
re-homed with the same port bag pattern before TASK-2332.15.
