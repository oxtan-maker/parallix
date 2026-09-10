# CP-4 — Cleanup and final record

## Summary

Produced a concise final landing record with the destination revision and
cleanup status, closing the loop opened by the readiness view in CP-2. This is
the tail of the same committed diff as CP-3; the preflight readiness view
(`READY TO INTEGRATE`) authorizes the landing, and this landing record reports
what happened.

Final happy-path shape (all `Step N` narration removed, progress behind
`DEBUG`):

```
READY TO INTEGRATE
┌─────────┬──────────────────────────────┐
│ Mission │ parallix-adhoc-0001          │
│ Review  │ approved (round N)           │
│ ...     │ ...                          │
└─────────┴──────────────────────────────┘
All integration gates passed.
✓ integrated into main
  main  <before> → <after>
✓ mission worktree cleaned up
Next: cd ...
```

- Landing result carries the destination branch and SHA transition (see CP-3).
- Cleanup is a single `fmt.log.pass('Mission worktree cleaned up.')`; failure
  branch unchanged (still `fmt.log.fail` + `IntegrationAbort`).
- Graphify absence silenced on the ordinary success path via
  `{ log: fmt.log.debug }`.
- The empty `[INFO]` line before `Next: cd` removed.
- Gate visibility preserved (criterion 8/9): `All integration gates passed.`
  stays loud; a failed gate still prints `fmt.log.fail` and aborts.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Final record shows destination branch + landed revision | `src/adapters/cli/commands/integrate.ts`, `fmt.log.plain(\`  ${baseBranch}  ${landedFromSha} → ${mergedCommit}\`)` | PASS |
| Cleanup summarized without numbered internal steps | `src/adapters/cli/commands/integrate.ts`, `fmt.log.pass('Mission worktree cleaned up.')` (replaces `Step 7`/`Step 7 (resume)`) | PASS |
| Graphify absence silent on ordinary success path | `src/adapters/cli/commands/integrate.ts`, `maybeUpdateGraphifyOnPrimary(baseWorktree, { log: fmt.log.debug })` | PASS |
| No empty/malformed status line before `Next: cd` | `src/adapters/cli/commands/integrate.ts`, `fmt.log.info(nextActionMessage)` | PASS |
| Gates still visible; failed gate still blocks | `src/adapters/cli/commands/integrate.ts`, `fmt.log.pass('All integration gates passed.')` + unchanged `fmt.log.fail`/`IntegrationAbort` on `!result.ok` | PASS |
| Focused integrate tests pass | `npm test -- test/integrate.test.ts` → 84 passed, 0 failed | PASS |

Next action: CP-5 — re-record the real first-value recording, inspect the raw
`.cast` and rendered GIF, fix any in-scope issues, run focused files directly,
then the repository gates (`./scripts/verify-local.sh all`).
