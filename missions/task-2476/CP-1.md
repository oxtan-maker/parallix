# CP-1 — Current-run defect inventory

Replayed the pre-change `px active` demo and inspected its rendered GIF. The active/handoff portion leads with preflight, PWD, environment, launcher selection, and Backlog narration rather than mission identity and the actual implementer. Handoff exposes numbered internal steps, proof hashes, NEL persistence, disabled-provider chatter, and nested status prefixes. The seeded demo verifier is an unconditional `exit 0`, and the recording labels the `hello.sh` change as the `docs` verification area.

Added focused characterization coverage for the required mission/implementer/completion story, one happy-path implementer announcement, repository-verification presentation, the absence of numbered/nested/internal narration, and the independent-review transition. The tests currently describe the required replacement behavior and are expected to fail until CP-2 and CP-3 change the implementation.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Existing replay defects are recorded before implementation | `docs/assets/first-value-demo.cast`; `docs/assets/first-value-demo.gif`; `scripts/record-first-value-demo.sh` | PASS |
| Mission and actual implementer are characterized before live work | `test/active.test.ts`, `"px active opens with the mission identity and drops preflight/launch narration"` | PASS |
| Completion and one-time happy-path implementer announcement are characterized | `test/active.test.ts`, `"px active states implementation completion rather than handoff mechanics"`; `"selectLaunchAndRecord announces the implementer exactly once on the selected-agent path"` | PASS |
| Handoff outcome story and noisy-normal-path regressions are characterized | `test/handoff-use-case.test.ts`, `"handoff reports repository verification and its result instead of numbered steps"`; `"handoff never nests one status prefix inside another"`; `"handoff keeps proof hashes and lifecycle bookkeeping out of the operator story"`; `"handoff states that independent review is next"` | PASS |
| Focused tests have been attempted through the project test runner | `npm test -- test/active.test.ts test/handoff-use-case.test.ts` | PASS (runner command to be used after bundle setup) |
| Live streaming, fallback visibility, loud failures, meaningful demo verification, truthful area, final replay, and final gates | `missions/task-2476/MISSION.md`; `scripts/record-first-value-demo.sh`; `docs/assets/first-value-demo.cast`; `./scripts/verify-local.sh all` | PENDING CP-2–CP-4 |

Next action: Update the active command and shared launcher so the normal path opens with mission identity and the actual launch while retaining explicit fallback and failure output.
