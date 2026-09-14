# Mission: Implement fast single-developer GitHub publication mode (github-publish) (task-2500.02)

## Goal
Add a `github-publish` publication mode to the Parallix workflow so that the exact, locally-generated integration commit becomes the commit GitHub independently verifies **before** that commit is allowed to advance remote `main`. Local development keeps integrating at full speed while GitHub verifies each resulting commit asynchronously; remote `main` advances only through the highest contiguous run of externally verified local integration commits.

Concretely, the mode replaces the current "squash-merge onto `main` then verify" ordering with "publish exact commit → verify on a verification ref → advance `origin/main` through contiguous verified commits":

```
origin/main = P
local main  = P
P -> A -> B -> C            (local main advances through integrations)
A/B/C each pushed unchanged to a verification ref (exact SHA preserved)
once A verified AND A is the direct next unpublished descendant of origin/main -> advance origin/main to A
then B, then C
```

The invariant: `origin/main` advances only through the highest contiguous sequence of externally verified local integration commits. `P -> A -> B -> C -> D` with `A ✅ B ✅ C ❌ D ✅` may advance through B but must NOT skip C and publish D.

## Why Now
Mission 1 (TASK-2500.01) delivers the shared abstraction this mode builds on; the workflow currently squash-merges each mission onto `main` via Variant B (`src/adapters/cli/commands/integrate.ts` → `integrate-conflict.ts` → `integrate-post.ts`) and runs GitHub verification as an integration gate **before** the commit lands. The verified SHA therefore never reaches `main` — GitHub is verifying a throwaway squashed commit, and GitHub CI latency is serialized into development latency. This mode decouples verification from publication so GitHub latency becomes publication latency, not development latency, while keeping the fail-closed invariant that protected `main` only advances through verified, contiguous history. It can run in parallel with Mission 3 (TASK-2500.03).

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: Medium
- Selection note: workflow + orchestration change; touches git adapter, integration post-flow, board projections, and CLI status. Size is Large because it adds a new publication engine, a verification-ref lifecycle, a state machine, recovery paths, and operator status — but it stays additive to the existing squash-merge path, which bounds the blast radius.
- Main drivers: GitHub verification currently verifies a squashed commit that never reaches `main`; this mode makes the exact integration commit the verification target and gates remote `main` advancement on contiguous external verification.

## Scope
- New `github-publish` mode, opt-in via configuration, additive to (not a replacement for) the existing trunk-based squash-merge integration path.
- The exact locally-generated integration commit is published to a verification ref unchanged: no GitHub-side squash/rebase/recreation, no local squash onto `main` for commits that will be published under this mode.
- A mission/commit-level state machine with durable states: `locally integrated`, `external verification pending`, `externally verified`, `published`, `external verification failed`. Internal state/evidence is acceptable; do not necessarily add board lanes.
- A publication engine that, on each poll, advances `origin/main` only through the highest contiguous run of `externally verified` commits that are also the direct next unpublished descendants of `origin/main`, and fails closed when `origin/main` is no longer the expected ancestor.
- No force-push of protected `main`; exact SHA preserved through verification and publication.
- Recovery for: verification failure; GitHub unavailable; verification ref already exists; local main ahead by multiple missions; remote main unexpectedly moved; verification completed out of order; retry after transient GitHub failure.
- Operator status command exposing: local integration head, published head, missions awaiting verification, missions verified but blocked behind an earlier mission, and failed verification.
- Tests covering every Acceptance Criterion (#1–#6) against the exact commit, out-of-order completion, failed-earlier-blocks-later, fetch-does-not-rewrite, and unexpected remote movement.

## Out of Scope
- Changing the existing default squash-merge integration behavior; that path must remain intact and independently tested.
- Authoring or maintaining the GitHub Actions workflow file itself (operator CI definition); the mode wires the trigger and verification ref to operator-provided CI, it does not define the CI job contents.
- Multi-developer publication coordination, sharded verification, or distributed verification scheduling.
- Any change to Forgejo PR review/sync-merged flow beyond what is required to leave the PR untouched while the commit is being verified.
- Board lane vocabulary changes; the domain records state, the projection renders it.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and tied to an Acceptance Criterion (#N). No subjective adjectives or vague quantifiers.

- [SC1] #1 A test drives `P -> A -> B -> C` on local `main` while `origin/main` advances to `A`, and asserts the published commit for A, B, and C are the exact local integration SHAs (no rewrite of B or C). (`test/`, exact-SHA assertions)
- [SC2] #2 A test completes verification for C before A/B (out of order) and asserts `origin/main` still advances only in `A, B, C` order, never skipping. (`test/`)
- [SC3] #3 A test marks A as `externally verified: failed` and asserts B and C are not published even when B and C are green. (`test/`)
- [SC4] #4 A test fetches an updated `origin/main` that contains the same published commits and asserts local history is not rewritten or diverged. (`test/`)
- [SC5] #5 A test moves `origin/main` forward unexpectedly (ahead of the expected ancestor) and asserts the publication engine fails closed (no advance, explicit failure), never force-pushes. (`test/`)
- [SC6] #6 No path force-pushes protected `main`; the exact SHA is asserted unchanged from integration through verification through publication across the suite. (`test/`, `git` ref assertions)
- [SC7] The existing squash-merge integration path still passes its prior tests unchanged (no regression to trunk-based integration).
- [SC8] `./scripts/verify-local.sh all` passes on the final tree, including the new tests.

## Risks and Assumptions
- **Exact-SHA preservation.** The workflow's post-integration flow rewrites history (squash, worktree-path rewrite, noise patches). Assumption: under `github-publish` mode the commit is published verbatim; risk that existing post-integration transforms mutate the SHA. Mitigate by gating those transforms behind the mode.
- **Force-push safety.** Advancing `origin/main` must use a fast-forward to the contiguous verified commit; any divergence must fail closed. Risk: a race where `origin/main` moves between the expected-ancestor check and the push. Assume operator uses a single developer; still fail closed on mismatch.
- **Verification-ref naming/collision.** The verification ref must be unique per commit and handle the "ref already exists" recovery without clobbering. Assumption: ref encodes the commit SHA.
- **Parallel mission.** Mission 3 runs in parallel and shares the Mission 1 abstraction; assume no conflicting edits to the shared module and coordinate on the abstraction's shape.
- **CI trigger latency.** Verification completion depends on operator-provided CI; the engine must treat slow/unavailable GitHub as `pending` with retry, not as failure.
- **Protected branch.** Assume `main` is protected; the engine must never force-push and must respect the expected-ancestor invariant.

## Checkpoints
- CP 1: Design and state model — publication state machine, verification-ref naming, fail-closed invariant. Author an ADR.
- CP 2: Verification-ref publication — the exact integration commit is published unchanged; SHA preserved. (AC #6)
- CP 3: Verification polling and state transitions — `locally integrated` → `external verification pending` → `externally verified` / `external verification failed`. (AC #1)
- CP 4: Publication engine — contiguous advancement of `origin/main`; out-of-order completion ordering. (AC #1, #2, #3)
- CP 5: Fetch safety and fail-closed divergence on unexpected remote movement. (AC #4, #5)
- CP 6: Recovery paths — verification failure, GitHub unavailable, ref exists, multiple missions ahead, remote moved, out-of-order, transient retry.
- CP 7: Operator status command exposing local head, published head, awaiting/verified-blocked/failed.
- CP 8: Final integration gate — full suite green, squash-merge path unregressed.

### Checkpoint Documentation Requirements
Use durable evidence Parallix verifies today: exact test names, ADR references, existing test-file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when necessary but discouraged because line numbers rot.

Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The 3-column table `| Criterion | Evidence | Status |`
- At least one evidence row for every applicable success criterion, using the durable evidence forms above. Test names must match a repository test; ADR references must name an existing `docs/adr/` ADR; test paths must exist.
- **Weak-agent failure mode:** raw `stat`/`ls` output or generic prose alone is not enough. Pair shell output with an accepted reference above; for example, cite the exact test name and file, an ADR, or a recognized `npm`, `node`, `git`, `px`, or `./...` command. A bare directory listing or SHA is rejected.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Publication state model documented | `docs/adr/0058-github-publish-mode.md`, `ADR 0058` | PASS |
| Exact commit published unchanged | `` `npm test -- test/task-2500.02-publish.test.ts` ``, `"exact integration SHA preserved through verification ref"` | PASS |
| Contiguous advancement fails closed on gap | `` `node --import tsx test/e2e-github-publish.test.ts` ``, `"origin_main advances only through contiguous verified commits"` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify the existing default squash-merge integration path (`integrate.ts`, `integrate-conflict.ts`, `integrate-post.ts`) except by gating their history-mutating steps behind the `github-publish` mode flag so the default behavior is byte-for-byte unchanged.
- Do not force-push to `origin/main` or any protected branch; never rewrite published history.
- Do not modify the `assignee` field on the backlog task (the workflow records ownership).
- Do not author the GitHub Actions CI job contents; only wire trigger and verification ref.
- Do not push any mission branch to `origin` (GitHub); the `review` remote is the sole push target for review, and `main` is the only branch pushable to `origin` (per repo policy).
- Do not add board lane vocabulary; state lives in the domain, rendering stays in the projection.

## Stop Rules
- Stop before implementing if the shared Mission 1 abstraction is not yet present in this worktree; report the gap and defer.
- Stop if preserving the exact integration SHA would require mutating the default squash-merge path; surface the conflict rather than silently changing default behavior.
- Stop if `./scripts/verify-local.sh all` fails; fix within scope or stop and report — do not ship a red gate.
- Stop if advancing `origin/main` would require a non-fast-forward push; fail closed and report instead.
- Stop after the final integration gate passes; do not start a review, execute, or integrate phase, and do not transition the task to `ready` (the harness does that after a clean draft).
