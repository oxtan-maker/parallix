# CP 4 — Credential-refresh diagnostic

Launch failures matching authentication, authorization, API-key, or expired-token/credential errors now emit a warning that names the family and tells the operator to re-authenticate before the existing fallback warning. The existing non-blocking classification is reused unchanged. Codex auth paths now resolve a symlink target before the narrow file bind, which keeps bwrap valid for the launcher’s linked auth setup.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC6 auth failure names the family and requests credential refresh before fallback | `test/agents.test.ts`, `"auth launch failure names the family and asks the operator to refresh credentials before fallback"` | PASS |
| SC6 non-auth failure has no refresh diagnostic | `test/agents.test.ts`, `"non-auth launch failure does not emit a credential-refresh diagnostic"` | PASS |
| Existing reroute and blocklist behavior remains covered | `test/agents.test.ts`, `"invalid-model launch failure retries without persisting a blocklist entry"`, `"non-limit launch failure with transient error retries and persists a block for non-custom agents"` | PASS |
| Existing Codex linked-auth launch tests retain valid bwrap args | `npm test -- --unit-test-headroom test/agents.test.ts` | PASS (104 pass, 1 existing skip) |

Next action: capture the post-fix argv for all four families, compare it to CP-1, then run the mission gate.
