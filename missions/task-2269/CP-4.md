# CP-4 — Documentation and verification

Documented the explicit self-development invocation, required paired flags,
Codex/model prerequisite, and no-override custom fallback in the real-agent smoke
operator guide. Focused parser and dispatcher tests, build, shell syntax validation,
and the direct Codex `gpt-5.6-luna` probe completed successfully. The final general
verification gate is blocked by the host's Apple Git 2.24.3, which lacks `git init
-b` and causes existing unrelated test fixtures to fail.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CLI parses and forwards one Codex/model pair without command interpolation | `lib/commands/integrate.ts:450`, `lib/commands/integrate.ts:461`, `"px integrate parses the paired Codex real-agent override without placing values in a command string"` | PASS |
| Invalid pair, duplicate, missing value, unknown option, and unsupported family reject before work starts | `lib/commands/integrate.ts:610`, `"px integrate rejects malformed real-agent options before preflight or gate execution"` | PASS |
| Script validates the pair and scopes it to `custom-agent-smoke` | `scripts/verify-local.sh:76`, `scripts/verify-local.sh:217`, `"verify-local integrate forwards the Codex override only to custom-agent-smoke"` | PASS |
| Codex fixture uses the production adapter with the requested model and preserves lifecycle assertions | `test/e2e-real-agent-smoke.test.js:305`, `"real Codex gpt-5.6-luna launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` | PASS |
| No override retains the custom runner and unchanged configured smoke command | `test/e2e-real-agent-smoke.test.js:884`, `config/integration-pipelines.json:19` | PASS |
| Operator documentation defines the exact opt-in interface and fallback | `docs/real-agent-smoke.md:50` | PASS |
| Required static-analysis gate | `./scripts/verify-local.sh static-analysis` | PASS |
| Required general gate | `./scripts/verify-local.sh all`, `test/agents-limit-hit.test.js:385` fails on host Git 2.24.3 because `git init -b` is unsupported | BLOCKED |

Next action: install or select Git 2.28+ on this workstation, then rerun `./scripts/verify-local.sh all` before review handoff.
