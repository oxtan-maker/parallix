---
id: TASK-1288
title: Verify vibe/mistral telemetry once usage-unblocked
status: backlog
assignee: []
created_date: '2026-06-13 18:09'
updated_date: '2026-06-13 18:15'
labels:
  - ai_sdlc
dependencies:
  - TASK-1285
priority: low
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Follow-up to task-1285 (telemetry credibility).

The mistral/vibe launcher telemetry path is currently BLOCKED and recorded as honest zeros via `parallix/lib/agents/mistral-telemetry.js` (`extractMistralTelemetry()` always returns null; provider/model fall back to "mistral").

## Missing evidence (why it could not be collected in the task-1285 environment)
- Mistral Vibe in programmatic mode emits no token-usage data to stdout/stderr (`MISTRAL_SESSION_ID_RE = null` in `parallix/lib/agents/mistral.js`; `--output text` is human-readable, not parseable for token counts).
- No CLI endpoint to query per-session usage.
- `VIBE_ACTIVE_MODEL` is model-selection only, not a usage source.
- Vibe writes `~/.vibe/logs/session/session_<ts>_<id>/meta.json`, but the structure is undocumented and not verified stable, and the account was usage-blocked in this environment so a live capture could not be proven.

## Done when
- Run a real vibe/mistral launch once the account is no longer usage-blocked and capture a sample of any structured usage artifact (stdout JSON or `meta.json`).
- If a stable structured source exists, implement `extractMistralTelemetry()` to parse it and add a fixture-backed test (mirror `parallix/test/codex-telemetry.test.js`).
- If no stable source exists, document the negative result in `mistral-telemetry.js` and keep honest zeros.
<!-- SECTION:DESCRIPTION:END -->
