# CP-1 — macOS and native Windows per-PID start-identity lookups

## Work done

Traced the existing liveness/identity flow and added the smallest platform
branches that close the macOS/Windows PID-reuse gap without a process-table
scan, a new dependency, or elevated privileges.

- Traced the flow: `src/composition/application-services.ts:230` captures the
  publisher identity once via `processStartIdentity(process.pid)`; the board
  compares it in `probeProcessLiveness` (`src/adapters/process/process-liveness.ts`)
  against the identity of whatever now holds the pid. Both capture and compare
  already route through `processStartIdentity`, so adding platform branches there
  routes both paths.
- `processStartIdentity` now dispatches on `process.platform`:
  - Linux / WSL → `linuxStartIdentity` (unchanged `/proc/<pid>/stat` field 22,
    counted from the last `)`; `fields[19]`). WSL reports `'linux'`, so it keeps
    the `/proc` path and is never treated as native Windows.
  - macOS → `darwinStartIdentity`: one `ps -o lstart= -p <pid>` call, parsed to
    ISO-8601. No table scan (single `-p` pid).
  - native Windows → `windowsStartIdentity`: one
    `Get-Process -Id <pid> .CreationTime` PowerShell call, parsed to ISO-8601.
  - any other platform / unsupported pid → `null`.
- Conservative fail-closed everywhere: a missing utility, non-zero exit, or
  unparseable/empty output returns `null`; `probeProcessLiveness` then treats an
  unreadable identity as "still alive" (PID-only liveness) and lets TTL expiry
  govern cleanup — it never reports a false match and never throws.
- Two testability seams (`runNativeStartIdentity`, `readProcessStat`) are plain
  mutable objects so the mocked tests stub the one native call without spawning
  `ps`/`powershell` or touching real process state; production keeps the stdlib
  default.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| macOS per-PID identity behavior | `src/adapters/process/process-liveness.ts` `darwinStartIdentity` (`ps -o lstart= -p <pid>`), one pid, no scan | IMPLEMENTED |
| Windows per-PID identity behavior | `src/adapters/process/process-liveness.ts` `windowsStartIdentity` (`Get-Process -Id <pid>`), one pid, no scan | IMPLEMENTED |
| Linux and WSL preservation | `src/adapters/process/process-liveness.ts` `linuxStartIdentity` still reads `/proc/<pid>/stat` field 22; WSL stays on `'linux'` branch | UNCHANGED |
| Fallback and verification | `probeProcessLiveness` returns `true` on `null` identity, TTL expiry path intact; ESLint + `tsc` typecheck clean | STATIC ANALYSIS PASS |

Static analysis evidence (run with caches redirected off the full tmpfs):
`./scripts/verify-local.sh static-analysis` → `[1/4] ESLint clean`,
`[2/4] tsc typecheck clean`, `[3/4] test-hygiene clean`. The `[4/4] test
typecheck` stage reports two **pre-existing** errors in untouched files
`test/task-2408-board-hallucinated-content-repro.test.ts` and
`test/tui-wave-4-attention.test.ts` (read-only property assignments), confirmed
identical on clean `HEAD`; my test file typechecks clean.

## Next action

Add the focused mocked platform-aware tests (match, PID-reuse mismatch,
unreadable fallback, Linux/WSL preservation) in `test/task-2373-liveness.test.ts`
and run the mission verification gate, comparing the failure set against clean
HEAD to prove zero new failures.
