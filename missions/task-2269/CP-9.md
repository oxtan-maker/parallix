# CP-9 — Review resolution and final verification

The review found that an arbitrary Codex model value could skip every smoke
subtest. Both public integration entry points now accept only the supported
Codex pair, and the smoke harness fails closed if it is invoked directly with a
different Codex model. The unrelated handoff and review-loop changes identified
in review were removed from this mission.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CLI accepts the supported paired Codex override without shell interpolation | `lib/commands/integrate.ts:464`, `buildIntegrationGateEnv`, `"px integrate parses the paired Codex real-agent override without placing values in a command string"` | PASS |
| Invalid pairs, duplicate values, unknown options, unsupported families, and unsupported Codex models reject before gates | `lib/commands/integrate.ts:501`, `"px integrate rejects malformed real-agent options before preflight or gate execution"` | PASS |
| Script validates the same supported pair and scopes it to the smoke gate | `scripts/verify-local.sh:75`, `"verify-local integrate rejects incomplete or unsupported real-agent overrides"`, `"verify-local integrate forwards the Codex override only to custom-agent-smoke"` | PASS |
| Codex selection uses the production smoke route and fails closed for an unsupported direct override | `test/e2e-real-agent-smoke.test.js:898`, `"real-agent smoke rejects an unsupported Codex override model"`, `"real Codex gpt-5.6-luna launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` | PASS |
| No override retains the configured custom-agent path | `test/e2e-real-agent-smoke.test.js:914`, `config/integration-pipelines.json:19` | PASS |
| Operator documentation states the supported pair and fallback | `docs/real-agent-smoke.md:50` | PASS |
| Required verification gates | `./scripts/verify-local.sh static-analysis` (all four stages passed), `./scripts/verify-local.sh all` (2,167 passed, 0 failed) | PASS |

Next action: submit the verified review resolution.
