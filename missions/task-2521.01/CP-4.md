# CP-4: Guard 2 — executable guard against treating missions/** or Backlog task files as Mission persistence

## Summary

Added guard 2: `test/mission-persistence-authority-guard.test.ts`. It scans
every `.ts`/`.tsx` file under `src/application` and `src/interfaces` and flags
any non-comment line that resolves or persists through `missions/`, `MISSION.md`,
or `backlog/{tasks,completed,archive}`, or calls `findMissionDir`,
`missionPathForSlug`, or `missionDirForSlug`. Any such real-code reference in a file
that is not registered in `MISSION_DOCUMENT_CALL_SITES` fails the test.

The scan skips comment and JSDoc lines, so the external-intake
(`resolveTaskFile`), port-declaration, and mission-document-evidence call sites
already in the code are not flagged; the eight files that carry such real code
(`handoff-command-use-case.ts`, `integrate/preflight.ts`,
`integrate/preflight-checkout.ts`, `integrate/context.ts`, `rebase-workflow.ts`,
and the relevant port declarations) are registered in `MISSION_DOCUMENT_CALL_SITES`.

The discriminator between a permitted call site and the regression this guard
blocks is authority: ADR 0053 makes the operator database the sole Mission
persistence authority, so any application/interface code that resolves or
persists Mission state through `missions/**` or the Backlog task catalog is a
regression unless registered.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC — new application/interface Mission-persistence resolution is rejected | `test/mission-persistence-authority-guard.test.ts`, `"guard 2 fixture: rejects a new application file that resolves mission state through a helper"` | PASS |
| Legitimate call sites are exempt | The 8 entries in `MISSION_DOCUMENT_CALL_SITES`; `"guard 2 fixture: a registered call site is exempt from the guard"` | PASS |
| No false-positive on existing application/interface code | `"guard 2: every application/interface mission-document call site is registered"` passes on the final tree | PASS |
| DB-native reads are never flagged | `"guard 2 fixture: a DB-native read is never flagged"` | PASS |
| New guard passes in the suite | `npm test` → `pass 2641 fail 0` | PASS |

Next action: CP-5 — run the mission gates, finalize the goal-check, and prepare
handoff (no push to `origin`; the review remote is the sole push target).
