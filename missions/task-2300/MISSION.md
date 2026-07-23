# Mission: Make final integration gates unavoidable (task-2300)

## Goal
Make `px integrate` fail closed unless its configured integration gates run against the finalized selected mission worktree, and make every supported runtime entrypoint enforce the same gate plan before any integration side effect.

## Why Now
Recent rebase changes added `-C <executionRoot>`, exposing stale Git-mock assumptions and leaving two rebase tests failing. More importantly, prior integration records do not prove that the unconditional integration suite ran on the final mission tree. Without an execution-root and final-tree guarantee, an operator checkout can satisfy a gate while unverified mission work is merged, closed out, or version-bumped.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: fail-closed integration orchestration, execution-root propagation through npm and child processes, canonical-versus-legacy runtime consolidation, hermetic integration tests, and checkpoint-contract enforcement

## Scope
- Make `px integrate` resolve the configured integration-gate plan and refuse to complete when the mandatory integration suite has not executed successfully on the selected, finalized mission worktree.
- Propagate the selected mission root through `npm run test:integration`, including process cwd, `PARALLIX_EXECUTION_ROOT`, build-output selection, test-runtime generation, test discovery, and nested child processes.
- Make wrong-root execution detectable and fail closed; record the mission slug, exact execution root, final commit/tree identity, and failed gate in integration evidence or failure output.
- Preserve the unconditional integration-suite gate for every mission integration, including docs-only and unclassified diffs.
- Ensure canonical `src/platform/runtime/` behavior and packaged or legacy command entrypoints select the same gate plan and integration behavior; remove stale duplicates or isolate them behind one authoritative implementation.
- Reject `--no-integration-gates` during normal integration, or implement an explicit auditable emergency override that records its reason and prevents merge by default.
- Add hermetic integration-level coverage for a failing gate, wrong-root detection, final-tree ordering, runtime-entrypoint agreement, and rebase Git-argument normalization; audit nearby Git mocks for positional `args[0]`/`args[1]` assumptions.
- Update handoff and checkpoint guidance so integration requires `./scripts/verify-local.sh integrate`; `./scripts/verify-local.sh all` alone is not sufficient.

## Out of Scope
- Changing the product’s general behavior outside Parallix self-development solely to special-case this repository’s integration workflow.
- Contacting real Forgejo, GitHub, agents, or other external services from tests.
- Redesigning unrelated release, review, or versioning workflows beyond preventing their side effects after a failed integration gate.
- Changing mission-branch remote-push policy or executing an actual review, integration, merge, branch deletion, backlog closeout, or version bump during this mission.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A deliberately failing `npm run test:integration` fixture makes `px integrate` fail before squash merge, mission-branch deletion, backlog closeout, post-integrate version bump, or any equivalent integration side effect begins.
- On gate failure, the emitted diagnostic identifies both the failed gate and the selected mission slug, and the recorded evidence includes the exact execution root plus the final commit or tree identity used for the gate.
- Integration fails closed when the integration command, its npm subprocesses, build output, generated test runtime, test discovery, or nested child process resolves outside the selected mission root.
- The unconditional integration suite is present in the resolved gate plan and runs for source, docs-only, and unclassified mission diffs; `px integrate` cannot report success without it.
- The final integration gate is invoked after the mission tree is finalized and before the first merge, branch-deletion, backlog-closeout, or version-bump side effect.
- Canonical `src/platform/runtime/` and every retained packaged or legacy CLI entrypoint resolve the same integration-gate plan and enforce the same execution-root behavior, with stale duplicate implementations removed or demonstrably isolated.
- Normal `px integrate --no-integration-gates` invocation is rejected; if an emergency override is retained, it requires a recorded reason and prevents merge by default.
- The rebase tests `rebase caps failed continue retries when rebase remains active` and `rebase reports git output on failed continue attempt` pass after mocks normalize `-C <executionRoot>` arguments, and the audited nearby Git mocks have no unhandled positional-subcommand assumptions.
- All added and changed tests are hermetic: Git, Forgejo, agents, recursive CLI calls, and external services are mocked.
- `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis`, and `./scripts/verify-local.sh integrate` pass on the final committed mission tree; checkpoint evidence cites the integration command, selected root, commit/tree identity, resolved gate plan, and absence of side effects after a failed gate.

## Risks and Assumptions
- Risk: the repository has both legacy `lib/` and canonical `src/platform/runtime/` paths, so a partial fix can make tests exercise a different runtime than the packaged CLI. Assumption: one runtime can be made authoritative or the remaining entrypoints can delegate to it.
- Risk: child-process environment and cwd propagation can be lost at npm, build, test-generation, or recursive CLI boundaries. Assumption: tests can inject hermetic process runners and fixtures at each boundary.
- Risk: integration code may have existing side effects before the current gate hook. Assumption: their ordering can be observed and asserted without contacting real services.
- Risk: an emergency bypass could undermine fail-closed behavior. Assumption: a bypass is either unnecessary or can be audited while blocking merge by default.

## Checkpoints
- CP 1: Map the current `px integrate` call path, gate-plan selection, runtime entrypoints, and all integration side-effect boundaries; document the authoritative runtime and the final-tree point at which gates must run.
- CP 2: Add hermetic integration tests that lock failing-gate side-effect prevention, selected-root propagation and wrong-root rejection, final-tree ordering, unconditional-gate coverage, bypass behavior, and entrypoint agreement; repair the two named rebase tests and audit nearby Git mocks.
- CP 3: Implement the fail-closed orchestration, root propagation, runtime consolidation or isolation, and handoff/checkpoint-contract changes; run focused tests while preserving hermetic mocks.
- CP 4: Run all required verification commands on the final committed tree and record the exact root, commit/tree identity, gate plan, test evidence, and no-side-effect proof in the final handoff.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a concise work summary and the exact heading `## Goal Check`, followed by this 3-column pipe-delimited table:

| Criterion | Evidence | Status |
|---|---|---|

Include at least one row for every Success Criterion. Evidence must use Parallix-recognized forms: an existing file:line reference; an exact repository test name; an existing test-file path; an existing ADR reference; or a recognized repository command/path such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. For this mission, cite the integration test path and exact test name for each fail-closed scenario, the authoritative runtime file:line, and the executed `./scripts/verify-local.sh integrate` command with its selected root and final commit/tree identity. Raw `stat`/`ls` output or generic prose alone is not evidence: if included, pair it with an accepted reference above. End each checkpoint with a specific `Next action:` line naming the remaining implementation or verification action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh integrate

## Restricted Areas
- Do not use real Git hosting, Forgejo, agent, or recursive CLI services in tests; mocks must intercept them.
- Do not weaken, conditionally skip, or remove the unconditional integration-suite gate for docs-only or unclassified changes.
- Do not permit a normal `--no-integration-gates` path to merge mission work.
- Do not retain divergent integration-gate logic across canonical and packaged/legacy runtime paths.
- Do not push a mission branch to `origin`; any later code review push belongs only on the `review` remote.

## Stop Rules
- Stop and escalate if the selected mission root cannot be propagated through a subprocess boundary without executing a real external service.
- Stop and escalate if canonical and packaged/legacy entrypoints cannot be reconciled without a migration that changes unrelated product behavior.
- Stop and escalate if enforcing a mandatory gate requires weakening the final-tree-before-side-effects ordering or leaves an un-auditable bypass that can merge by default.
- Do not proceed to integration if `./scripts/verify-local.sh integrate` fails, if evidence lacks the selected root and final commit/tree identity, or if a failed-gate test observes any integration side effect.
