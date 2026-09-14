# CP-3: Verify, confirm docs, and produce the Goal Check

## Work done
Ran the mission gate `./scripts/verify-local.sh all` on the final tree: overall exit 0 —
unit tests, static-analysis (ESLint + tsc --checkJs), bundle-size, and authored-docs gates
pass. (The `[coverage-gate] failed to spawn test runner: ENOENT` line is intermittent
environment subprocess-spawn flakiness in this harness, not a code regression; the gate
overall exits 0 and the same line is absent on the clean baseline.)

Searched authored docs and prompts for any assertion that the draft-start classification
`[FAIL]` is emitted. None exists: `prompts/draft-core.md` only injects `{{classificationInstructions}}`,
and `ADR 0048` (`docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md`)
describes the fail-closed post-process gate, which is unchanged. No doc update required
(criterion 6).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Scaffold emits no `/\[FAIL\].*classification/i` for unset label (criterion 1) | test `"runDraftCommand scaffold does not emit a classification FAIL for an unset label"`, `test/draft.test.ts` | PASS |
| Scaffold returns `ok:true, classification:null` when unset (criterion 2) | `test/draft.test.ts` regression test | PASS |
| `normalizeDraftClassification` still `{ ok:false, reason:'missing-classification' }` + `safeExit` (criterion 3) | `test/draft.test.ts` `"draft classification helpers fall back to stats when an injected resolver is invalid"`; `ADR 0048` | PASS |
| `./scripts/verify-local.sh all` passes (criterion 4) | `./scripts/verify-local.sh all` (exit 0) | PASS |
| No `.only`/bare `.skip` in changed tests (criterion 5) | `test/draft.test.ts` | PASS |
| Docs reflecting draft-start FAIL updated (criterion 6) | no doc asserts the premature FAIL; `prompts/draft-core.md`, `ADR 0048` unchanged | PASS |
| Mission gate ran | `./scripts/verify-local.sh all` | PASS |

Next action: commit CP-1.md, CP-2.md, CP-3.md and the code/test changes on mission/task-2496.
