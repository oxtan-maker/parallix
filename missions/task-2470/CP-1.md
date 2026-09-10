# CP-1 — Ground the claims

## Summary

Read the four durable inputs the mission names (ADR 0048, `docs/doc-standards.md` §§1–3, `docs/use-cases.md`, and the four implementation files in success criterion 4) plus the supporting lifecycle code that actually enforces each layer. No `README.md` edit was made in this checkpoint, per the CP 1 contract.

Outputs of this checkpoint:

1. A nine-row map from each defence layer to its repository evidence and to its limitation (or "unconditional").
2. The recorded ADR 0048 implementation-status reading required by the "stale ADR status" risk mitigation.
3. The deduplication decision that CP 2 will execute, with the `docs/doc-standards.md` clause that justifies it.
4. The drafting constraints the docs gate imposes on the new README section.

### ADR 0048 implementation-status table, re-read at CP 1 (risk mitigation)

The mission's stop rule fires if the ADR status table contradicts a required caveat. It does not. `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md`, section `## Implementation Status`, reads:

| Control | Status recorded in ADR 0048 | Task |
|---|---|---|
| C1 pre-review-round gate enforcement with auto-bounce | ✅ Implemented | task-1385 |
| C2 gate-failure auto-send-back with captured output | ✅ Implemented | task-1387 |
| C3 error classifier and dispatch table | ✅ Implemented | task-1389 |
| C4 declared-gate pre-validation | ⏳ Next wave | task-1386 |
| C5 gatekeeper auto-send-back with agent relaunch | ⏳ Next wave | task-1388 |
| C6 infrastructure blocker classification and operator handoff | ✅ Implemented | task-1392 |
| C7 evidence-reference validation | ✅ Implemented | task-1393 |

C4 and C5 are still `⏳ Next wave`, so the caveat success criterion 3 demands ("scheduled, not implemented") is accurate and no stop rule applies. The ADR's `## Inventory of Existing Checks` still totals **23 check points across 5 lifecycle phases**, matching the mission's Why Now paragraph.

### The nine defence layers, in lifecycle order

Evidence column cites the success-criterion-4 artifact first (bold), then supporting code read during this checkpoint. Supporting paths are cited here because this is a mission document; CP 2 must not carry them into `README.md` (see drafting constraints below).

| # | Defence layer (lifecycle position) | Repository evidence | Limitation to state |
|---|---|---|---|
| 1 | Mission branch + sibling worktree isolation (draft) | **`docs/use-cases.md`** UC-1 "Run multiple missions without shared-worktree collisions"; README `## What it does` first bullet (`mission/<slug>` branch + `../<repo>-<slug>` worktree); `src/adapters/cli/commands/draft.ts` `ensureMissionBranch` / `ensureWorktree` | Unconditional as a mechanism. UC-1's own confidence line bounds the *claim*: "isolation is a workflow control, not a promise of a fixed productivity multiplier". |
| 2 | Bubblewrap process confinement (agent launch) | **`src/adapters/process/bubblewrap.ts`** — `isBubblewrapAvailable()` emits `bubblewrap (bwrap) not found or not executable — the agent is running UNSANDBOXED with full filesystem access.`; `resolveSandboxProfile()` returns `worktreeWritable: false` for `step === 'review'` and `true` plus Git-resolved metadata mounts for implementer steps; `buildBubblewrapArgs()` opens with `--ro-bind / /` | **Conditional.** Linux + an executable `bwrap`; otherwise the launch continues unsandboxed with one explicit warning (emitted at most once per process). Operator opt-out exists via `PARALLIX_NO_BUBBLEWRAP` (`isBubblewrapDisabled`). A present-but-unbuildable guard *fails* the launch (`BubblewrapGuardError`) rather than widening mounts. |
| 3 | Repository-owned verification gate (checkpoint, handoff, review, integration) | **`docs/adr/0048-…md`** inventory rows 1, 10, 13, 16, 18; **`docs/use-cases.md`** UC-5 and UC-10; this repo's dispatcher `./scripts/verify-local.sh` declared in `workflow.config.json`; `src/application/handoff-command-use-case.ts` "Step -1: Repository-configured pre-handoff gates" | **Conditional on the repository declaring a gate.** README already states the no-op default: "declare nothing and verification is a documented no-op pass, not an invented gate". UC-5: "The strength of the result is the strength of the repository's configured verification, not the workflow alone." |
| 4 | Checkpoint `## Goal Check` evidence validation (handoff) | **`src/adapters/review/review-commands.ts`** re-exports `performStaticReview` from `./review-static-evidence.js`, whose `findUnverifiableGoalCheckRow()` rejects a final checkpoint whose evidence rows cite no verifiable reference; **`docs/adr/0048-…md`** inventory rows 8–9 and C7 (✅ task-1393) | **Mechanical, not semantic.** `evidenceCellHasVerifiableReference()` accepts a resolvable path, an `npm|npx|node|git|px` command, a `./script` that exists, an `ADR NNNN` with a matching file under `docs/adr/`, a quoted string matching a real repo test name, or a `*.test.*` path. It proves a reference resolves; it does not prove the claim beside it is true. |
| 5 | Gatekeeper mandatory-artifact checks (pre-review pushback) | **`src/adapters/verification/gatekeeper.ts`** — `checkMandatoryFiles()` requires `MISSION.md`, at least one `CP-*.md`, and a resolvable Backlog task file; `runGatekeeper()` posts a `request-changes` review as the gatekeeper identity; **`docs/adr/0048-…md`** inventory row 12 | **Conditional on a Forgejo token** for the gatekeeper user: without one, `runGatekeeper` logs `WARN … skipping pushback` and returns `skipped: true` (the missing list is still surfaced). Auto-send-back with relaunch for this class is **C5, ⏳ next wave — not implemented**. |
| 6 | Second, preferentially-different reviewing agent; provider-blocked self-approval (review) | **`src/adapters/review/review-commands.ts`** — self-author skip path logs `Review outcome "…" recorded locally … (self-approval POST skipped). A different agent or a human must post the formal provider approval.`; **`docs/use-cases.md`** UC-4; `src/application/handoff-command-use-case.ts` `resolveHandoffReviewAssignment()` selects with `exclude: new Set([implementerName])`; `src/adapters/review/review-artifacts.ts` `postWorkflowReview()` skips the POST when `prAuthor === reviewIdentity` | **Conditional.** A *different* family is guaranteed only when one is runnable. On `isReviewerPoolExhausted` the code takes the documented single-family escape hatch, logs `WARN … falling back to self-review for this handoff`, and records the implementer's own family as the eligibility that actually applied. UC-4 confidence: "Partial … does not guarantee independent-family coverage." |
| 7 | Failure classification with bounded auto-repair / auto-send-back / human-only dispatch (handoff failure) | **`src/application/failure-classification.ts`** — 8 `FailureClass` values, 3 `DispatchAction` values, `DISPATCH_TABLE`, `classifyError()`; **`docs/adr/0048-…md`** C2/C3/C6 (✅) and the `## Failure Classification` table | **Bounded, and two controls are still scheduled.** `src/application/rebound-kernel.ts` sets `DEFAULT_REBOUND_ATTEMPTS = 2`; `handoff-command-use-case.ts` hard-caps at 3 total handoff invocations before `Handoff exceeded maximum attempts (3). Manual intervention required.` Unrecognized errors default to `InfraBlocker` / `HumanOnly`. **C4 and C5 remain ⏳ next wave.** |
| 8 | Integration-time gates (integrate) | **`docs/adr/0048-…md`** inventory rows 17–20 (integration preflight, integration gates, exact-tree proof capture and assertion) and its ADR 0041 relation; `src/adapters/cli/commands/integrate.ts` resolves `loadPhaseGates(checkout, 'preIntegration')` | **Conditional on repository configuration.** Gates come from `adapters.gates.preIntegration` in `workflow.config.json`. `--no-integration-gates` is rejected outside the test path (`--no-integration-gates is rejected: final integration gates are mandatory.`), and an empty gate list fails closed when `adapters.gates.requirePreIntegration` is set. |
| 9 | Operator-owned merge decision (integrate) | **`docs/use-cases.md`** `## Positioning boundaries` — "it does not remove the need for operator judgment, meaningful tests, or honest review"; README `## What Parallix is not` — "Nothing merges itself, and the safe operating model is that a human decides … whether `px integrate` should happen at all." | Unconditional by design: squash-merge happens only on an explicit operator `px integrate`. The flip side is that no layer substitutes for the operator reading the diff. |

Every row's bolded artifact is one of the six success-criterion-4 references, so CP 2 can keep each README claim traceable without naming source paths in the README itself.

### Deduplication decision for CP 2

`docs/doc-standards.md` §6 names the exact anti-pattern this mission would otherwise create: "repeating the same limitation in a capability section, use-case section, and 'What this is not' section". The reviewer-difference limitation is currently stated twice in `README.md`:

1. `## What it does`, review bullet tail: "It falls back to the same family when no other agent is runnable, so this forces a second review *attempt* — it only guarantees a different reviewer when one is available."
2. `## Current status`, final bullet: "**Review coverage** is best-effort, not guaranteed: a second review is always attempted, but a different reviewing agent family is only guaranteed when one is runnable."

Success criterion 3 forces the new section to carry that limitation too, which would make three. CP 2 will therefore **remove bullet 2 only** and keep bullet 1, because:

- Bullet 2's sole purpose is the limitation; it adds no information beyond bullet 1 and the new section, so §6 ("Repetition is justified only when the later occurrence adds meaning") and §3 ("If two sections have substantially the same purpose, merge them or remove one") both point at deleting it.
- Bullet 1 keeps the caveat attached to the capability claim where a reader first meets it, which §9 and §12 favour ("keep measurements attached to enough context to remain honest", "explicit limitations").
- No `docs/doc-standards.md` §2 differentiator disappears: §2 lists "separate review and repository-owned verification", which survives in `## What it does`, `## The core workflow`, and the new section. Bullet 2 is a limitation statement, not a differentiator.
- §5 ("prefer the smallest change") argues against also trimming the `## What it does` Bubblewrap and review bullets; their occurrences add the capability/profile framing the new section deliberately does not repeat.

`## What Parallix is not` ("Not a magic autonomous engineer") stays: it carries layer 9 plus the §2 "operator control" differentiator in a different frame, and `## Current status` keeps its distribution/telemetry/Graphify items untouched.

### Drafting constraints the docs gate imposes on the new section

`scripts/verify-docs.mjs` checks `README.md` (an `authoredDocs` entry) and fails outside code fences on:

- `/\b(?:src|lib)\/[A-Za-z0-9_./-]+/` — "volatile source-path evidence is not allowed in authored docs"
- `/\btest\/[A-Za-z0-9_./-]+\.[cm]?[jt]sx?\b/` — "volatile test-inventory evidence is not allowed in authored docs"
- relative Markdown links whose target does not resolve

Consequences for CP 2: the new section names **no source or test paths**, consistent with `docs/doc-standards.md` §7 and §10 and with success criterion 9. Durable pointers only — `docs/adr/` (ADR 0048), [`docs/use-cases.md`](../../docs/use-cases.md), [`AGENTS.md`](../../AGENTS.md) — and mechanism descriptions in product language. The mission's stop rule on section length (~45 lines) is also a drafting constraint: CP 2 targets roughly 30–38 lines.

### Scope confirmation

- Graphify: `graphify-out/graph.json` does not exist in this worktree, so no `graphify query` / `path` / `explain` was run and none is required; grounding was done by reading source directly, per AGENTS.md's fallback rule.
- `node_modules` is present (218 entries), so the CP 2 gates can run without a fresh `npm install`.
- Pre-existing dirty file in the worktree: `package-lock.json` (` M` at HEAD `c51b2b650`). It is not mission work; it stays unstaged and uncommitted so success criterion 6 holds.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 1. One new `##` section headed `Defence in depth` exists | Deferred to CP 2 by the mission's checkpoint contract ("No `README.md` edit in this checkpoint"); `README.md` is unmodified at this commit — `git diff --name-only c51b2b650..HEAD -- README.md` is empty | NOT YET (CP 2) |
| 2. Section names all nine layers | Nine-row layer map in this document, `### The nine defence layers, in lifecycle order`; layers enumerated against `ADR 0048` inventory rows 1–23 and `docs/use-cases.md` UC-1/UC-4/UC-5/UC-10 | PASS (grounding) |
| 3. Three conditional caveats identified with sources | This document's Limitation column rows 2 (Bubblewrap `isBubblewrapAvailable` UNSANDBOXED warning), 6 (`resolveHandoffReviewAssignment` single-family escape hatch), 7 (C4/C5 `⏳ Next wave` in the `ADR 0048` `## Implementation Status` table) | PASS |
| 4. Every mechanism claim traceable to a criterion-4 artifact | Bolded artifact per row above; each is one of `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md`, `src/adapters/process/bubblewrap.ts`, `src/adapters/verification/gatekeeper.ts`, `src/adapters/review/review-commands.ts`, `src/application/failure-classification.ts`, `docs/use-cases.md` | PASS |
| 5. No new numeric or comparative claim | Only figures recorded here are `23 check points across 5 lifecycle phases` and the C1–C7 statuses, both quoted from `ADR 0048`; `DEFAULT_REBOUND_ATTEMPTS = 2` and the 3-attempt cap are read from `src/application/rebound-kernel.ts` and `src/application/handoff-command-use-case.ts`. `+57%` / "order of magnitude" in `README.md` `## Use cases` untouched | PASS |
| 6. Net change confined to `README.md` | No file changed in this checkpoint; `git diff --name-only c51b2b650..HEAD -- . ':!missions/'` is empty and the pre-existing ` M package-lock.json` stays unstaged | PASS |
| 7. Removed bullets accounted for; no §2 differentiator lost | `### Deduplication decision for CP 2` names the exact bullet to remove (`## Current status` "**Review coverage** is best-effort…") and the §6/§3 clauses that justify it, plus the §2 differentiator that survives | PASS (decision recorded) |
| 8. Gates exit 0 on the final tree | Deferred to CP 2; runnable commands are `./scripts/verify-local.sh docs` and `./scripts/verify-local.sh all` | NOT YET (CP 2) |
| 9. No `file.ext:123` reference introduced into `README.md` | `### Drafting constraints the docs gate imposes` records the `scripts/verify-docs.mjs` source-path and test-inventory patterns that forbid it; `README.md` unmodified at this commit | PASS (constraint recorded) |
| Stop rule: ADR 0048 status does not contradict a required caveat | `### ADR 0048 implementation-status table, re-read at CP 1` records C4 and C5 as `⏳ Next wave` from `ADR 0048` | PASS — no stop |

Next action: CP 2 — insert `## Defence in depth` into `README.md` between `## The core workflow` and `## Example` using the nine-row map above, delete the `## Current status` "**Review coverage** is best-effort, not guaranteed…" bullet, extend the `## Documentation` `docs/adr/` entry to name ADR 0048, then run `./scripts/verify-local.sh docs` and `./scripts/verify-local.sh all` and record both exit codes.
