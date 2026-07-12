# CP-3 — Selector behavior, documentation, and verification

## Summary of work done

Completed selector integration and workflow-facing documentation. Saturated custom capacity is now filtered after eligibility and blocklist checks, including the `WORKFLOW_AGENT=custom` override path; remaining selection rules choose from eligible working non-custom launchers. Documentation specifies the setting, default, validation, reservation/release behavior, and explicit no-alternative outcome. The code graph was refreshed with `graphify update .`.

Focused capacity tests and the required static-analysis integration gate pass. The mission-declared full verification gate is waived for the unrelated `"printIntegrationPreflight PR approval failures"` failure: the out-of-scope fixture change was reverted, and the same test fails on `main` at `352836626` after `npm run build:cjs` with `AssertionError` at `test/task-1039-integrate-v3.test.js:111`. The failure does not exercise the custom-capacity paths. The artifact-focused lifecycle fixture completes successfully under the full suite.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Documented key defines maximum, default, and invalid-value behavior | `config/workflow.config.schema.json:99`, `docs/agents.md:40`, `"validateWorkflowConfig rejects invalid maxConcurrentCustom values"` | PASS |
| Active custom instances cannot exceed the configured maximum; one release permits one replacement | `lib/agents/custom-capacity.ts:12`, `lib/agents/custom-capacity.ts:16`, `"custom capacity releases after clean completion, launch failure, signal cancellation, and rejected runtime result"` | PASS |
| Completion, launch failure, runtime rejection, cancellation signal, and watchdog-adjacent lifecycle release capacity | `lib/agents/agents.ts:329`, `lib/agents/agents.ts:383`, `"custom capacity releases after clean completion, launch failure, signal cancellation, and rejected runtime result"`, `"startAgent logs no-output diagnostics with agent, step, and child pid"` | PASS |
| Saturation selects an eligible non-custom family and preserves explicit no-agent exhaustion | `lib/agents/launcher-selection.ts:154`, `lib/agents/launcher-selection.ts:159`, `"custom capacity saturation selects an eligible non-custom agent and preserves explicit exhaustion"` | PASS |
| Changed behavior is documented and changed production code passes static analysis | `docs/agents.md:42`, `./scripts/verify-local.sh static-analysis` | PASS |
| Mission-declared full verification gate | `main` at `352836626`: `npm run build:cjs && node --test test/task-1039-integrate-v3.test.js` reproduces `"printIntegrationPreflight PR approval failures"` at `test/task-1039-integrate-v3.test.js:111`; `./scripts/verify-local.sh all` on this branch reports 2,094 passed and this one identical failure | WAIVED (pre-existing) |

Next action: Re-review the mission with the unrelated fixture change removed and the main-branch verification waiver evidence recorded.
