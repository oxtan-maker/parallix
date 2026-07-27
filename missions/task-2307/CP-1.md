# CP-1: Guarded action components

Implemented the action bar, explicit confirmation dialog, and outcome banner as
pure Ink components. The action bar renders every currently declared
`BoardCommandKind` (seven in the preserved controller contract), enables only
the integrated `active:execute` action when the selected mission permits it,
and exposes the registry reason for each unavailable action.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Declared command actions render with unavailable reasons and no disabled dispatch | `src/interfaces/tui/action-bar.tsx:9`, `src/interfaces/tui/action-bar.tsx:66`, "action bar renders the declared command kinds with only active:execute enabled" | PASS |
| Consequential command displays exact command and explicit confirm/cancel keys | `src/interfaces/tui/confirmation-dialog.tsx:11`, "confirmation dialog displays the exact active application command and explicit keys" | PASS |
| Completed, rejected, failed, and cancelled outcomes have distinct indicators | `src/interfaces/tui/outcome-banner.tsx:7`, "outcome banner renders completed rejected failed and cancelled with distinct indicators" | PASS |
| Component tests use mocked data and run without workflow execution | `test/tui-action-bar.test.ts`, `test/tui-confirmation.test.ts`, `test/tui-outcome-banner.test.ts`, `node --import tsx --test test/tui-action-bar.test.ts test/tui-confirmation.test.ts test/tui-outcome-banner.test.ts` | PASS |

Next action: wire the selected mission’s guarded `active:execute` confirmation flow into `BoardShell` through an injected `BoardCommandController` boundary.
