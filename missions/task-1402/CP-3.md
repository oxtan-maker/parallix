# CP-3: Failure-path coverage — hook skipped on dry-run/failure, distinct failure diagnostics

## Summary of work done

- Added two dynamic tests in `test/integrate.test.js` that invoke the real, unmocked `integrate()` command entry point (the same function `px integrate` calls) against a nonexistent slug/repo, with `postIntegrateHookModule.runPostIntegrateHook` replaced by a `node:test` `mock.method` spy:
  - `px integrate --dry-run never invokes the post-integrate hook (SC4)` — asserts `hookSpy.mock.callCount() === 0`.
  - `px integrate never invokes the post-integrate hook when preflight fails (SC4)` — same assertion for a non-dry-run preflight failure.
- Added a real, full-subprocess end-to-end scenario in `test/e2e-mission-lifecycle.test.js`:
  - `a failed integration gate aborts before the post-integrate hook can run (SC4)` — runs `draft` → `active` through the existing harness, then rewrites the **mission worktree's** `workflow.config.json` (`adapters.verification.command = 'exit 7'`) immediately before calling `px integrate <slug>` without `--no-integration-gates`. Because `px integrate`'s own gate step reads `adapters.verification.command` from the mission worktree (via `resolveIntegrationVerificationWorktree`/`buildIntegrationVerificationInvocation` in `lib/commands/integrate.ts`), this fails only the integrate gate step, not the earlier handoff gate (which already ran against the passing base config). The test asserts a non-zero exit and that the post-integrate hook marker file was never created (`postIntegrateHookLines` is `[]`).
- For the remaining two named cases — "closeout failure" and "merge failure" — proved by code structure rather than a new dynamic test, since the hook call sites are unconditionally downstream of the existing failure-throwing guards (all of which already have their own regression coverage predating this mission):
  - Variant A: `finalizeVariantACloseout` failure guard at `lib/commands/integrate.ts:658` (`if (!closeoutResult.ok) { ...; throw new IntegrationAbort(); }`) and the cleanup guard at `lib/commands/integrate.ts:674` both execute, and both `throw`, strictly before the Variant A hook call at `lib/commands/integrate.ts:678`.
  - Variant B fresh squash: the squash-merge failure guard (`lib/commands/integrate.ts:757`), squash-commit failure guard (`:793`), verification-proof guards (`:806`, `:813`), and sync-merged failure guard (`:826`) are all strictly above the Variant B hook call at `lib/commands/integrate.ts:844`.
  - Variant B resumed: the cleanup-failure guard at `lib/commands/integrate.ts:718` and the resumed sync-merged failure guard at `:706` are strictly above the resumed hook call at `lib/commands/integrate.ts:722`.
  - Each of these guards `throw new IntegrationAbort()` (or, for `reportSyncMergedFailure`, is immediately followed by one), which unwinds straight to the outer `catch` in `integrate()` — the hook line in that branch is simply never reached because JavaScript does not resume a `try` block past a thrown exception.
- Confirmed SC5 (distinct post-integrate-hook failure, not a generic merge/gate failure) at the unit level: `runPostIntegrateHookOrAbort throws IntegrationAbort and surfaces a distinct failure with hook output (SC5)` in `test/integrate.test.js` asserts the exact `[FAIL] Post-integrate hook failed (exit code 3): ./scripts/refresh-px.sh` message plus captured hook output, distinct from the pre-existing `Integration gates failed`/`Squash merge failed`/etc. messages, and that this happens before any final success message would print (the call site precedes every `fmt.log.pass('...completed...')` line in its branch, so a thrown `IntegrationAbort` prevents that line from ever running).

## Goal Check

| Success criterion | Evidence |
| --- | --- |
| SC4: hook never runs on `--dry-run` | `px integrate --dry-run never invokes the post-integrate hook (SC4)` in `test/integrate.test.js` |
| SC4: hook never runs on preflight failure | `px integrate never invokes the post-integrate hook when preflight fails (SC4)` in `test/integrate.test.js` |
| SC4: hook never runs on failed integration gate | `a failed integration gate aborts before the post-integrate hook can run (SC4)` in `test/e2e-mission-lifecycle.test.js` (real subprocess run, non-zero exit, empty hook marker) |
| SC4: hook never runs on failed closeout/squash/sync | Structural proof: all closeout/squash/sync failure guards (`lib/commands/integrate.ts:658,674,706,718,757,793,806,813,826`) sit strictly above their branch's hook call site (`:678`, `:722`, `:844`) and unconditionally `throw`/abort before reaching it |
| SC5: hook failure reports a distinct post-integrate-hook failure with hook output, no success message | `runPostIntegrateHookOrAbort throws IntegrationAbort and surfaces a distinct failure with hook output (SC5)` in `test/integrate.test.js`; call-site placement immediately before each branch's `fmt.log.pass('...completed...')` line in `lib/commands/integrate.ts:678,722,844` |

Test runs:
- `FORCE_COLOR=0 node --test test/integrate.test.js` — 59 passed, 0 failed.
- `FORCE_COLOR=0 node --test test/e2e-mission-lifecycle.test.js` — 6 passed, 0 failed (~31s).

Next action: Add the parallix-specific post-integrate hook script under `scripts/` (patch-version bump + local global reinstall) and wire it via `workflow.config.json`'s new `adapters.integrate.postIntegrateCommand` (CP4).
