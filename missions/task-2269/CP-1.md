# CP-1 — Trace and parser boundaries

Added focused integration parser and dispatcher coverage for the paired real-agent
override. The CLI parser validates unknown, missing, duplicate, incomplete, and
unsupported options before integration preflight; the integration script accepts the
same pair and isolates its dedicated environment values to `custom-agent-smoke`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Paired override is parsed without shell-command interpolation | `lib/commands/integrate.ts:461`, `"px integrate parses the paired Codex real-agent override without placing values in a command string"` | PASS |
| Invalid pairs stop before gates or merge work | `lib/commands/integrate.ts:608`, `"px integrate rejects malformed real-agent options before preflight or gate execution"` | PASS |
| Script scopes the override to the smoke gate | `scripts/verify-local.sh:160`, `"verify-local integrate forwards the Codex override only to custom-agent-smoke"` | PASS |
| No-override integration command remains configured | `config/integration-pipelines.json:19`, `test/e2e-real-agent-smoke.test.js` | PASS |

Next action: complete the Codex production-adapter fixture selection and run its focused smoke selection coverage.
