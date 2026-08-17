# Mission: Rebound kernel with mandatory verify loop and per-failure budget (task-2377.03)

## Goal
Introduce the single rebound kernel — `rebound(reason, context) -> outcome` in the application layer — as the one code path every failure-mode improvement reuses, and land it on the incident path: pre-review gate failures and pre-review Git-hook failures in the review loop. A bounce may be reported as `fixed` only when the failing check re-runs and passes; budget is per local failure (fresh in-memory budget, default 2 attempts, nothing persisted).

## Why Now
The task-2369.13 incident chain: the pre-review path consumed a nested CLI's combined stdout text, misclassified gate failures as hook failures, and let two processes consume one persisted retry counter (split-brain budget) — making bounce-vs-strand nondeterministic. ADR 0048 (Accepted) already mandates fail-closed classification and a single dispatch table, but the table's consumers are fragmented: the review-loop remap relabels non-hook gate failures as Git blockers, an ad-hoc human-only override regex lives outside the classifier, and the hook path relaunches the implementer without ever re-running the failing check, so "implementer relaunched" is an unverified claim. The dependency TASK-2377.02 (in-process pre-review rebase with typed gate/hook evidence, status `ready-for-integration`) lands the structured failure values this kernel consumes. Without this kernel, TASK-2377.04/.05 (migrating the remaining bounce paths) have no target, and every future failure-mode fix re-invents classification, prompt, launch, and retry logic per site.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one new application-layer kernel module (classification, fix-prompt builder, launch, verify loop, per-occurrence budget); rewiring of two incident paths in `src/adapters/review/review-gate-handling.ts` and `src/adapters/review/review-loop.ts` (gate + hook); deletion of the synthesized `git-hook` remap, the ad-hoc human-only override regex, and duplicated prompt boilerplate (deletions offset additions); kernel unit tests with mocked `startAgent`/`verify` plus updates to the existing gate/hook suites.

## Scope
- New kernel (application layer) exposing `rebound(reason, context) -> outcome` where:
  - `reason` is a structured value — never a regex match on combined text: gate failure (area, command, exit code, stdout, stderr, from TASK-2377.02's typed evidence), hook failure (hook identity from git state, output), artifact-incomplete (role, diagnostic), agent-timeout (role), handoff-verification (error, gate output). All five kinds exist in the type union; only gate and hook are wired to consumers in this mission.
  - `context` carries slug, worktree, implementer, and a `verify` callback that re-runs the failing check and returns pass/fail with a fresh diagnostic.
  - `outcome` is `fixed` (verify passed), `exhausted` (budget spent; mission stranded with the last diagnostic), or `human-only` (classification says no agent can fix it).
- Classification: the single ADR 0048 table is the only classifier. The ad-hoc human-only override regex is folded in as a rule inside the classifier. The remap that relabels every non-hook gate failure as a Git blocker is deleted and `GateFailure` dispatch is restored. No per-site override logic survives on the incident path.
- Fix prompt: one builder with slots (kind, mission, area, diagnostic, attempt, and the true statement that the check re-runs automatically after the fix). The context-compaction boilerplate lives in exactly one place.
- Launch: via `startAgent`; an ambiguous null exit status is reclassified as launch failure (a null-exit "fix" is no evidence of a fix).
- Verify loop: launch agent → run `verify()` → pass: `fixed`; fail with budget left: relaunch with the fresh diagnostic; budget spent: `exhausted`.
- Budget: per local failure. Each `rebound()` invocation is one failing occurrence with a fresh in-memory budget (default 2 attempts). Nothing persisted across occurrences; an occurrence that exhausts strands, and the next occurrence of the same failure class starts fresh. No review-state metadata writes, no SQLite retry columns, no cross-process shared budget from the kernel.
- First consumers on the incident path: the pre-review gate path (its existing behavior — bounce, then re-run rebase+gate — becomes the kernel's verify loop) and the hook path (its `verify` re-runs the in-process pre-review rebase plus the verification gate, closing the missing re-run).
- Kernel unit tests under `test/` with mocked `startAgent` and `verify` (no real agents, no real git, no Forgejo), and expectation updates to the affected existing suites, documented in the checkpoint.
- Doc updates where user-visible or workflow behavior changes (bounce policy, stranded outcomes).

## Out of Scope
- Other bounce paths: CLI rebase hook bounce, handoff bounces, review-loop artifact/review bounces — TASK-2377.04 (review-loop) and TASK-2377.05 (CLI/handoff).
- Deleting the existing persisted retry counters (review-state metadata fields, any SQLite retry columns) — TASK-2377.04. The kernel simply does not write them.
- Changing standalone `px rebase` command behavior or its own hook-bounce path — TASK-2377.05.
- Changing ADR 0048's classification table semantics (class set or dispatch actions); this mission only consolidates its consumers.
- Other ADR 0048 controls beyond classification/dispatch on the incident path.
- Wiring artifact-incomplete, agent-timeout, or handoff-verification reasons to real consumers (type union only in this mission).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1 (contract, sole launch path): The kernel exposes `rebound(reason, context) -> outcome` with the reason/context/outcome shapes in Scope. On the pre-review gate and pre-review hook failure paths, the kernel is the only code that launches an agent: zero `startAgent` calls for these two failure kinds outside the kernel on the final tree (verified by code search plus the kernel unit tests).
- SC2 (verify-gated `fixed`): An outcome of `fixed` is returned only after the `verify` callback returns pass. A failing `verify` consumes one attempt and relaunches with the fresh diagnostic; when the budget is spent the kernel returns `exhausted` carrying the last diagnostic and the mission strands. Kernel unit tests assert: verify-fail → relaunch with fresh diagnostic; verify-pass after relaunch → `fixed`; two failed verifies (default budget) → `exhausted` with the last diagnostic and no third launch.
- SC3 (per-occurrence budget, no persistence): Budget is in-memory per `rebound()` invocation, default 2 attempts. A second invocation of the same failure class after an exhausted one starts with a fresh budget of 2. The kernel performs zero writes to review-state metadata and zero SQLite writes (asserted by unit tests using a mocked state store that fails on write).
- SC4 (null exit = launch failure): An agent exit status of null/ambiguous is reclassified as launch failure — never reported as `fixed`, and it consumes budget as a failed attempt. Unit test asserts launch-failure handling with a null exit.
- SC5 (single classifier): Classification is the single ADR 0048 table. The former ad-hoc human-only override regex exists only as a rule inside the classifier (no independent regex consumer). The remap that relabels non-hook gate failures as Git blockers is deleted (no synthesized `git-hook` remap in the review-loop or gate-handling code). A declared gate that ran and exited non-zero dispatches as a gate failure, not a Git blocker.
- SC6 (one prompt builder): One fix-prompt builder serves all kinds with slots (kind, mission, area, diagnostic, attempt, automatic re-verify statement). The context-compaction boilerplate text occurs in exactly one source location; the pre-review gate and hook prompts no longer duplicate it.
- SC7 (hook path re-verifies): The hook path's `verify` callback re-runs the in-process pre-review rebase plus the verification gate; a hook bounce is reported `fixed` only when that re-run passes.
- SC8 (regression suites green): `test/task-2353-rebounce-reproduction.test.ts`, `test/task-1268-pre-review-gate-per-round.test.ts`, `test/task-1383-active-gate-failure-prompt.test.ts`, and `test/task-1385-pre-review-gate.test.ts` pass on the final tree; any expectation change is justified in the checkpoint Goal Check.
- SC9 (gate clean): `./scripts/verify-local.sh all` exits 0 on the final tree.

## Risks and Assumptions
- Dependency: TASK-2377.02 must be integrated before the incident path consumes typed evidence; if it is not merged on this branch's base, the kernel must consume the legacy text-based results without extending the text-regex classification (the kernel contract itself is unaffected). Flag if the dependency is missing at CP 3.
- Expectation churn: existing gate/hook suites encode the old behavior (persisted retry counters, no re-verify, prompt wording). Expectation changes are expected and must be documented per criterion in the checkpoint; silent deletions of assertions are not.
- Budget semantics change: switching from a cumulative persisted counter to a per-occurrence in-memory budget changes strand timing (previously a second occurrence continued the old count; now it starts fresh). This is deliberate policy per the contract; log/UX wording that references cumulative retries must be updated so output stays truthful.
- `human-only` dispatch: folding the override regex into the classifier must not widen or narrow which errors strand as human-only relative to ADR 0048; if a case is ambiguous between two table rows, stop (see Stop Rules) rather than guess.
- Tests must stay mock-only (fast, no real agents/git/Forgejo) per repo test policy; the verify callback and `startAgent` are injected.

## Checkpoints
- CP 1: Kernel contract and classification. Create the application-layer kernel module with the `rebound` function, reason/context/outcome types (all five reason kinds in the union), and classification from the single ADR 0048 table with the human-only override folded in as a classifier rule. Unit tests cover classification of gate failure, hook failure, artifact-incomplete, agent-timeout, and handoff-verification reasons.
- CP 2: Launch, verify loop, budget. Implement `startAgent` launch with null-exit reclassification as launch failure, the launch→verify→fixed/relaunch/exhausted loop, and the per-occurrence in-memory budget (default 2) with zero state writes. Unit tests cover SC2, SC3, SC4 (mocked launch + verify; mock state store that fails on write).
- CP 3: Incident-path wiring. Route the pre-review gate path and the hook path through the kernel (gate: existing bounce-then-rerun-become-verify; hook: verify = in-process pre-review rebase + verification gate). Delete the synthesized `git-hook` remap, restore `GateFailure` dispatch, remove the now-dead per-site auto-bounce launch code on these two paths (their persisted-counter reads become inert; deletion of the counters is TASK-2377.04). Regression suites (task-2353, task-1268, task-1383, task-1385) run green or with documented expectation updates.
- CP 4: Fix-prompt consolidation. Replace the duplicated gate/hook prompt construction with the single slot-based builder; the context-compaction boilerplate survives in exactly one location; the automatic re-verify statement is present. Prompt-related test expectations updated and documented.
- CP 5: Full verification and docs. `./scripts/verify-local.sh all` clean. Update authored docs (and `AGENTS.md` only if a durable user-facing behavior changed) for the new bounce policy and stranded outcomes; run `./scripts/verify-local.sh docs` if docs changed. Final Goal Check table.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Mission-specific evidence expectations:
- CP 1–CP 2 rows cite the kernel unit test file path under `test/` and the exact test names covering classification, the verify loop, budget, and null-exit handling; cite `ADR 0048` for the classification table.
- CP 3 rows cite the run of the regression suites — e.g., `npm test -- test/task-2353-rebounce-reproduction.test.ts test/task-1268-pre-review-gate-per-round.test.ts test/task-1383-active-gate-failure-prompt.test.ts test/task-1385-pre-review-gate.test.ts` — and, for any changed expectation, the test name plus a one-line justification of why the old expectation encoded the old behavior.
- CP 4 rows cite the single prompt-builder location (file path) and the test name asserting the compaction boilerplate and the automatic re-verify statement.
- CP 5 rows cite `./scripts/verify-local.sh all` (and `./scripts/verify-local.sh docs` when docs changed) with the exit status, plus the doc file paths updated.
- Failure mode to avoid: a row that is only `ls`/`stat` output or prose like "tests pass" without a test name, test file path, or repo command is incomplete evidence and will be rejected.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/adapters/review/rebase.ts` and the standalone `px rebase` command behavior: read-only for this mission; its own hook-bounce path is migrated by TASK-2377.05.
- Persisted retry counters (review-state metadata fields such as `hookFailureRetryCount`/`gateFailureRetryCount`, any SQLite retry columns): the kernel must not write them, but their deletion is TASK-2377.04 — do not delete the fields/columns or other readers in this mission.
- Bounce paths outside the incident path (CLI commands, handoff, review-loop artifact/review bounces): untouched — TASK-2377.04/.05.
- `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md`: classification table semantics are fixed by the Accepted ADR; do not edit the table (consumer consolidation only).
- Backlog files: `backlog/tasks/task-2377.03 - Rebound-kernel-with-mandatory-verify-loop-and-per-failure-budget.md` must not be deleted, renamed, or moved; do not edit its `assignee` field.
- Remote pushes: mission branches never push to `origin`; only the `review` remote receives pushes (enforced by the pre-push hook and AGENTS.md).

## Stop Rules
- TASK-2377.02 typed evidence is absent from the base (dependency not integrated) and the incident path cannot consume structured gate/hook results: stop at CP 3, record the blocker, and report — do not extend text-regex classification into the kernel.
- A failure case is ambiguous between two ADR 0048 table rows (e.g., a hook error and a gate failure both plausible): stop, cite the case, and ask — do not pick a row to keep suites green.
- Making any success criterion pass would require the kernel to persist budget/retry state: stop; that violates the per-occurrence budget policy (SC3).
- A regression suite in SC8 fails and the only fix is weakening or deleting an assertion without a documented behavior-change justification: stop, checkpoint the failure with exact failing test names, and report.
- `./scripts/verify-local.sh all` still failing after 3 fix attempts within a checkpoint: stop, checkpoint the exact failure output, and report.
- Scope pressure to also migrate CLI/handoff/artifact bounce paths: stop; that is TASK-2377.04/.05 — record it in the checkpoint as deferred and continue.
