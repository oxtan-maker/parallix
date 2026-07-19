# CP-3: Capacity preflight, resource classification, and verification

## Summary

Added a deterministic temporary-capacity preflight before the smoke fixture is created. Insufficient or unreadable capacity is reported as `environment-resource` and explicitly identifies temporary-storage exhaustion. The smoke classifier now recognizes ENOSPC and Git index/lock creation errors as the same environment/resource category. Handoff preserves the original Git push failure detail instead of replacing it with a generic handoff error. Repeated smoke-capture runs assert that no owned artifacts remain beneath their configured temporary root. The review follow-up also inventories the integration noise-patch, red/green worktree, and mutation-gate writers; the integration reset-error path now removes its own noise-patch directory.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 inventory identifies every in-scope writer and responsibility | `missions/task-2241/CP-2.md:7`, `lib/commands/integrate.ts:57`, `lib/tools/redgreen.ts:63`, `lib/commands/mutation-gate.ts:239` | PASS |
| SC2 owned writers clean on successful and applicable failure paths, with opt-in retention | `"prepareNoisePatchForSquash cleans only its owned patch directory when reset fails"`, `"real-agent smoke captures clean up after normal, command-failure, and timeout runs"`, `"captureOpencodeExport retains only its owned temporary directory when opted in"` | PASS |
| SC3 smoke stdout/stderr cleanup covers normal, launcher failure, and timeout | `test/e2e-real-agent-smoke.test.js:521`, `"real-agent smoke capture removes its first stdout file when stderr capture setup fails"` | PASS |
| SC4 cleanup does not recursively delete operator or concurrent paths | `lib/commands/integrate.ts:72`, `"prepareNoisePatchForSquash cleans only its owned patch directory when reset fails"`, `"real-agent smoke capture retention is opt-in and never deletes operator or concurrent paths"` | PASS |
| SC5 completed repeated runs leave no accumulating owned residue | `"repeated real-agent smoke capture runs leave no Parallix-owned residue beneath the configured temporary root"` | PASS |
| SC6 preflight occurs before fixture creation and reports capacity exhaustion as environment/resource | `test/e2e-real-agent-smoke.test.js:240`, `test/e2e-real-agent-smoke.test.js:598`, `"real-agent smoke preflight reports temporary-storage exhaustion before fixture creation"` | PASS |
| SC7 handoff preserves Git storage detail and smoke reporting classifies it as environment/resource | `lib/commands/handoff.ts:676`, `"performHandoff fails when git push fails"`, `"real-agent smoke classifies ENOSPC and Git index/lock failures as environment resources"` | PASS |
| SC8 required repository verification has no focused or unannotated skips | `./scripts/verify-local.sh all` (passed on the final mission tree) | PASS |

Next action: retain this committed checkpoint evidence for Parallix's lifecycle handoff; do not run lifecycle commands from this worktree.
