---
id: TASK-2413
title: 'Make recovery actionable, evidence-preserving and non-stranding'
status: backlog
assignee: [codex]
created_date: '2026-08-24 17:46'
labels: [ai_sdlc, bug]
dependencies: []
ordinal: 119917
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

Parallix now has a central `rebound-kernel.ts`, but recovery is still split across handoff, review, rebase, artifact handling, timeout recovery and the legacy `repair-handoff.ts` path.

This causes agent-fixable failures to become stranded because Parallix loses the real diagnostic, gives an ambiguous repair prompt, consumes the wrong retry budget, or retries a different failure under the old classification.

A concrete production failure on `task-2373.01` exposed the problem:

1. Handoff verification was able to pass.
2. Forgejo publication subsequently ran verification again on the same tree.
3. The second run failed because the verification suite was timing-sensitive under host contention.
4. The detailed verifier output was discarded and propagated only as:
   `Forgejo PR creation/update failed: verification gate failed ... with exit code 1`
5. The implementer was relaunched with a generic HANDOFF VERIFICATION FAILURE prompt and had to rediscover the actual verifier command and failure.
6. A materially different failure still consumed the existing `2/2` repair budget.
7. The agent eventually obtained a clean verification pass, but handoff ran the flaky gate yet again and stranded the mission.

This mission must fix the **systemic recovery architecture**, not special-case task-2373 or merely increase retry counts.

## Goal

When Parallix encounters an agent-fixable failure, the receiving agent must get enough exact evidence to act immediately.

Parallix must:

* preserve the root failure rather than classify an outer wrapper;
* distinguish transient retry from agent repair;
* reclassify a materially changed failure;
* avoid unnecessarily rerunning an unchanged verification tree;
* use one recovery/prompt authority;
* keep retry accounting intelligible;
* and strand only when the current failure genuinely requires human action or bounded recovery has failed with complete evidence.

Do not weaken verification or turn flaky failures into implicit passes.

## Required work

### 1. Inventory every recovery/retry/relaunch path first

Before changing behaviour, enumerate every current path that can:

* call `startAgent()` as recovery;
* call `rebound()`;
* retry a verification command;
* retry Git/hook/rebase work;
* recover reviewer/implementer timeout;
* recover missing/incomplete artifacts;
* recursively re-enter handoff;
* emit `stranded`, `manual intervention`, `retry`, `relaunch`, `recovery` or equivalent;
* retry publication/provider operations.

Cover at least:

* `src/application/rebound-kernel.ts`
* `src/application/handoff-command-use-case.ts`
* `src/application/rebase-workflow.ts`
* `src/application/failure-classification.ts`
* `src/adapters/cli/commands/repair-handoff.ts`
* `src/adapters/review/review-loop.ts`
* `src/adapters/review/review-gate-handling.ts`
* `src/adapters/review/review-artifacts.ts`
* `src/adapters/forgejo/forgejo-pr.ts`
* `src/adapters/verification/verification.ts`
* integrate conflict/gate recovery
* active/agent launch timeout and session recovery

Record the inventory in the checkpoint evidence. Do not invent a new abstraction before understanding which existing recovery authorities can be removed.

### 2. Preserve a structured root failure end-to-end

Extend the existing rebound/recovery reason model rather than passing successively wrapped strings.

A repairable failure must carry, where applicable:

* mission slug;
* recovery stage/operation;
* role;
* worktree/cwd;
* branch and current HEAD/tree;
* verification area;
* exact command that failed;
* exit status/signal;
* bounded stdout;
* bounded stderr;
* underlying structured cause;
* current review round/disposition when relevant;
* attempt accounting;
* the verifier/recovery action that will be rerun.

Outer messages such as:

`Forgejo PR creation/update failed: ...`

may be useful presentation context, but MUST NOT replace the structured underlying cause used for classification or repair prompting.

Do not create a second persistence authority for mission/review state.

### 3. Fix duplicate verification during handoff/publication

Today handoff runs its final verifier and creates reusable verification proof, while Forgejo `createPr()` can run verification again through `captureVerifiedTreeProof()`.

Fix this without weakening the publish safety invariant.

For an unchanged tree, command and toolchain:

* the successful handoff verification should produce authoritative reusable proof;
* publication should consume/assert that exact proof rather than unnecessarily execute the same expensive verifier again;
* before publication, prove that HEAD/tree/input fingerprint/verification command/toolchain still match;
* any mutation or mismatched proof MUST invalidate reuse and cause fresh verification.

There must never be a path where a stale verification result can authorize publication.

If publication genuinely has to execute verification again, preserve its exact command, stdout, stderr and exit status and return them as a structured gate failure. Do not collapse it to an exit-code-only Forgejo error.

### 4. Reclassify fresh failures

`rebound()` currently classifies the initial reason once and then merely replaces `diagnostic` after a failed verify.

Change this.

After every failed verification/recovery check:

1. construct the fresh structured failure;
2. fingerprint it;
3. classify it again;
4. compare it with the prior failure.

A materially changed failure must not blindly continue under the previous failure class and repair instructions.

For example:

* Git blocker → actual gate failure
* gate failure → provider outage
* deterministic test failure → transient resource/timing failure
* missing artifact → state-machine failure

must produce the appropriate new recovery decision and prompt.

Avoid classifying based on arbitrary wrapper words.

### 5. Separate retry currencies

Do not use one generic counter for unrelated recovery work.

At minimum distinguish:

* transient machine/check reruns;
* implementer repair launches;
* agent launch/session recovery;
* provider/network retries;
* conflict/hook repair.

A transient rerun must not consume an implementer code-repair attempt.

A launcher failure must not consume the same budget as “agent ran successfully, changed code, verifier still failed”.

Keep a bounded overall safety cap so Parallix can never loop forever.

Do not restore mutable shared SQLite retry counters that can be consumed by competing processes. Prefer operation-local recovery state plus observable attempt history.

Every displayed attempt count must agree with the actual cap. Remove inconsistencies such as prompt `retry 1/2` versus log `retry 1/3`.

### 6. Add conservative transient-failure handling

Parallix is a generic workflow engine, so do not hard-code `task-2373`, individual test names, CPU load thresholds, or Parallix-specific test filenames into the recovery kernel.

Provide a conservative mechanism by which a verification adapter/repository can identify known retryable environmental outcomes.

Properties:

* bounded retries/backoff;
* same unchanged HEAD/tree required;
* no agent launched before the transient retry policy is exhausted;
* no transient failure becomes a pass;
* an actual deterministic failure immediately follows normal repair handling;
* changed diagnostics are reclassified.

For the Parallix repository itself, cover timing-budget/resource-contention style verifier outcomes sufficiently to reproduce the `task-2373.01` failure class.

Do NOT teach repair agents to kill arbitrary processes belonging to other worktrees/users. Environmental remediation must remain scope-safe.

### 7. Make every repair prompt executable and stage-specific

Build recovery prompts from the structured failure.

If a command failed, include:

* exact command;
* exact working directory;
* exit status;
* useful stdout/stderr;
* current revision;
* what Parallix will rerun after the agent returns.

Never emit language such as:

> Execute the listed commands now

unless commands are actually listed.

Never tell an agent:

> fix the failing tests

when the evidence only says a generic verifier failed.

Never tell an agent to rebase, edit checkpoints, use `--no-gate`, modify code or perform host remediation unless that action follows from the classified failure.

For deterministic code/gate failures the prompt should make the first useful action obvious, not force the agent to spend a retry rediscovering what Parallix already knew.

### 8. Finish the recovery-authority migration

There should be one authority for:

* failure classification;
* recovery prompt construction;
* recovery attempt semantics.

Migrate or remove the duplicate prompt/retry policy still present in `repair-handoff.ts`.

Migrate the bespoke reviewer/implementer timeout recovery in `review-loop.ts` onto the same recovery model, or make it a thin stage-specific adapter to that model.

`AgentTimeoutReason` and actual timeout behaviour must agree.

Do not create another “RecoveryManager” alongside rebound unless the existing rebound abstraction is demonstrably incapable of owning this cleanly. Prefer completing/simplifying the architecture already started by TASK-2377.

Stage-specific orchestration may remain outside the kernel; policy and duplicate prompt construction may not.

### 9. Flatten nested handoff retry accounting

Handoff currently has recursion/remaining-retry accounting around gatekeeper remediation while rebound has its own attempt budget.

Remove invisible nested retry multiplication.

A user must be able to understand from logs:

* which recovery incident is active;
* its failure class;
* which attempt is being made;
* which budget is being consumed;
* why a new incident started;
* why it eventually stopped.

A changed failure fingerprint should be visibly reported as a new/reclassified incident rather than appearing as another identical attempt.

### 10. Improve exhaustion diagnostics

When automated recovery really is exhausted, do not reduce the result to:

`Manual intervention required`

plus the last generic wrapper.

Emit a concise recovery dossier containing:

* stage;
* root failure class;
* current HEAD;
* exact last failing command/action;
* final useful diagnostic;
* attempt history/failure fingerprints;
* whether the failure changed between attempts;
* successful checks already established;
* why automation stopped;
* exact safest manual next command/action.

Keep output bounded.

The mission/worktree must remain in an honest lifecycle state and remain recoverable by the normal Parallix commands.

## Behavioural acceptance tests

Add regression/characterisation tests proving at least all of the following.

1. A final handoff gate failure gives the implementer the exact command, cwd, exit status and captured failure output.

2. A prompt never says commands are listed when none are present.

3. Handoff verification passes; tree remains unchanged; Forgejo publication reuses/asserts the verified proof and does **not** execute the same expensive verifier a second time.

4. Changing HEAD/tree, command, relevant inputs or toolchain invalidates proof reuse and forces verification.

5. If publication does execute verification and it fails, the handoff caller receives the underlying structured gate failure including captured output rather than only `Forgejo PR creation/update failed`.

6. An outer Forgejo/publish wrapper cannot cause a gate failure to be classified as a Git or Forgejo infrastructure blocker.

7. Verify attempt A returns one failure class and attempt B returns a materially different failure: B is freshly classified and gets the appropriate prompt/policy.

8. A configured transient verifier failure on an unchanged tree is retried within the transient budget without launching an implementer.

9. Exhausting transient retries then exposes the real failure through normal recovery; it is never treated as success.

10. An agent launcher/session failure consumes launcher recovery, not an implementer code-repair attempt.

11. Reviewer timeout recovery and implementer timeout recovery use one consistent attempt denominator in prompt, log and actual loop.

12. Reviewer/implementer timeout prompts state precisely what output is missing and what constitutes completion.

13. Artifact, gate, hook and handoff recovery all use the same central prompt/classification policy.

14. The legacy repair-handoff path contains no competing recovery prompt/classification authority after this mission.

15. Gatekeeper/handoff remediation cannot multiply nested attempt budgets invisibly.

16. Exhaustion output contains the current failure and actionable recovery evidence instead of only a generic manual-intervention message.

17. Rebase conflict recovery retains its existing concrete conflict-file and command guidance.

18. Existing lifecycle/review/rebase/handoff behaviour remains green.

## Scope guards

* Do not increase retry limits as the primary fix.
* Do not suppress verification failures.
* Do not weaken reusable-proof identity checks.
* Do not classify a failure from agent prose when structured process evidence exists.
* Do not persist a second lifecycle/review/recovery truth.
* Do not kill unrelated processes or modify other mission worktrees.
* Do not special-case task-2373.
* Do not leave both old and new prompt builders active “for compatibility”; migrate callers or make the legacy seam a thin delegate.
* Keep recovery bounded.

## Checkpoints

### CP-1 — Recovery-path inventory and reproduction

Document every recovery/retry/relaunch producer and reproduce the information-loss path where a successful handoff verifier is followed by a publication verifier whose failure becomes an exit-code-only Forgejo wrapper.

No broad refactor before this checkpoint establishes the current behaviour.

### CP-2 — Structured recovery + proof reuse

Implement root-cause preservation, fresh-failure classification, verification-proof reuse and separated retry semantics.

Prove stale proof cannot authorize publication.

### CP-3 — Complete consumer migration

Migrate handoff, review timeout, artifact/hook recovery and legacy repair-handoff consumers to the central policy. Remove duplicate authority.

### CP-4 — End-to-end strand resistance

Exercise representative failures through real command seams and prove agent-fixable failures get actionable prompts, transient failures do not unnecessarily consume agents, and true exhaustion leaves a useful recovery dossier.

## Gates

Use the repository's current canonical verification commands from `workflow.config.json` / existing mission conventions.

At minimum run the full local verification applicable to changes across application, adapters, review, handoff, Forgejo and verification code.

Also run focused tests covering rebound, handoff, verification proof, Forgejo publication, review recovery, artifacts and rebase recovery.

Do not claim completion solely because newly added focused tests pass; the existing full suite must remain green.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
