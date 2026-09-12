# Mission: Fix agent fallback after usage blocks during rebase handoff (task-2494)

## Goal
When a pinned implementer hits an agent usage limit while resolving a `px rebase` shared-file conflict, the launcher records an `AgentBlock` but the workflow hard-refuses family substitution, and the failure-classifier's catch-all default then classifies the resulting pinned-agent error as an `InfraBlocker`/`HumanOnly` — routing the operator to Forgejo credentials / network checks for what is really an agent-capacity event. This mission makes the rebase-handoff path (a) substitute an eligible replacement agent family when mission policy permits, and (b) otherwise emit a final diagnostic that names the usage block and its reset time without ever calling it an infrastructure or Forgejo failure. It also patches the ADR 0048 classifier so a usage-block diagnostic is not misclassified as an infrastructure blocker.

## Why Now
A pinned implementer is locked to the mission's implementation work (TASK-2294.01) and cannot be silently rerouted to an unrelated family. When that family hits a weekly/daily usage limit mid-rebase, the current path both (1) refuses the only self-service recovery (a substitution) and (2) mislabels the failure as infrastructure, sending the operator to Forgejo checks that do not help. The `agent-limit` detector (`src/application/services/agent-limit.ts`) already parses usage-block reset times, and `startAgent` already records the block via `updateAgentBlock` — the rebase path and the classifier simply do not consume that signal. This is a targeted regression fix, not a new capability.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: agent-capacity handling in the rebase workflow; ADR 0048 failure-classifier catch-all misclassification of agent-capacity diagnostics

## Scope
- `src/application/rebase-workflow.ts`: the `px rebase` shared-file conflict path (`runRebaseWorkflow`, lines ~700–770). When `startAgent('conflict-resolution', { pinnedAgent: true })` throws / returns a usage-block result, either (1) select an eligible replacement family when the mission policy permits substitution, or (2) emit a final diagnostic naming the usage block and reset time. Never hard-refuse with "Parallix does not substitute another agent family for the mission implementer."
- `src/application/failure-classification.ts`: add a classifier rule so a diagnostic that names an agent usage limit / quota / rate limit (per the patterns already in `agent-limit.ts`) classifies as a repairable/agent-capacity class, NOT as `InfraBlocker`/`HumanOnly`. It must not match the `EXPLICIT_HUMAN_ONLY_DIAGNOSTIC_RE` infra markers (forgejo/token/infrastructure/network).
- Regression tests under `test/` covering the rebase-handoff path from detected usage limit through final diagnostic.
- Docs (ADR / workflow docs) updated only if a durable behavior change warrants it.

## Out of Scope
- Any change to the `px resolve-conflict` command path (separate from the rebase shared-file path).
- New agent families, launcher adapters, or `agents.json` eligibility configuration.
- Forgejo / push / credential handling.
- The general `startAgent` retry loop and `agent-limit.ts` detection heuristics (those already exist and are out of scope; this mission only consumes their output).
- Any change outside `src/application/rebase-workflow.ts`, `src/application/failure-classification.ts`, the new/updated `test/` coverage, and workflow/ADR docs.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** each criterion is falsifiable with a concrete artifact; no banned subjective adjectives or vague quantifiers.

- [ ] SC1 A usage-blocked pinned implementer during rebase conflict resolution selects an eligible replacement family when mission policy permits substitution. Verified by a test in `test/` that drives `runRebaseWorkflow` with a pinned `codex` implementer hitting a usage limit and an eligible replacement family available, asserting the launched conflict-resolution step runs as the replacement family.
- [ ] SC2 When no replacement family is eligible, the final handoff diagnostic names the agent usage block and its reset time and does not contain the tokens `forgejo`, `infrastructure`, `credential`, or the phrase "does not substitute". Verified by `test/task-2494-repro.test.ts` (red at parent, green after fix) and a dedicated assertion in the rebase-handoff test.
- [ ] SC3 `classifyError` classifies a usage-block diagnostic (e.g. "you've hit your weekly usage limit (resets …)") as a non-`InfraBlocker` class and a non-`HumanOnly` dispatch action, and `hasExplicitHumanOnlyDiagnostic` returns `false` for it. Verified by a test in `test/` asserting `failureClass !== FailureClass.InfraBlocker` and `dispatchAction !== DispatchAction.HumanOnly`.
- [ ] SC4 `./scripts/verify-local.sh all` passes on the final tree with captured proof (gate log / test names), not an unverified claim.
- [ ] SC5 ESLint and `tsc --checkJs` report clean on every changed file; no `.only` and no bare `.skip` in the test suite.
- [ ] SC6 No durable behavior change is left undocumented; any workflow or user-facing behavior change is reflected in the relevant ADR / workflow doc.

## Risks and Assumptions
- **Family-substitution policy is real, not invented.** Before substituting a family, the fix must consult the existing eligibility/selection surface (`selectAgent`, `config/agents.json` eligible lists, `pinnedAgent` semantics in `src/adapters/agents/agents.ts`). Assumption: substitution is permitted only when an eligible non-pinned family exists and policy allows; otherwise the reset-time diagnostic path applies. Verify against the config, do not assume.
- **The classifier fix must not widen the HumanOnly catch-all.** Adding a usage-block pattern risks matching legitimate infra errors that also mention "limit". The new rule must be checked before the `InfraBlocker` forgejo/network rule and must require an agent-capacity marker, not a generic "limit".
- **Reset-time parsing.** The reset time in the diagnostic should come from the already-parsed block (`agent-limit.ts` / `AgentBlockService`), not a re-derivation. Assumption: the thrown/recorded block carries a reset time; if it does not, the diagnostic states the block without a specific reset timestamp rather than fabricating one.
- **Test isolation.** Reproduction tests must use in-memory fake ports (like `test/task-2294.01-repro.test.ts`), never real Git/Forgejo/launchers.

## Checkpoints
- CP 1: Author the failing reproduction test that locks the bug (red) before any fix.
- CP 2: Fix the rebase-handoff family fallback in `src/application/rebase-workflow.ts`.
- CP 3: Fix the ADR 0048 failure-classifier so agent-capacity diagnostics are not misclassified as infrastructure.
- CP 4: Run the verification gate, static analysis, and update docs; produce the Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/task-2494-repro.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — must match a test name in the repo, e.g. `"TASK-2494 repro: usage-blocked pinned implementer during rebase conflict names the usage block and reset time, never infra/Forgejo"`
  3. **Test file paths** — must be an existing test file, e.g. `test/task-2494-repro.test.ts`, `test/rebase.test.ts`
  4. **ADR references** — must correspond to an existing file under `docs/adr/`, e.g. `ADR 0048`
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. A raw shell result alone (e.g. a `node --test` dump with no test name or file path) is NOT sufficient evidence — the weak-agent failure mode is shipping `stat`/`ls`/raw output or generic prose like "tests pass" with no recognized reference.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas
- Do not modify `src/adapters/agents/agents.ts` `startAgent` retry/fallback core logic beyond consuming its existing `applyAgentFallback` seam — the retry loop and `pinnedAgent` refusal semantics in `agents.ts` are out of scope; the fix lives in `rebase-workflow.ts` and the classifier.
- Do not touch Forgejo / push / credential code, `config/agents.json`, or launcher adapters.
- Do not add new npm dependencies.
- Do not rewrite the broader ADR 0048 dispatch table; only add a narrowly-scoped usage-block rule checked before the `InfraBlocker` rule.

## Stop Rules
- Stop before implementing any fix — this draft phase produces the mission contract only.
- Do not add a `Reproduction-Test:` line pointing at a test that does not exist or is not red at the parent commit.
- Do not run anything beyond the single `./scripts/verify-local.sh all` verification gate.
- Do not transition the task to `ready` — the harness does that after a clean draft.

Reproduction-Test: test/task-2494-repro.test.ts
