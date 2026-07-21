# CP 3 — Active lifecycle delegation

## Summary

Delegated the active CLI handler to the composed ActiveService. The handler now
owns slug/implementer parsing, text rendering, and exit-code mapping while the
legacy adapter invokes preflight, launch/rollback, synchronization, stats, and
handoff through the approved port sequence.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC3 active usage, rejection, launch, handoff, and nonzero exit paths remain characterized | test/active.test.ts; "active() exits with agent status when execute agent returns non-zero" | PASS |
| SC4 active command crosses the application service | lib/commands/active.ts:61; lib/composition/application-services.ts:14 | PASS |
| SC5 ordered active port calls and partial cancellation evidence are asserted | test/application-services.test.ts; "active service calls strict ports in launch-record-handoff order" | PASS |
| SC6 rejected, failed, and cancelled outcomes remain typed | lib/application/active-service.ts:20; test/application-services.test.ts | PASS |
| SC7 preserves active CLI exit mapping | lib/commands/active.ts:79; test/active.test.ts | PASS |

Next action: add final no-bypass and failure-equivalence coverage, then run the declared verification gates.
