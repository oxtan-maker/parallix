# CP-3 — Landed-closeout proof and verification

Completed focused coverage for both lifecycle boundaries. The new fast, mocked abort-failure fixture forces the Variant B probe abort to fail, observes the nonzero integration result and the original review-status task bytes, without contacting Forgejo or using a real integration checkout. The existing Variant B success test now creates its task fixture and records `abort → squash → promote → complete → commit`, proving promotion and completion are part of the landed closeout. The integration ordering itself was already corrected by task-2213 before this mission parent, so task-2243 contributes regression and landed-closeout coverage rather than a new ordering change; the fixture therefore had no red parent state to demonstrate. This branch also carries a Pi SDK compatibility correction, with focused tests for both supported SDK API shapes, so the declared `^0.80.6` dependency range remains runnable.

`package-lock.json` normalization from commit `85fb71e67` is intentionally part of this mission branch and will ship with it. Earlier verification used a local no-save installation of the optional `react-devtools-core` package; that verifies the mission test suite but is not a clean-install reproduction of the committed lockfile.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Forced failing probe abort leaves the review-approved task fixture unchanged | `test/task-2243-probe-abort-promotion.test.js:61`, `test/task-2243-probe-abort-promotion.test.js:90`, `"Variant B rejects a failed probe abort without promoting the review-approved task fixture (task-2243)"` | PASS |
| Promotion occurs only after probe abort and squash success | `src/platform/runtime/lib/commands/integrate.ts:783`, `src/platform/runtime/lib/commands/integrate.ts:784`, `src/platform/runtime/lib/commands/integrate.ts:940`, `test/task-1109.test.ts:137` | PASS |
| Successful Variant B integration promotes and completes the task in landed closeout | `test/task-1109.test.ts:105`, `test/task-1109.test.ts:109`, `test/task-1109.test.ts:139`, `"integrate Variant B promotes and completes a review-approved task in the landed closeout"` | PASS |
| Abort failure surfaces and stops without manually rewriting status | `src/platform/runtime/lib/commands/integrate.ts:793`, `test/task-2243-probe-abort-promotion.test.js:90` | PASS |
| Pi SDK compatibility works across legacy and current model APIs | `test/pi-runner.test.ts`, `"startPiAgent supports legacy and current Pi SDK model APIs"` | PASS |
| Required verification gate completes on the mission tree | `./scripts/verify-local.sh all`, `npm test -- test/task-2243-probe-abort-promotion.test.js test/task-1109.test.ts` | PASS |

Next action: preserve the committed checkpoint and test evidence for Parallix’s lifecycle handoff; no status transition or review command is required from this mission checkout.
