# CP-2 — Focused mocked platform-aware tests and mission verification gate

## Work done

Added six mocked tests to `test/task-2373-liveness.test.ts` and ran the mission
verification gate. The host runs Linux, so platform behaviour is exercised by
pinning `process.platform` and stubbing the one native call through the
`runNativeStartIdentity` / `readProcessStat` seams — no real `ps`, `powershell`,
or process state is ever touched.

- `macOS: one ps lookup yields a start identity that rejects a recycled pid` —
  `darwin` + stubbed `ps` returns a start time; matching identity stays live,
  mismatched identity (recycled pid) is dead.
- `macOS: an unreadable start identity falls back to the bare pid check` —
  stubbed `ps` throws → identity `null` → probe returns `true` (alive until
  proven reused).
- `native Windows: one Get-Process lookup yields a start identity that rejects a recycled pid` —
  `win32` + stubbed PowerShell returns ISO `CreationTime`; match live, mismatch dead.
- `native Windows: an unreadable start identity falls back to the bare pid check` —
  stubbed PowerShell throws → `null` → `true`.
- `Linux: /proc/<pid>/stat field 22 is the one-pid start identity source` —
  stubbed `/proc/<pid>/stat` read returns field 22.
- `WSL keeps the /proc path rather than the native Windows path` — `linux`
  platform reads `/proc`, never calls the Windows lookup.

All 12 tests in the file pass (6 pre-existing SC13/SC14 + these 6).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| macOS per-PID identity behavior | test `macOS: one ps lookup yields a start identity that rejects a recycled pid`, `test/task-2373-liveness.test.ts` | PASS |
| Windows per-PID identity behavior | test `native Windows: one Get-Process lookup yields a start identity that rejects a recycled pid`, `test/task-2373-liveness.test.ts` | PASS |
| Linux and WSL preservation | test `Linux: /proc/<pid>/stat field 22 is the one-pid start identity source` and `WSL keeps the /proc path rather than the native Windows path`, `test/task-2373-liveness.test.ts` | PASS |
| Fallback and verification | tests `macOS: an unreadable start identity falls back to the bare pid check` and `native Windows: an unreadable start identity falls back to the bare pid check`, `test/task-2373-liveness.test.ts`; `./scripts/verify-local.sh all` | PASS |

**Verification gate status:** `./scripts/verify-local.sh all` exits 0 on this
branch, rebased onto current `main`: 2190 tests, 2190 pass, 0 fail. All six
mission tests above appear in that run's output.
`./scripts/verify-local.sh static-analysis` also exits 0 with all four stages
passing (ESLint, tsc typecheck, test-hygiene, test typecheck).

The failures recorded in the previous revision of this document were caused by
a stale branch baseline, not by this mission. Rebasing onto current `main`
cleared all of them; no unrelated source or test file is modified by this
mission. The branch diff against `main` touches only
`src/adapters/process/process-liveness.ts`, `test/task-2373-liveness.test.ts`,
this mission's documents, and the mission's Backlog task file.

## Next action

All declared checkpoints are complete, the required gate passes, and the diff is
mission-scoped — hand off for Parallix lifecycle review.
