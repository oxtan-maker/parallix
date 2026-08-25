# CP-4 — End-to-end strand resistance and exhaustion dossier

## Summary

Revalidated the recovery chain from source and executable tests rather than
accepting earlier checkpoint claims. Direct handoff, publication, review
timeouts, artifacts, gates, hooks, and the legacy repair seam use the rebound
kernel for shared policy while their adapters retain exact stage prompts and
collaborators.

- **Exhaustion dossier** (`test/task-2413-recovery-dossier.test.ts`, hermetic —
  injected `startAgent`/`verify`, no git/agent/Forgejo): asserts an exhausted
  occurrence retains `outcome`, `attempts` (every spent attempt), the root
  `classification` (`GateFailure`/`AutoSendBack`/`PRE-REVIEW GATE FAILURE`), the
  `implementer`, and the **final** `diagnostic` — not a collapsed generic
  "Manual intervention required" wrapper that would misclassify the incident.
- **Publication seam** (`test/task-2413-publication-seam.test.ts`, integration):
  drives the real `captureVerifiedTreeProof` through the real `createPr` against
  a temp Git repo with a failing, output-emitting verification command and
  asserts the captured stdout/stderr + exit code survive in `createPr.error`.
- **Root of the loss** (`test/task-2413-repro.test.ts`, integration): the
  red-to-green reproduction — at the parent commit the verifier loss was
  exit-code-only; after the `stdio: 'pipe'` + structured-return fix the captured
  output and exit code are asserted present.
- **Proof reuse / reclassification** (`test/task-2413-proof-reuse.test.ts`):
  stale/mismatched/changed-tree/changed-command proofs cannot authorize
  publication; a materially changed failure is reclassified from its own
  structured evidence.
- **Direct handoff + transient verifier** (`test/handoff-use-case.test.ts`,
  hermetic): a final gate failure reaches the kernel with its exact command,
  worktree, exit status, and captured output; `unit-test-budget:exceeded`
  retries the unchanged verifier before any agent launch and is never
  classified as a Git-hook failure. The public handoff CLI enables this kernel
  path by default and exposes `--no-recover` as an operator reporting boundary;
  the use-case default remains fail-closed for non-CLI callers.
- **All timeout consumers** (`test/review.test.ts`, hermetic): reviewer and
  implementer timeout recovery use `rebound()` with the same attempt
  denominator, original review/act-on-review prompt, opposite-role exclusion,
  fallback persistence, launch callback, verification callback, and exhaustion
  dossier. Unlimited round budgets no longer collapse to zero attempts.
  The persisted-reviewer continuation test injects the pre-review gate and Git
  collaborators, so it cannot execute the real verifier or remote operations.
- **Legacy seam** (`test/repair-handoff.test.ts`): `buildRelaunchPrompt` is a
  compatibility delegate to `buildReboundFixPrompt`; the adapter supplies the
  exact Goal Check or gate-repair instructions and post-return command as prompt
  slots rather than owning a second generic retry framework.
- **Bounded publication capture** (`test/task-2413-repro.test.ts`): raw
  `spawnSync` output above 1 MiB is captured with explicit UTF-8/10 MiB process
  buffering and reduced to bounded evidence without `ENOBUFS` or Buffer/string
  errors.
- **Adapter-declared transient handling** (`test/task-2413-repro.test.ts`): only
  exact verification-adapter budget markers set the structured transient flag;
  the kernel does not infer retry policy from arbitrary diagnostic prose.
- **Checkpoint defense remains usable** (`test/gitignore.test.ts`): ignored
  source detection still blocks ignored mission source, while excluding the
  operator-local `.workflow/` cache that Parallix creates itself.
- **Malformed reviewer evidence rebounds** (`test/review-artifacts.test.ts`):
  request-changes findings without parser-stable `F<n>` headings are reported
  as repairable artifact evidence with the exact required format, rather than
  being mislabeled as a persistence outage and parked for a human.
- **Integration-only retry guardrails** (`test/handoff.test.ts`,
  `test/rebase-use-case.test.ts`): nested gatekeeper remediation explicitly
  disables the kernel's separate launcher retry so its recursive handoff
  budget cannot multiply; hook exhaustion names the implementer-repair budget
  actually spent. The final dossier records successful-check status and a
  stage-specific safest next command, and artifact prompts substitute the real
  mission slug in `px handoff <slug>`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Structured root failure preserved (command/cwd/exit/output) | `test/task-2413-repro.test.ts`, `"task-2413: publication verifier failure preserves the structured root failure"` | PASS |
| Publication verifier failure carries captured output through createPr | `test/task-2413-publication-seam.test.ts`, `"task-2413: publication verifier failure carries captured output through createPr"` | PASS |
| Exhaustion dossier retains root failure, attempts, final diagnostic | `test/task-2413-recovery-dossier.test.ts`, `"task-2413: an exhausted recovery retains the structured root-failure dossier"` | PASS |
| Dossier carries the final diagnostic, not the first | `test/task-2413-recovery-dossier.test.ts`, `"task-2413: the exhaustion dossier carries the final diagnostic, not the first"` | PASS |
| Stale/mismatched proof cannot authorize publication | `test/task-2413-proof-reuse.test.ts`, `"task-2413: a stale/mismatched proof cannot authorize publication"` | PASS |
| Changed failure reclassified from its own evidence | `test/task-2413-repro.test.ts`, `"task-2413: a materially changed failure is reclassified from its own evidence, not the prior class"` | PASS |
| Direct handoff prompt includes root gate evidence | `test/handoff-use-case.test.ts`, `"direct handoff recovers a gate failure through the kernel with its exact process evidence"` | PASS |
| Public handoff CLI enables bounded gate repair | `test/handoff-use-case.test.ts`, `"handoff CLI default performs bounded gate repair through the real use case"` | PASS |
| Public handoff CLI can decline automatic repair | `test/handoff-use-case.test.ts`, `"handoff CLI --no-recover keeps a failed gate at the reporting boundary"` | PASS |
| Slow test budget reruns before agent launch | `test/handoff-use-case.test.ts`, `"direct handoff retries a slow-test verifier result before it disturbs an agent"` | PASS |
| Reviewer and implementer timeouts use the kernel | `test/review.test.ts`, `"startReviewLoop handles reviewer polling timeout with recovery"`; `"startReviewLoop performs the implementer recovery relaunch without persisting any retry count"` | PASS |
| Timeout relaunches retain role prompt, exclusion and fallback collaborators | `test/review.test.ts`, `"startReviewLoop performs recovery relaunches without persisting any retry count"`; `"startReviewLoop performs the implementer recovery relaunch without persisting any retry count"` | PASS |
| Persisted-reviewer continuation is hermetic | `test/review.test.ts`, `"startReviewLoop continue falls back to the persisted reviewer when an explicit override is unsupported"` | PASS |
| Local artifact persistence failures retain neutral infrastructure evidence | `test/review.test.ts`, `"startReviewLoop preserves an implementer artifact infrastructure failure during timeout recovery"` | PASS |
| Legacy repair prompt has no competing authority | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt is a compatibility delegate to the evidence-preserving rebound prompt"` | PASS |
| Publication capture is bounded and raw-spawn safe | `test/task-2413-repro.test.ts`, `"raw spawn capture safely bounds verifier output above the Node default buffer"` | PASS |
| Transient policy is adapter-declared | `test/task-2413-repro.test.ts`, `"only adapter-declared verifier markers receive a transient rerun"` | PASS |
| Resolved area command permits real proof reuse | `test/task-2413-proof-reuse.test.ts`, `"publication reuse matches the handoff command after area placeholder resolution"` | PASS |
| Focused recovery regressions green | `npm test -- test/task-2413-proof-reuse.test.ts test/task-2413-repro.test.ts test/task-2377.03-rebound-kernel.test.ts test/handoff-use-case.test.ts test/repair-handoff.test.ts test/review.test.ts` → 253 pass, 0 fail | PASS |
| Static analysis including test typecheck clean | `./scripts/verify-local.sh static-analysis` | PASS |
| Checkpoint ignored-source defense excludes operator cache only | `test/gitignore.test.ts`, `"ignored-source defense skips operator-local workflow caches"` | PASS |
| Malformed reviewer findings retain an actionable repair diagnostic | `test/review-artifacts.test.ts`, `"consumeReviewerArtifacts treats malformed request-changes findings as repairable evidence"`; `test/review-prompts.test.ts`, `"buildCompactReviewPrompt inlines the contract instead of redirecting to docs/agent-prompts"` | PASS |
| Nested handoff remediation cannot multiply launcher and repair budgets | `test/handoff.test.ts`, `"performHandoff attempts agent relaunch when gatekeeper posts pushback"`; `"performHandoff respects bounded retry limit of 2 for gatekeeper pushback"` | PASS |
| Exhaustion names the spent currency and retains safest next action | `test/rebase-use-case.test.ts`, `"rebase use case strands a hook failure after two failed rebase --continue re-runs"`; `test/task-2413-recovery-dossier.test.ts`, `"task-2413: an exhausted recovery retains the structured root-failure dossier"` | PASS |
| Artifact repair prompt substitutes its exact post-return command | `test/handoff.test.ts`, `"performHandoff attempts agent relaunch when gatekeeper posts pushback"` | PASS |
| Declared final gate clean | `./scripts/verify-local.sh all` → 2159 pass, 0 fail, 0 skipped, no unit-budget violations | PASS |

Run:
- `node --experimental-test-module-mocks --import tsx --test test/task-2413-recovery-dossier.test.ts`
- `node --experimental-test-module-mocks --import tsx --test test/task-2413-publication-seam.test.ts`
- `node --experimental-test-module-mocks --import tsx --test test/task-2413-repro.test.ts test/task-2413-proof-reuse.test.ts`

## Correction

The prior claim that test typecheck failures were pre-existing on `main` is
withdrawn. Static analysis now passes all four stages on this mission tree.
TASK-2414 remains parked in backlog to make that existing static-analysis
command unconditional and merge-blocking in every integration plan; this
mission does not run the integration-only workflow during active-to-review
handoff.

## Next action

Checkpoint the integration-only retry corrections, publish the changed head,
obtain a fresh review verdict, and rerun `px integrate task-2413`.
