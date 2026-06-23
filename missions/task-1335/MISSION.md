# Mission: Harden parallix self-hosting publish path so broken trees cannot reach main (task-1335)

## Goal
Close the standalone self-hosting gap that allowed parallix `main` to advance with a broken tree. The implementation must identify every code path that can update standalone `main`, require repo-owned verification against the exact tree being published, fail closed when that proof is missing or stale, and restore the current red `npm test` baseline so the guard is proven against a real failure mode instead of a hypothetical one.

## Why Now
The backlog record states that standalone parallix `main` already reached a broken state and that the published history was squashed, which destroyed the normal mission-by-mission provenance needed to audit how the bad tree landed. In the current repo, `workflow.config.json` declares `npm test` as the verification command, but adjacent backlog context (`task-1334`) shows parts of the integration safety story still depended on monorepo-only or unversioned enforcement. This mission is urgent because the repo is currently red on `main`, and any self-hosting publish path that can bypass an exact-tree verification proof can repeat the same failure while leaving little forensic trace after squash publication.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: broken standalone `main`; squashed publication erased provenance; self-hosting publish/import paths need fail-closed exact-tree verification

## Scope
- Enumerate every standalone path that can update `main`, including `px integrate` and any publish/import/extract/sync path outside the ordinary mission integration flow that can rewrite or fast-forward the standalone primary branch.
- Trace the configured verification source of truth for this repo (`workflow.config.json` => `npm test`) and document how it is invoked today during integration or publication.
- Fix the currently failing review-loop disposition persistence regression on `main` so `npm test` returns to green before publish-path hardening is considered complete.
- Add or tighten a repo-owned verification proof mechanism that binds the gate result to the exact tree being published to standalone `main`.
- Harden each eligible publish path so it aborts when the exact-tree proof is absent, mismatched, or produced from a different checkout/commit/tree.
- Add regression coverage proving both that a broken standalone tree is blocked from reaching `main` and that the known `startReviewLoop` regression would have been stopped by the hardened path.
- Document the provenance failure mode caused by squash publication and how the new proof closes that gap for future self-hosting releases.

## Out of Scope
- Reconstructing the already-lost mission provenance for the previously broken squashed commit beyond documenting why that recovery is impossible.
- Changing Forgejo deployment policy, branch protection settings, or external CI infrastructure unless the repo code already owns that path and the change is required to enforce the exact-tree proof.
- Broad refactors of the review system unrelated to the currently failing disposition persistence regression.
- Replacing `npm test` with a different default verification command for standalone parallix.
- Rewriting backlog ownership metadata or editing the backlog `assignee` field.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

1. A checked-in mission note or implementation note enumerates every identified code path that can publish, import, extract, sync, or otherwise update standalone parallix `main`, and it explicitly distinguishes ordinary `px integrate` from any non-standard path that can still land a tree.
2. `npm test` passes from the repo root after the `startReviewLoop` disposition persistence regression is fixed, with deterministic coverage for the affected persisted dispositions already failing on current `main` (`PUSHBACK_ALL`, `BLOCKED`, `PARKED`, `CHANGES_MADE` if they are part of the red set, or the exact failing subset confirmed during implementation).
3. For each publish path identified in scope, the code verifies the exact tree being published using a repo-owned gate derived from the configured standalone verification command, and the path aborts before updating `main` when that verification exits non-zero.
4. The publish-path guard rejects stale or borrowed proof: a verification result produced from a different commit SHA, different tree hash, different checkout, or pre-squash state does not satisfy the publication requirement for the tree being published.
5. At least one automated regression test exercises a self-hosting publish path with a simulated failing standalone tree and proves the path refuses to update `main`.
6. At least one automated regression test proves the exact-tree binding, by showing that a green verification artifact/proof from one tree cannot be reused to publish a different tree.
7. The final implementation notes explain, in repo terms, why squash publication obscured the original failure’s provenance and how the new exact-tree proof restores an auditable publication boundary going forward.

## Risks and Assumptions
- Assumption: `workflow.config.json` remains the authoritative verification configuration for standalone parallix, and `npm test` is still the correct gate to bind to publication.
- Risk: there may be more than one code path that updates standalone `main`, and some may live outside the obvious `lib/commands/integrate.js` entrypoint. The mission must stop short of claiming full protection until those paths are explicitly enumerated.
- Risk: if current tests rely on monorepo-only scripts or unversioned local hooks, hardening may require replacing that dependence with repo-owned logic before the publish-path tests can be made reliable.
- Assumption: exact-tree binding can be expressed with stable git identity material already available in the repo flow, such as commit SHA and/or tree SHA, without introducing external state that operators can bypass.
- Risk: because prior publication was squashed, some historical root-cause evidence may no longer be recoverable from git history alone; the mission should document that limit rather than overclaim forensic certainty.

## Checkpoints
- CP 1: Publish surface mapped. All code paths capable of updating standalone `main` are listed, with the current verification behavior for each path recorded.
- CP 2: Baseline repaired. The failing `startReviewLoop` disposition persistence behavior on `main` is fixed and `npm test` is green again.
- CP 3: Exact-tree guard implemented. Each in-scope publish path enforces repo-owned verification tied to the tree being published and fails closed on missing or mismatched proof.
- CP 4: Regression coverage added. Tests prove both blocked publication of a broken tree and rejection of stale proof reuse.
- CP 5: Mission notes finalized. Provenance loss from squash publication and the replacement audit boundary are documented.

## Gates
- [ ] `npm test`

## Restricted Areas
- Do not edit the backlog task `assignee` field.
- Do not delete, rename, or move `backlog/tasks/task-1335 - Harden-parallix-self-hosting-publish-path-so-broken-trees-cannot-reach-main.md`.
- Do not rely on unversioned local hooks or monorepo-only scripts as the sole enforcement mechanism for standalone publication safety.
- Do not change the repo’s default verification command away from `npm test` unless a separate task explicitly authorizes that product decision.
- Do not rewrite git history to recover missing provenance; replace the missing auditability with forward-looking exact-tree proof.

## Stop Rules
- Stop if any path can still update standalone `main` but cannot be intercepted or verified from repo-owned code; document that uncovered path explicitly instead of claiming the hardening is complete.
- Stop if the current red `npm test` baseline is caused by infrastructure outside this repo rather than a repo-contained regression; document the blocker and do not proceed to claim publication safety is restored.
- Stop if exact-tree identity cannot be bound to the publish path with stable commit/tree metadata; in that case, document the failed approaches and do not ship a weaker proof that can be replayed across different trees.
- Stop if the only viable enforcement depends on operator-local state that is not versioned with the repo, because that would reproduce the same bypass class the mission is meant to remove.
