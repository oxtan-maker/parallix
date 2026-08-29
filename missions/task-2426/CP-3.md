# CP-3 — Prove production composition and gates

The real production entry point is exercised against an isolated `PARALLIX_HOME`: its shared board controller materializes a Mission, records a checkpoint, and records handoff NEL data. The read-only composition remains fail-closed for all three Mission commands.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Services wired: production entry point dispatches intake, checkpoint, and handoff | `test/task-2426-repro.test.ts`, `"production application services wire Mission commands through their shared controller"`, `./scripts/verify-local.sh all` | PASS |
| Services absent: read-only graph does not advertise or dispatch Mission commands | `test/task-2426-repro.test.ts`, `"read-only production controller does not advertise Mission commands"`, `./scripts/verify-local.sh all` | PASS |
| Shared and factory controllers agree on the wired capability graph | `test/task-2426-repro.test.ts`, `"wired production controller dispatches mission intake and factory agrees"`, `test/production-composition-capabilities.test.ts` | PASS |
| UI remains application-layer only | `ADR 0051`, `src/application/tui-capabilities.ts`, `./scripts/verify-local.sh static-analysis` | PASS |
| Mission authority remains the injected SQLite store | `ADR 0053`, `test/task-2426-repro.test.ts`, `./scripts/verify-local.sh all` | PASS |
| Required gates pass | `./scripts/verify-local.sh all`, `./scripts/verify-local.sh static-analysis` | PASS |

Next action: Hand off the committed mission branch for the normal Parallix lifecycle transition.
