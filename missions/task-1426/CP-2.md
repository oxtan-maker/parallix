Checkpoint 2 extracted the launcher registry, PATH/probe hook, eligibility and selection logic, support assertion, and watchdog resolution into `lib/agents/launcher-selection.ts`. `lib/agents/agents.ts` now re-exports those helpers and keeps the public caller surface stable while deferring launcher concerns to the new module.

## Goal Check
| Criterion | Evidence | Status |
|---|---|---|
| Launcher registry and launcher health probing moved out of `agents.ts` | `lib/agents/launcher-selection.ts:24`, `lib/agents/launcher-selection.ts:31`, `lib/agents/launcher-selection.ts:70`, `lib/agents/launcher-selection.ts:242` | PASS |
| Eligibility, weighted selection, support assertion, and watchdog resolution moved out of `agents.ts` | `lib/agents/launcher-selection.ts:105`, `lib/agents/launcher-selection.ts:118`, `lib/agents/launcher-selection.ts:128`, `lib/agents/launcher-selection.ts:187`, `lib/agents/launcher-selection.ts:217` | PASS |
| Existing callers still receive the same helper exports through the aggregator | `lib/agents/agents.ts:483`, `test/agents.test.js`, "workflowLauncherStatus rejects a launcher that exists but fails its health probe", "selectAgent weighted result always stays within the available set", "assertAgentSupported throws loudly for an unknown agent name", "resolveNoOutputWatchdogConfig returns draft-specific defaults when step is draft" | PASS |

Next action: finish the orchestration-only cleanup in `lib/agents/agents.ts`, refresh the knowledge graph with `graphify update .`, and run the mission gates `./scripts/verify-local.sh all` plus `./scripts/verify-local.sh static-analysis`.
