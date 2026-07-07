# Mission: Integrate captures publish proof before post-integrate build refresh (task-2203)

## Goal
Prevent Variant B integration from landing a squash commit and then aborting on stale tracked runtime artifacts before the self-hosting rebuild hook runs. The execution outcome must be: a mission that changes tracked `lib/*.ts` files either refreshes the publish-proof tree before verification or otherwise proves the exact published tree without requiring a manual `npm run build:cjs` in the primary checkout.

## Why Now
Task-2200 exposed a workflow-breaking ordering bug on July 7, 2026. In the self-hosting repository, Variant B currently captures and re-checks publish proof before the configured post-integrate hook (`scripts/refresh-global-px.sh`) runs `npm run build:cjs`. When a mission changes tracked `lib/*.ts` files, `main` can end up integrated-but-failed with stale `lib/*.js` siblings, forcing an operator cleanup step in the primary checkout. That breaks the exact-tree proof contract at the point where this repo most needs it: integrating changes to its own runtime.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: Variant B closeout ordering in `lib/commands/integrate.ts`, build-freshness enforcement in `lib/core/build-freshness.ts`, and the self-hosting rebuild path in `scripts/refresh-global-px.sh`

## Scope
- Author a deterministic failing regression test under `test/` that reproduces the task-2200 failure mode on the mission parent commit: Variant B closes a mission that changes tracked `lib/*.ts` sources, the squash commit lands, and publish-proof freshness fails before the post-integrate rebuild can refresh the compiled tree.
- Adjust the Variant B integrate/self-hosting flow so publish-proof capture and verification operate on a freshly rebuilt tree or otherwise on the exact tree that will actually be published after self-hosting closeout.
- Preserve the existing build-freshness contract in `lib/core/build-freshness.ts`; the mission fixes ordering and proof capture, not the guard itself.
- Preserve the existing post-integrate self-hosting responsibilities in `scripts/refresh-global-px.sh` unless a narrow change is required to make the proofed tree and rebuilt tree identical.
- Update or add focused test coverage for the exact closeout path changed by the fix, including the regression scenario and any helper behavior introduced to support it.

## Out of Scope
- Bypassing freshness checks with `PARALLIX_SKIP_BUILD_CHECK=1` or weakening the stale-artifact guard.
- Redesigning the entire integration pipeline, review flow, or non-self-hosting Variant A behavior beyond what is required to fix this Variant B proof-ordering bug.
- Removing or downgrading existing integration gates in `config/integration-pipelines.json`.
- Broad changes to version-bump policy, npm packaging policy, or unrelated post-integrate hook behavior.
- Opportunistic cleanup of compiled-artifact handling outside the publish-proof failure path.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The first checkpoint creates `test/task-2203-publish-proof-refresh-order.test.js`, and that test fails on the mission parent commit because Variant B verifies publish proof before the rebuild path refreshes stale tracked runtime artifacts. The red assertion must specifically show the task-2200 symptom: the integrate flow lands the squash commit but then reports stale compiled siblings or an equivalent `Could not verify the exact tree being published` failure before the post-integrate rebuild completes.
- The final implementation makes the reproduction test in `test/task-2203-publish-proof-refresh-order.test.js` pass without changing the test's expected scenario.
- A Variant B integration of a mission that changes tracked `lib/*.ts` no longer leaves the primary checkout requiring a manual `npm run build:cjs` after the squash commit lands. This must be demonstrated by automated test coverage, not only by prose.
- The exact-tree publish proof contract remains enforced: the final code path still fails if the tree being verified is stale, and the mission does not rely on `PARALLIX_SKIP_BUILD_CHECK=1`.
- The preserved behaviors remain intact after the fix:
  `scripts/refresh-global-px.sh` still performs the self-hosting bump/build/pack/install flow;
  `lib/core/build-freshness.ts` still reports stale `.js` siblings for older or missing compiled artifacts;
  non-self-hosting integrate paths do not lose publish-proof verification.
- `./scripts/verify-local.sh all` passes on the final tree, and because execution will touch `lib/`, `./scripts/verify-local.sh static-analysis` is an explicit required gate.

## Risks and Assumptions
- Risk: moving proof capture relative to the post-integrate hook could accidentally verify a different tree from the one actually published. Mitigation: require the regression test to assert against the exact publish-proof failure mode and keep the proof contract explicit in success criteria.
- Risk: the self-hosting hook currently performs both version bumping and rebuild/install work; changing ordering may expose commit-boundary assumptions in `integrate.ts`. Mitigation: keep the mission focused on the smallest ordering or proof-refresh change that makes the tree deterministic.
- Risk: Variant A and generic integrate flows share helpers with Variant B. Mitigation: preserve non-self-hosting behavior explicitly and add focused coverage around the touched path.
- Assumption: the authoritative failure is in the Variant B closeout sequence, not in `build-freshness.ts` itself; the guard is behaving correctly by rejecting stale compiled siblings.
- Assumption: a deterministic test can simulate the stale `lib/*.js` sibling condition without requiring real global install side effects.

## Checkpoints
- CP 1: Author the failing reproduction test first. Create `test/task-2203-publish-proof-refresh-order.test.js` covering a Variant B self-hosting integration where a mission changes tracked `lib/*.ts` files and stale compiled `.js` siblings exist in the primary checkout. The red assertion must prove that the mission parent commit fails because publish proof is checked before the rebuild refreshes the tree; once the fix lands, the same assertion turns green.
- CP 2: Change the Variant B closeout / publish-proof ordering so the verified tree is freshly rebuilt or otherwise exactly matches the tree being published, without weakening build-freshness enforcement.
- CP 3: Add or update focused regression coverage for any helper or hook interactions introduced by the fix, and verify non-self-hosting publish-proof behavior remains intact.
- CP 4: Run the mission gates, capture proof that the reproduction test is green, and confirm no manual build-refresh step is required after the automated Variant B path completes.

Reproduction-Test: test/task-2203-publish-proof-refresh-order.test.js

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not bypass build freshness with `PARALLIX_SKIP_BUILD_CHECK=1`.
- Do not remove or downgrade the publish-proof verification contract in `lib/core/build-freshness.ts` or its callers.
- Do not remove or weaken existing integration gates in `config/integration-pipelines.json`.
- Do not rewrite the entire self-hosting hook; keep `scripts/refresh-global-px.sh` focused on its existing bump/build/pack/install role unless a minimal adjustment is required by the proof-ordering fix.
- Do not broaden the mission into unrelated integrate cleanup, backlog workflow changes, or packaging-policy redesign.

## Stop Rules
- Stop if the only viable path is to skip or silence publish-proof freshness instead of verifying the exact rebuilt tree.
- Stop if fixing Variant B requires changing the semantics of `PARALLIX_SKIP_BUILD_CHECK` or disabling the self-hosting hook entirely.
- Stop if the reproduction test cannot be made deterministic enough to fail red on the parent commit and pass green after the fix; capture the blocker rather than shipping a vague contract.
- Stop if unrelated pre-existing failures in `./scripts/verify-local.sh static-analysis` or the focused integrate path prevent attribution to this mission's diff.
