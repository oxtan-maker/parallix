# CP-1 — Failing rebound landing reproduction

Added the declared regression reproduction for a rebounded Mission whose lifecycle completion rejects during landing. It requires that rejection before Forgejo synchronization, so the current ordering fails without performing a real remote action.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC2 pre-landing abort has zero remote effects | `test/task-2517-integrate-rebound-landing-guard.test.ts` — `TASK-2517: rebounded landing aborts before Forgejo sync when integration is ineligible` | Reproduction authored; awaiting execution outside this sandbox |
| Declared reproduction is present | `test/task-2517-integrate-rebound-landing-guard.test.ts`; `Reproduction-Test:` in `missions/task-2517/MISSION.md` | Complete |

Next action: Run `./scripts/verify-local.sh all` where tsx IPC sockets are permitted, then commit CP-1; draft remains locked before CP-2.
