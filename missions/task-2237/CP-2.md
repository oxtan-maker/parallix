# CP-2: AGENTS.md section and hard git push rule

## Summary

Added a "Local-only development" section to `AGENTS.md` documenting that mission branches must not be pushed to `origin` (GitHub), only `main` may be pushed to `origin`, and the `review` (Forgejo) remote is the sole push target for mission branches. Configured a hard `pre-push` git hook at `.git/hooks/pre-push` that rejects any `git push origin <non-main-branch>`. Updated two tests in `test/forgejo.test.js` to reflect the removal of `refs/remotes/origin/` from the tracking ref candidates.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3(a): AGENTS.md states mission branches must not be pushed to origin | `AGENTS.md:18` — "Mission branches must never be pushed to the `origin` (GitHub) remote" | PASS |
| SC3(b): AGENTS.md states only main may be pushed to origin | `AGENTS.md:18` — "Only the `main` branch may be pushed to `origin`" | PASS |
| SC3(c): AGENTS.md states review remote is sole push target for mission branches | `AGENTS.md:18` — "The `review` (Forgejo) remote is the sole push target for code review on mission branches" | PASS |
| SC4: Hard git push restriction prevents non-main branches from pushing to origin | `AGENTS.md:18` — hook documented as local-only with instruction-based team-wide enforcement; `.git/hooks/pre-push` tested with `git push origin mission/test-pre-push` → REJECTED | PASS |
| Test: forgejo tracking ref tests updated | `test/forgejo.test.js:505` — renamed to "createPr fails when review tracking ref is unavailable and origin is no longer a candidate"; `test/forgejo.test.js:2133` — origin ref assertion removed | PASS |
| Static analysis gate passes | `./scripts/verify-local.sh static-analysis` — ESLint, tsc, test-hygiene all PASS | PASS |

Next action: CP-3 — Clean up existing mission/* branches on origin (GitHub) and perform end-to-end verification of the checkpoint command without origin push.
