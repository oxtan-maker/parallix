# CP 3 — Qwen credential seed

`ensureQwenHome` now copies an existing operator `oauth_creds.json` into the already worktree-local Qwen home. When no source credential exists, it leaves the established minimal-settings behavior intact.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC5 copies Qwen OAuth credentials when present | `test/qwen-launcher.test.ts`, `"qwen home copies operator OAuth credentials when present"` | PASS |
| SC5 preserves minimal settings when credentials are absent | `test/qwen-launcher.test.ts`, `"qwen home leaves minimal settings byte-identical when OAuth credentials are absent"` | PASS |
| Focused Qwen launcher suite remains within unit-test headroom | `npm test -- --unit-test-headroom test/qwen-launcher.test.ts` | PASS (24 tests) |

Next action: add the auth/expired-credential operator diagnostic before the existing fallback log, with no selection or blocklist-policy change.
