# CP-2 — Write the section, dedupe, and run the gates

## Summary

Inserted `## Defence in depth` into `README.md` between `## The core workflow` and `## Example` (the position the mission recommends, so the trust story lands before the command walkthrough), removed the one now-redundant `## Current status` bullet, and extended the `## Documentation` `docs/adr/` entry to name ADR 0048. Net diff is 19 insertions and 2 deletions in `README.md` and nothing else.

Both mission gates were run. `./scripts/verify-local.sh docs` exits **0**. `./scripts/verify-local.sh all` exits **1** on a single pre-existing test failure that has no relationship to `README.md`. That triggers the mission's third stop rule; the diagnosis and the red-to-red proof are recorded below.

### The section as written

18 lines of `README.md` (heading through the closing sentence, exclusive of `## Example`) — inside the ~45-line stop-rule budget. Structure: a two-sentence lead-in, a nine-item ordered list in lifecycle order, a paragraph pointing at the durable references, and a one-line boundary statement.

Lead-in subject sentence: *"Running several agents in parallel is only worth doing if you can trust what comes back. Parallix therefore never asks the implementing agent whether its own work is good."*

The nine items, by their rendered bold labels: **Isolation**, **Confinement**, **Repository-owned verification**, **Checkpoint evidence validation**, **Mandatory-artifact gatekeeper**, **Separate review, blocked self-approval**, **Classified failure handling**, **Integration gates**, **Operator decision**.

### Deduplication performed (criterion 7)

**Removed** — the last bullet of `## Current status`, verbatim:

> `- **Review coverage** is best-effort, not guaranteed: a second review is always attempted, but a different reviewing agent family is only guaranteed when one is runnable.`

**Now carried by** — item 6 of the new section, verbatim:

> "A *different* agent family is guaranteed only when one is runnable; otherwise Parallix logs that the round was self-reviewed instead of claiming an independence it did not have."

Justification: `docs/doc-standards.md` §6 names this exact anti-pattern ("repeating the same limitation in a capability section, use-case section, and 'What this is not' section") and §3 says "If two sections have substantially the same purpose, merge them or remove one." Success criterion 3 forces the new section to state that limitation, which would have made three copies in one file.

**Deliberately kept**, per CP 1's decision and `docs/doc-standards.md` §5 (smallest change) plus §9/§12 (keep a caveat attached to the claim where a reader first meets it):

- `## What it does`, review bullet tail — "It falls back to the same family when no other agent is runnable, so this forces a second review *attempt* — it only guarantees a different reviewer when one is available." This is the §2 differentiator "separate review and repository-owned verification" stated as a capability; deleting it would weaken the value section.
- `## What it does`, Bubblewrap bullet — carries the mount-profile detail (read-only host, implementer vs review writability) that the new section intentionally does not repeat; the new section's occurrence adds the trust consequence and the required caveat instead.
- `## What Parallix is not`, "Not a magic autonomous engineer" — the §2 differentiator "operator control over what ultimately lands" in a different frame; it is the anchor for layer 9, not a duplicate of it.

**§2 differentiator audit** — all six survive in `README.md` after the edit: parallel work (`## Why Parallix?`, `## What it does` bullet 1), isolation (same bullet + new section item 1), agent-agnostic (intro, `## What it does` bullet 2, `## What Parallix is not`), continuity (`## What it does` bullet 4, `docs/use-cases.md` UC-3 pointer), separate review and verification (`## What it does` bullets 5 and 8 + new section items 3, 4, 6), operator control (`## What Parallix is not` + new section item 9). Only a limitation restatement was deleted, never a differentiator.

### Documentation list update

`## Documentation` previously read `- \`docs/adr/\` — architecture decision records, including ADR 0044 (distribution model).` The new section makes ADR 0048 load-bearing, so the entry now reads `… including ADR 0044 (distribution model) and ADR 0048 (the fail-closed harness defence inventory cited above).` No other entry changed; `docs/use-cases.md` and `AGENTS.md` were already listed and the new section links both.

### Gate results

| Gate | Command | Exit code |
|---|---|---|
| Documentation | `./scripts/verify-local.sh docs` | **0** — `PASS: authored documentation contains no volatile implementation evidence and relative links resolve` |
| General | `./scripts/verify-local.sh all` | **1** — 2455 tests, 2454 pass, **1 fail** |

`gate_all()` in `scripts/verify-local.sh` is `node scripts/verify-docs.mjs` followed by `npm test`. The docs half passed inside the `all` run too; the single failure is in the test half.

**The one failing test:** `test/metric-contract.test.ts` → *"statistics metric contract names every board and CLI decision metric with its semantic inputs"*. It reads `docs/metric-contract.md` and asserts the literal row heading `Throughput / weekly throughput` is present. `grep -c 'Throughput / weekly throughput' docs/metric-contract.md` returns **0**: the contract's `## Metric catalogue` has rows for Flow/WIP, lifecycle cycle time, lane dwell, current lane age/bottleneck, review bounce rate, review-fix rounds, agent runtime, tokens/cost/tool calls, and cohort comparison — but no throughput row.

**Root cause, traced to a commit.** This is an inherited red base, not drift in this worktree:

| Question | Command | Result |
|---|---|---|
| Which commit dropped the row? | `git log --oneline HEAD -- docs/metric-contract.md` then `git show 395015b45^:docs/metric-contract.md \| grep -c …` vs `git show 395015b45:docs/metric-contract.md \| grep -c …` | `395015b45 mission/task-2469: task-2469` (2026-09-08): parent **1**, commit **0** — it removed the row while `test/metric-contract.test.ts` still requires it |
| Is that commit in this mission's base? | `git merge-base --is-ancestor 395015b45 HEAD` | **YES** — inherited by base `c51b2b650` (2026-09-09), before this mission started |
| Does `main` still have the row? | `git show main:docs/metric-contract.md \| grep -c 'Throughput / weekly throughput'` | **1** — restored on `main` by `5dd4c5eca mission/task-2469` / `c87918feb mission/task-2472` |
| How stale is this branch? | `git rev-list --count HEAD..main` | **632** commits behind `main` |

So the fix already exists upstream. `main` is green on this test; this mission branch was cut from a commit where `mission/task-2469` had removed the row without updating the test, and the parallel `main`-side variant of the same mission put it back.

### Stop rule invoked: `all` fails for a reason unrelated to `README.md`

The mission's stop rule reads: *"Stop if `./scripts/verify-local.sh all` fails for a reason unrelated to `README.md`. Do not repair unrelated source or tests under this mission; report the failing check and the fact that the mission diff is README-only."* All three conditions of that rule hold, each proven rather than asserted:

1. **The mission diff is README-only.** `git diff --name-only c51b2b650..HEAD` (baseline = the pre-implementation lifecycle commit) lists `missions/task-2470/CP-1.md` alone; the working-tree diff is `README.md` plus a pre-existing ` M package-lock.json` that this mission never staged. Criterion 6's command, `git diff --name-only c51b2b650..HEAD -- . ':!missions/'`, is empty and becomes `README.md` once CP 2 is committed.
2. **Neither file the failing test involves was touched by this mission.** `git status --short -- docs/metric-contract.md test/metric-contract.test.ts` is empty (both clean), and the last commits touching them are `395015b45 mission/task-2469`, `cf1b76417 mission/task-2363`, `afa334291 mission/task-2347` — none of them this mission.
3. **Red-to-red reproduction with the README change removed.** `git stash push -- README.md`, then `npm test -- test/metric-contract.test.ts` → exit **1** with the same `✖ statistics metric contract names every board and CLI decision metric with its semantic inputs` failure; then `git stash pop` restored the section. The failure is identical with and without this mission's edit, so the edit neither caused nor can cure it.

Repairing it inside this mission would require editing `docs/metric-contract.md` (adding a throughput row) or `test/metric-contract.test.ts`. `test/` is a Restricted Area for this mission, `docs/metric-contract.md` is outside its Scope, and either edit would break success criterion 6. The second stop rule reinforces this: the README documents what exists and is not changed to match the code, nor the code to match the README.

**Rebasing onto `main` was deliberately not attempted here.** It is the natural resolution — `main` already carries the row, and "Rebase onto primary" is check point 11 of the `ADR 0048` handoff inventory, i.e. a lifecycle step the harness owns rather than one the implementer performs mid-checkpoint. Beyond that ownership argument, this branch is 632 commits behind `main`, so a rebase is a large, hard-to-reverse operation that could pull 632 commits' worth of `README.md` history into conflict with the one file this mission is allowed to touch and invalidate the section's wording against a tree it was never grounded in. That is an operator decision, not an implementer shortcut.

**Operator decision required.** Either (a) let the handoff lifecycle rebase this branch onto `main`, which adopts the upstream fix to `docs/metric-contract.md` and should turn `./scripts/verify-local.sh all` green with no edit from this mission — then re-run both gates on the rebased tree and re-verify the section's wording still matches it; or (b) accept the README-only change as complete on the strength of `./scripts/verify-local.sh docs` exit 0 plus the red-to-red proof that the one failing test is inherited and unrelated.

### Worktree hygiene

`package-lock.json` was already modified at HEAD `c51b2b650` before this mission began. It is unrelated mission-external state; it was left unstaged and uncommitted so criterion 6 holds. The `git stash push`/`pop` pair above scoped strictly to `README.md` and did not touch it.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| 1. Exactly one new `##` section whose heading contains `Defence in depth` | `README.md` heading `## Defence in depth`, between `## The core workflow` and `## Example`; `git diff --name-only c51b2b650..HEAD -- . ':!missions/'` lists `README.md` only | PASS |
| 2. All nine layers named and individually identifiable | `README.md` `## Defence in depth`, ordered items 1–9 labelled **Isolation**, **Confinement**, **Repository-owned verification**, **Checkpoint evidence validation**, **Mandatory-artifact gatekeeper**, **Separate review, blocked self-approval**, **Classified failure handling**, **Integration gates**, **Operator decision**; layer-by-layer mapping in `CP-1.md` § "The nine defence layers, in lifecycle order" | PASS |
| 3a. Bubblewrap limitation stated | `README.md` `## Defence in depth` item 2, sentence beginning "If Bubblewrap is unavailable, Parallix warns explicitly that the agent is running unsandboxed"; grounded in `src/adapters/process/bubblewrap.ts` `isBubblewrapAvailable()` | PASS |
| 3b. Reviewer-difference limitation stated | `README.md` `## Defence in depth` item 6, sentence beginning "A *different* agent family is guaranteed only when one is runnable"; grounded in `src/application/handoff-command-use-case.ts` `resolveHandoffReviewAssignment()` and `docs/use-cases.md` UC-4 | PASS |
| 3c. ADR 0048 C4/C5 stated as scheduled, not implemented | `README.md` `## Defence in depth` closing paragraph, clause "two of them (C4 and C5: pre-validation of declared gate commands, and automatic send-back when the gatekeeper finds missing artifacts) are scheduled rather than implemented"; `ADR 0048` `## Implementation Status` records both as `⏳ Next wave` (re-read and transcribed in `CP-1.md`) | PASS |
| 4. Every mechanism claim traceable to a criterion-4 artifact | Claim→artifact mapping in `CP-1.md` § "The nine defence layers" (bolded column): `docs/use-cases.md` (layers 1, 3, 9), `src/adapters/process/bubblewrap.ts` (2), `docs/adr/0048-fail-closed-harness-defense-against-agent-hallucinations.md` (3, 4, 7, 8), `src/adapters/review/review-commands.ts` (4, 6), `src/adapters/verification/gatekeeper.ts` (5), `src/application/failure-classification.ts` (7) | PASS |
| 5. No new numeric or comparative claim; `## Use cases` byte-identical | Only figures introduced are "eight failure classes", "two attempts", and "23 check points across the five lifecycle phases" — all quoted from `ADR 0048` (`## Failure Classification`, C2 "Limit relaunch attempts to 2", `**Total: 23 check points across 5 lifecycle phases.**`). `git diff -- README.md` contains no `+`/`-` line matching `+57%` or `order of magnitude` | PASS |
| 6. Net change confined to `README.md` | `git diff --name-only c51b2b650..HEAD -- . ':!missions/'` → `README.md` and nothing else (pre-existing ` M package-lock.json` never staged) | PASS |
| 7. Removed bullet accounted for; no §2 differentiator lost | `CP-2.md` § "Deduplication performed (criterion 7)" names the removed `## Current status` "**Review coverage** is best-effort…" text verbatim and the item-6 sentence that now carries it, plus the six-differentiator survival audit against `docs/doc-standards.md` §2 | PASS |
| 8a. Documentation gate exits 0 | `./scripts/verify-local.sh docs` → exit **0**, `PASS: authored documentation contains no volatile implementation evidence and relative links resolve` | PASS |
| 8b. General gate exits 0 | `./scripts/verify-local.sh all` → exit **1**; 2455 tests / 2454 pass / 1 fail. Sole failure `test/metric-contract.test.ts` "statistics metric contract names every board and CLI decision metric with its semantic inputs", caused by `docs/metric-contract.md` lacking the required `Throughput / weekly throughput` row (`grep -c` → 0). Row dropped by `395015b45 mission/task-2469`, an ancestor of this mission's base; present again on `main`. Reproduced red with `README.md` stashed. Mission stop rule invoked | **BLOCKED — stop rule** |
| 9. No `file.ext:123` reference introduced into `README.md` | `./scripts/verify-local.sh docs` exit 0 (`scripts/verify-docs.mjs` rejects `src/`/`lib/` paths and `test/*.ts` inventories in `README.md`); the new section names no source or test path at all, per `docs/doc-standards.md` §7 and §10 | PASS |

Next action: Operator decision on the stop rule in `CP-2.md` § "Stop rule invoked" — preferred path is to let the handoff lifecycle rebase this branch onto `main`, which already carries the `Throughput / weekly throughput` row that `395015b45 mission/task-2469` dropped from `docs/metric-contract.md`, then re-run `./scripts/verify-local.sh docs` and `./scripts/verify-local.sh all` on the rebased tree and re-check the section's wording against it. Do not repair `docs/metric-contract.md` or anything under `test/` under task-2470: both are outside its Scope, `test/` is a Restricted Area, and either edit would break success criterion 6.
