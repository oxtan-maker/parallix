# CP-1: real-agent smoke path defined and wired into blocking gates

## Work Done

Defined the Tier 2 real-agent smoke path as a separate blocking test that uses
the production `custom` launcher surface without weakening the existing stubbed
workflow harness.

### Implementation evidence

1. Added `test/e2e-real-agent-smoke.test.js` as the dedicated real-agent entry
   point.
   - The test calls the real CLI (`px`) and requires the real `opencode`
     binary on `PATH`; it does not install the stubbed `opencode` fixture used
     by `test/e2e-mission-lifecycle.test.js`.
   - The pinned local model is
     `vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`.
   - The test classifies failures into `local-model-environment`,
     `opencode-launcher-failure`, and `parallix-workflow-failure`.

2. Kept the deterministic Tier 1 harness intact.
   - `config/integration-pipelines.json` still runs
     `npm run build:cjs && node test/e2e-mission-lifecycle.test.js` as the
     `workflow` gate.
   - The new real-agent path is additive via the `custom-agent-smoke` gate:
     `node test/e2e-real-agent-smoke.test.js`.

3. Documented the operator contract in `docs/real-agent-smoke.md`.
   - The doc states the gate is blocking.
   - It records the pinned model, expected runtime, lifecycle depth, and the
     three failure buckets.

4. Verified that unrelated previously approved protections remain present in the
   current tree.
   - Build-freshness preflight remains wired in `index.ts` and `px.ts`.
   - The workflow gate still rebuilds before running.
   - Codex/Mistral spurious-exit handling and Mistral runtime isolation remain
     in `lib/agents/`.
   - Round 2 review follow-up restored the task-1415 and task-1417 protections
     that had been unintentionally reverted in this branch, including
     `recordPostIntegrationStats` date handling, publish/verification
     build-freshness guards, their regression tests, and the archived
     workflow-history artifacts for those tasks.

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Dedicated real-agent smoke entry point exists | `test/e2e-real-agent-smoke.test.js` | PASS |
| Smoke test uses the production launcher contract | `test/e2e-real-agent-smoke.test.js` resolves `opencode` from `PATH` and symlinks the real binary into the throwaway repo `bin/` | PASS |
| Pinned local-model configuration is explicit | `PINNED_CUSTOM_MODEL = 'vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit'` in `test/e2e-real-agent-smoke.test.js` | PASS |
| Blocking integration gate wiring is present | `config/integration-pipelines.json` contains `custom-agent-smoke: node test/e2e-real-agent-smoke.test.js` and preserves `workflow: npm run build:cjs && node test/e2e-mission-lifecycle.test.js` | PASS |
| Operator documentation exists | `docs/real-agent-smoke.md` documents prerequisites, invocation, runtime, lifecycle depth, and failure interpretation | PASS |
| Deterministic workflow harness still passes | `npm run build:cjs && node test/e2e-mission-lifecycle.test.js` on 2026-07-04: 6 tests passed | PASS |
| Static-analysis gate passes | `./scripts/verify-local.sh static-analysis` on 2026-07-04: ESLint, typecheck, and test-hygiene all passed | PASS |
| Real-agent gate was exercised locally at least once | `node test/e2e-real-agent-smoke.test.js` on 2026-07-04 failed with `[local-model-environment] opencode binary not found on PATH` | PASS |
| Round-2 scope regressions were removed from the branch diff | `recordPostIntegrationStats`, `publish:guard`/`prepack`, verification freshness checks, task-1415/task-1417 tests, and backlog/mission history now match base `0ddbff705125131eb3b758e48a9331540279858e` again | PASS |

## External prerequisite note

The real-agent smoke gate could not pass on this workstation because `opencode`
is not installed on `PATH`. This is an environment prerequisite failure, not a
Parallix launcher or workflow failure. The test reported the exact expected
bucket and model requirement:

- Bucket: `local-model-environment`
- Missing prerequisite: `opencode` binary
- Pinned model required once `opencode` is installed:
  `vllm/cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit`

## Next action

Proceed with review using the current branch state. To get the blocking
real-agent gate green on this workstation, install `opencode` and make the
pinned local model available to `opencode models`.
