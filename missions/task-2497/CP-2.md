# CP-2 — Authoritative landed-payload detection

Recovery asks the CLI adapter whether the mission's committed payload is
already contained in `main`. `px integrate` lands mission work with
`git merge --squash`, so a landed mission branch tip is *not* reachable from
`main`; branch ancestry therefore fails for exactly the targeted case. Detection
keys on the squash commit subject in the primary branch log instead, via the
existing `findExistingSquashCommit` seam (`src/adapters/cli/commands/integrate-conflict.ts`):

```ts
alreadyMerged: async (slug) => findExistingSquashCommit(rootDir, slug) !== null
```

An active/active mission with landed payload is refused (`action =
refused-integrated`) instead of being eligible for a second handoff. A mission
branch with no committed payload produces no squash commit, so it is never
misreported as landed and never cleaned up (F2).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Active landed mission is refused by recovery | `test/task-2446-repro.test.ts`, `"TASK-2492: an active mission already on main is refused, not re-reviewed"` | PASS |
| Detection uses authoritative payload containment (squash commit subject), not branch ancestry | `src/composition/create-cli.ts`, `findExistingSquashCommit(rootDir, slug) !== null`; verified against real squash landings in `test/task-2492-already-merged-detection.test.ts`, `"TASK-2492: squash-landed mission payload is detected as already merged"` | PASS |
| A mission branch with no committed payload is not reported as merged | `test/task-2492-already-merged-detection.test.ts`, `"TASK-2492: branch with no committed payload is not reported as merged"` | PASS |
| Detection/cleanup wiring is exercised through the real seams | `test/task-2492-already-merged-detection.test.ts`, `"TASK-2492: recover command refuses a squash-landed mission and cleans up exactly once"` | PASS |
| Existing active/done recovery remains supported | `npm test -- test/task-2446-repro.test.ts`, `"TASK-2438-shaped active task and closed aggregate reports supported recovery and resumes active"` | PASS |

Next action: prove the command path cannot begin a duplicate handoff or review after the refused-landed outcome.
