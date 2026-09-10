# CP-2 — Readiness presentation

## Summary

Recomposed the pre-integration presentation into a concise, evidence-based
readiness view and demoted the implementation-level PASS/INFO cascade behind
`DEBUG`, without weakening any check. The failing branch/PR/conflict/dirty
paths stay loud and still block; only the *successful* preflight lines moved
behind `DEBUG`, so the default happy path now carries the operator's trust
decision instead of a PASS cascade of equal visual priority.

Two additions land in the readiness view (criteria 2 and 10 are additions, not
just deletions): review approval, reviewer identity, and independence (agent
family) now come from the Mission store's own Review round; verification comes
from the integration gate result. The user's invocation of `px integrate` is
the human decision, so no row ever asserts that a human inspected the diff.

Changes:
- `src/adapters/cli/commands/integrate.ts`:
  - Added `buildIntegrationReadiness` + `printIntegrationReadiness` (the
    `READY TO INTEGRATE` evidence table) and wired it after the gate block.
  - `printIntegrationPreflight`: every successful preflight line routed through
    a `detail()` helper that emits `fmt.log.debug` only when `DEBUG` is set;
    all failure branches unchanged (still `fmt.log.fail`, still push to
    `failures`).
  - Gate block: `verificationEvidence` accumulates and feeds the `Verification`
    row; `Integration gate target:` detail line demoted to `fmt.log.debug`.
- `test/integrate.test.ts`: added a `withDebug()` helper and applied it to the
  preflight unit tests that assert on the now DEBUG-gated detail lines; the
  checks themselves are unchanged, so coverage is preserved by asking for the
  detail explicitly.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Readiness view shows review approval / reviewer / independence / verification / target / workspace, authoritative only | `buildIntegrationReadiness` in `src/adapters/cli/commands/integrate.ts` (rows Mission / Review / Reviewer / Independence / Verification / Target / Workspace) | PASS |
| Preflight checks unchanged; only successful lines demoted to DEBUG | `printIntegrationPreflight` in `src/adapters/cli/commands/integrate.ts`; failure branches still `fmt.log.fail` + `failures.push` | PASS |
| No DB/backlog authority wording / Forgejo-disabled notice on the default happy path | `printIntegrationPreflight` demotes `Backlog task: none — ... Mission store is authoritative`, `Forgejo PR/approval checks skipped`, `Mission classification` behind `detail()` | PASS |
| Preflight unit tests keep coverage behind DEBUG | `test/integrate.test.ts`, `"printIntegrationPreflight reads classification from the selected task file"`, `"printIntegrationPreflight reports token resolution and detached-head recovery command"`, `"printIntegrationPreflight reads an adhoc mission from the Mission store instead of warning about a missing task file"` | PASS |
| Trust evidence authority mapped to ADRs | `ADR 0053` (Mission store review authority), `ADR 0048` (fail-closed Forgejo recovery), `ADR 0041` (integration gate verification) under `docs/adr/` | PASS |
| Focused integrate tests pass | `npm test -- test/integrate.test.ts` → 84 passed, 0 failed | PASS |

Next action: CP-3 — make landing the primary output (destination branch +
`<before> → <after>` SHA transition) and strip the weekly-report + mission
telemetry dumps from `recordPostIntegrationStats` while keeping the recording
fail-closed; update the stats tests accordingly.
