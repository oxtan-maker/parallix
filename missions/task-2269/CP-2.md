# CP-2 — Validated integration forwarding

Implemented the paired `px integrate` real-agent option parser and added its
dedicated forwarding environment. `scripts/verify-local.sh integrate` now validates
the same pair and removes both values for every non-smoke gate before calling the
configured gate command.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CLI accepts one Codex/model pair as structured values | `lib/commands/integrate.ts:461`, `"px integrate parses the paired Codex real-agent override without placing values in a command string"` | PASS |
| CLI rejects incomplete, missing, duplicate, unknown, and unsupported options before preflight | `lib/commands/integrate.ts:608`, `"px integrate rejects malformed real-agent options before preflight or gate execution"` | PASS |
| Integration dispatcher passes values only to the smoke process | `scripts/verify-local.sh:165`, `"verify-local integrate forwards the Codex override only to custom-agent-smoke"` | PASS |
| Other gates and no-override command retain their contract | `config/integration-pipelines.json:19`, `"buildIntegrationGateEnv forwards the validated Codex override as dedicated environment values"` | PASS |

Next action: finish the controlled Codex lifecycle smoke run, then record its exact result and update final operator documentation evidence.
