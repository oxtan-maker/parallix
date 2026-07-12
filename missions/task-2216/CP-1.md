# CP-1 — Lifecycle and capacity design

## Summary of work done

Mapped custom-agent configuration, selection, launch, and cleanup before changing production code. `startAgent` in `lib/agents/agents.ts` is the single in-process launch lifecycle owner: it resolves the chosen family, invokes its launcher, awaits the result, retries launch failures, and returns only after a clean completion. The no-output watchdog is observational; failures/signals from the launcher flow through the same awaited-result path.

The capacity guard will be an in-memory, module-scoped custom-agent reservation manager. It will use `adapters.agents.maxConcurrentCustom` from `workflow.config.json`, default to `1`, accept positive integers only, acquire immediately before invoking the custom launcher, release in `finally` after every result/exception path, and expose current availability to selection. A saturated `custom` family will be filtered after ordinary eligibility/blocklist rules, preserving the explicit no-eligible-agent error when no other agent remains.

Affected coverage: `test/product-config.test.js` for default/config validation; `test/agents.test.js` for launch completion, launch failure, signal/cancellation, thrown runtime error, and watchdog-adjacent lifecycle recovery; and selector tests in `test/agents.test.js` for capacity fallback/no-alternative outcomes. Workflow-facing documentation is `docs/agents.md`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Configuration source, default, and validation seam identified | `lib/core/product-config.ts:99`, `config/workflow.config.schema.json:95`, `test/product-config.test.js` | PASS |
| Single custom launch ownership and terminal paths mapped | `lib/agents/agents.ts:173`, `lib/agents/agents.ts:365`, `lib/agents/agents.ts:405`, `lib/agents/agents.ts:470` | PASS |
| Selector fallback seam and existing no-agent outcome identified | `lib/agents/launcher-selection.ts:149`, `lib/agents/launcher-selection.ts:158`, `lib/agents/launcher-selection.ts:189` | PASS |
| Existing hang/timeout recovery path identified | `lib/agents/agents.ts:326`, `lib/core/spawn-tee.ts:140`, `"startAgent launch failure with signal retries next agent"` | PASS |
| Focused affected tests and workflow documentation identified | `test/agents.test.js`, `test/product-config.test.js`, `docs/agents.md:16` | PASS |

Next action: Add the validated `maxConcurrentCustom` resolver and a shared reservation manager, then cover release on clean, failure, signal, and thrown-result paths.
