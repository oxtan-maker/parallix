# CP-3 — Agent-family smoke fixture

Generalized the real-agent smoke fixture so it selects `custom` by default or
Codex when both dedicated override values are present. The Codex route writes its
model into the disposable workflow config, puts a fixture-controlled `codex`
executable first on `PATH`, and keeps the existing lifecycle and isolation
assertions intact.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Codex production adapter receives `gpt-5.6-luna` in the disposable lifecycle fixture | `test/e2e-real-agent-smoke.test.js:311`, `test/e2e-real-agent-smoke.test.js:421` | PASS |
| Codex lifecycle has an exact named test | `"real Codex gpt-5.6-luna launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` | PASS |
| Default remains custom runner/model behavior | `test/e2e-real-agent-smoke.test.js:879`, `config/integration-pipelines.json:19` | PASS |
| Codex model capability is available on this workstation | `test/e2e-real-agent-smoke.test.js`, `codex exec --sandbox danger-full-access -m gpt-5.6-luna` | PASS |

Next action: collect the controlled Codex lifecycle result, run both declared verification gates, and publish CP-4 documentation evidence.
