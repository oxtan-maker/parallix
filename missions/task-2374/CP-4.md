# CP-4: Bubblewrap guard tests and verification

## Summary

Added hermetic coverage for the Bubblewrap command shape and for the shared
spawn-and-tee contract. The tests mock the child process, so they do not invoke
real agent CLIs, Bubblewrap, Forgejo, or external services. They also prove an
available-but-malformed guard fails before an unsandboxed child is started.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Availability and one-time unsandboxed warning are covered | `test/bubblewrap-guard.test.ts`; `"isBubblewrapAvailable warns once that the agent runs unsandboxed"` | PASS |
| Bubblewrap preserves original child argv and spawn-tee output/exit semantics | `"wrapWithBubblewrap prefixes bwrap and preserves the original argv"`; `"spawnAndTee preserves stdout and exit status through bwrap"` | PASS |
| Broken available guard does not fall back to an unsandboxed spawn | `"spawnAndTee fails before spawning when an available guard cannot be built"` | PASS |
| Focused hermetic test suite passes | `npm test -- test/bubblewrap-guard.test.ts` | PASS |
| Required static-analysis gate passes | `./scripts/verify-local.sh static-analysis` | PASS |

Next action: hand off the committed mission implementation; all declared checkpoints and the required gate are complete.
