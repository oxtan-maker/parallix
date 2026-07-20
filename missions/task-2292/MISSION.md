# Mission: Restore E2E defense and integration-suite coverage on px integrate (task-2292)

## Goal
Restore the lifecycle and real-agent-smoke E2E tests to the working behavior immediately before task-2276, with task-2276's JavaScript-to-TypeScript conversion as the only permitted baseline difference. Make `npm run test:integration` an explicit, mandatory gate in every `px integrate` resolved plan so suite failures prevent squash merge. Repair every reproducible in-scope product regression exposed once that coverage is restored.

## Why Now
TASK-2275 intentionally moved process, Git/worktree, package, and network-boundary coverage out of the fast default unit suite. Task-2276 converted the tests to TypeScript and is the primary suspected point at which the E2E behavior regressed. The ordinary integration suite can also be omitted by `px integrate` for documentation, backlog, mission-artifact, unknown-path, or empty-area changes. Restore and run the known-good pre-task-2276 E2E behavior (ported to TypeScript), then repair the regressions that the restored E2E and integration coverage exposes.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: Establish task-2276's pre-conversion E2E behavior as the baseline, restore it in TypeScript, then use its failures to bound the regression repair.
- Main drivers: E2E baseline comparison; integration gate configuration; changed-area fallback semantics; mocked planner/runner regression tests; explicit integration-suite routing coverage.

## Scope
- Compare `test/e2e-mission-lifecycle.test.ts` and `test/e2e-real-agent-smoke.test.ts` with their pre-task-2276 JavaScript versions. Restore every functional behavior that diverged, except the intentional TypeScript filename and invocation conversion.
- Run both restored E2E harnesses and repair every reproducible product defect they expose within this mission's gate, runner, routing, E2E-workflow, and test-harness scope.
- On this machine, execute real-agent E2E coverage only through the supported Codex override: `codex` with model `gpt-5.6-luna`. The local/custom runner is unavailable and is not a valid verification path.
- Add a named integration-suite gate that runs `npm run test:integration` and propagates a nonzero result before squash merge.
- Make that gate unconditional for `lib`, `workflow`, `docs`, backlog-only, mission-artifact-only, unknown-path, and empty/no-area diffs.
- Preserve `workflow` lifecycle E2E and `custom-agent-smoke` as distinct gates with their TypeScript commands and existing area-selection/order behavior.
- Add hermetic planner, runner, and suite-routing tests using strict mocks or disposable fixtures.
- Keep `npm run test:integration` explicit and preserve routing coverage for every non-E2E test excluded from `npm test`; E2E tests remain independently invoked gates rather than joining the fast default suite.

## Out of Scope
- Moving integration-boundary tests back into `npm test` or weakening its fast, hermetic boundary.
- Treating task-2276's TypeScript conversion itself as a bug. The historical JavaScript baseline is authoritative for behavior, not file extension or runner syntax.
- Changing Forgejo infrastructure, agent-runner behavior, network services, Git/worktree semantics, or lifecycle policy except where a restored E2E or integration failure proves an in-scope product regression.
- Merging, removing, weakening, renaming, or reordering `workflow` lifecycle E2E or `custom-agent-smoke` defenses.
- Adding tests that run real Forgejo, agents, network services, nested `px`, or recursive verification outside the existing E2E harnesses.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `test/e2e-mission-lifecycle.test.ts` and `test/e2e-real-agent-smoke.test.ts` match the functional behavior of their pre-task-2276 JavaScript counterparts; only their TypeScript filenames and TypeScript invocation differ. Each repaired divergence has a targeted assertion or focused regression test.
- Both restored E2E gates and `npm run test:integration` run on the implementation tree. Every reproducible failure within this mission's scope is repaired and covered by a targeted regression test or an E2E assertion.
- The real-agent-smoke E2E is run with the Codex `gpt-5.6-luna` override on this machine; no conclusion is based on the unavailable local/custom runner.
- The resolved `px integrate` plan contains a named gate whose command is exactly `npm run test:integration`; a mocked or disposable nonzero result from it aborts integration before squash merge proceeds.
- Final-plan tests for `lib`, `workflow`, `docs`, backlog-only, mission-artifact-only, unknown-path, and empty/no-area inputs each assert the integration-suite command is present; none resolves to an empty or non-matching area list that omits it.
- Final-plan tests assert the presence or absence of `workflow` and `custom-agent-smoke` for each representative area according to current rules, and assert their commands and ordering remain separate from the integration-suite gate.
- `npm run test:integration` remains explicit, includes every non-E2E boundary test excluded from `npm test`, and its routing-regression test fails if such a test belongs to neither suite.
- New non-E2E unit tests use mocks or disposable files and do not contact Forgejo, launch agents, access network services, invoke nested `px`, or recursively run a verifier.
- Focused baseline-comparison, planner, runner, and routing tests; both restored E2E gates; `npm run test:integration`; `./scripts/verify-local.sh all`; and `./scripts/verify-local.sh static-analysis` succeed on the implementation tree.

## Risks and Assumptions
- Risk: task-2276's TypeScript conversion can be mistaken for a behavioral change. Assumption: compare the pre-task-2276 JavaScript and current TypeScript harnesses semantically, permitting only extension and TypeScript-invocation differences.
- Risk: restored coverage exposes post-task-2276 product regressions. Assumption: repair each reproducible failure within scope, and record external-infrastructure failures without masking them.
- Risk: the local/custom runner is unavailable on this machine. Assumption: use the supported Codex `gpt-5.6-luna` override for real-agent E2E execution and do not treat custom-runner unavailability as a product failure.
- Risk: changed-area classification may express documentation, backlog, mission-artifact, or unknown paths as no matching area. Assumption: model the integration-suite gate as unconditional rather than adding fragile aliases.
- Risk: a general gate could alter lifecycle E2E or real-agent-smoke behavior. Assumption: tests inspect complete resolved plans, including named commands and relative order.
- Risk: runner tests might invoke expensive real commands. Assumption: prove failure propagation with a mocked command runner or disposable failing command.
- Risk: suite routing can drift when scripts change. Assumption: retain and extend the routing-regression test.
- If the repair requires a Forgejo, agent-execution, or test-semantics redesign, stop and split a follow-up mission.

## Checkpoints
- CP 1: Compare both current TypeScript E2E harnesses with their pre-task-2276 JavaScript versions. Create a failing reproduction for each functional divergence, explicitly excluding only filename and TypeScript-invocation differences.
Reproduction-Test: test/e2e-mission-lifecycle.test.ts or test/e2e-real-agent-smoke.test.ts
- CP 2: Restore the pre-task-2276 E2E behavior in TypeScript. Run both restored E2E gates, using Codex `gpt-5.6-luna` for real-agent-smoke on this machine, and repair every reproducible in-scope product regression they expose with targeted assertions or regression tests.
- CP 3: Before the integration-gate fix, author a failing reproduction in `test/integration-pipelines.test.ts`. Resolve plans for documentation-only, backlog/mission-artifact-only, unknown-path, and empty/no-area inputs and assert each includes the named `npm run test:integration` gate. On the mission parent commit, at least one assertion must be red; after the repair, the same test must be green.
- CP 4: Inspect the integration-pipeline configuration and resolver, add the unconditional named integration-suite gate, and extend planner expectations for `lib`, `workflow`, `docs`, backlog-only, mission-only, unknown, and no-area inputs. Do not alter the distinct lifecycle E2E or real-agent-smoke commands, selection, or order.
- CP 5: Add a runner failure-path test with a strict mock or disposable command proving a nonzero integration-suite result blocks squash merge. Add or update routing coverage that accounts for every non-E2E boundary test excluded from `npm test`.
- CP 6: Run focused baseline-comparison, planner, runner, and routing tests; both restored E2E gates (with Codex `gpt-5.6-luna` for real-agent-smoke); the ordinary integration suite; the general verifier; and static analysis. Document baseline-restoration, product-regression, resolved-plan, and failure-propagation evidence for every criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of the completed checkpoint work.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`, with at least one row for every Success Criterion.
- Verifiable evidence using forms Parallix already verifies today: existing file:line references; exact test names; ADR references; existing test file paths; and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For CP 1, cite the pre-task-2276 commit, the corresponding current TypeScript E2E test path, and each exact red-to-green reproduction. For CP 2, cite each restored E2E failure, its repair, and its regression evidence. For CP 3, cite `test/integration-pipelines.test.ts` and the exact red-to-green test name. For CP 4, cite configuration and resolver file:line references plus exact resolved-plan test names. For CP 5, cite the runner failure test name/path and its mocked or disposable command. For CP 6, cite the commands that ran and relevant test paths.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair any shell output with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path.
- A concrete `Next action:` line at the bottom naming the next file, test, or command.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Restored E2E behavior matches pre-task-2276 | historical commit and current TypeScript E2E test path | PASS |
| Every resolved plan contains the integration-suite gate | `test/integration-pipelines.test.ts`, exact plan-resolver test name | PASS |
| Nonzero integration-suite result stops integration | runner failure-test path and exact test name | PASS |
| Required verification completed | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] node --import tsx test/e2e-mission-lifecycle.test.ts
- [ ] PARALLIX_REAL_AGENT=codex PARALLIX_REAL_AGENT_MODEL=gpt-5.6-luna node --import tsx test/e2e-real-agent-smoke.test.ts
- [ ] ./scripts/verify-local.sh all
- [ ] npm run test:integration
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not modify canonical task-record formats, mission lifecycle state, Forgejo configuration, agent configuration, or remote-service behavior.
- Do not make `npm test` run process-, Git/worktree-, package-, or network-boundary integration tests.
- Do not retain a TypeScript E2E behavior that differs from the pre-task-2276 JavaScript baseline unless an in-scope regression test proves the changed behavior is required to repair a verified defect.
- Do not collapse, remove, rename, or change command/order semantics of `workflow` lifecycle E2E or `custom-agent-smoke` gates.
- Do not add tests that call real Forgejo, start agents, contact network services, invoke nested `px`, or recursively execute repository verification outside the established E2E harnesses.
- Do not require or attempt local/custom-runner E2E execution on this machine; its supported real-agent E2E path is Codex `gpt-5.6-luna`.
- Limit changes to the E2E harnesses and their verified product regressions, the integration gate plan, resolver/runner path, package test routing, and focused tests named by the backlog task.

## Stop Rules
- Stop and request a scope decision if an unconditional integration-suite gate requires a Forgejo, agent-runner, network-service, or Git/worktree infrastructure change.
- Stop and split a follow-up mission if restoring the pre-task-2276 E2E behavior or preserving lifecycle E2E/custom-agent-smoke selection/order requires redesigning their commands or semantics.
- Stop before a workaround if an unknown or no-area path cannot be represented by the gate-selection contract; change that contract explicitly with a falsifying test, or request a design decision if its authority is unclear.
- Stop before handoff if the pre-task-2276 E2E baseline has not been compared, a reproducible in-scope E2E or integration failure remains unfixed, the planned gate does not run `npm run test:integration`, or a runner failure can still reach squash merge.
