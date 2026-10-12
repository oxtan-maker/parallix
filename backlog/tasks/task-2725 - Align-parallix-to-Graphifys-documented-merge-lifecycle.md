---
id: TASK-2725
title: Align parallix to Graphify's documented merge lifecycle
status: backlog
assignee: []
created_date: '2026-10-12 04:41'
labels: []
dependencies: []
ordinal: 223008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Make Parallix follow Graphify's documented repository lifecycle exactly, without introducing additional Parallix-specific Graphify policy.

Graphify documents that after a Git merge the repository graph should be refreshed with:

```bash
graphify update .
```

Parallix integrates missions using a squash merge into the mission's base worktree. Therefore a successful Parallix integration is exactly the kind of repository change for which Graphify documents an update.

Implement that behavior as a **general Parallix product feature** for repositories that already use Graphify.

It is not specific to Parallix self-development.

---

## Product contract

After Parallix successfully lands an integration into its base worktree:

```text
successful squash integration
        ↓
repository has Graphify active?
        │
   no ──┴── yes
   │         │
   │         ▼
   │   graphify update .
   │         │
   └─────────┴──→ integration closeout continues
```

Graphify refresh is advisory and best-effort.

It must never become part of repository correctness or integration success.

---

## Detect Graphify the same way Parallix already does

Reuse the existing Graphify detection semantics and helpers where appropriate.

A repository should be treated as Graphify-enabled only when it already has Graphify state, e.g. an existing:

```text
<base-worktree>/graphify-out/graph.json
```

and the Graphify CLI can be resolved using the existing supported resolution logic.

Do not invent another Graphify configuration flag merely for this.

Do not infer Graphify use just because Graphify happens to be installed globally.

The repository itself must already have Graphify active.

### Missing graph

If:

```text
graphify-out/graph.json
```

does not exist:

```text
skip
```

Do not create a graph.

### Missing Graphify executable

If the repository has a graph but the Graphify executable is unavailable:

```text
warn/debug as appropriate
skip
continue integration
```

Do not fail integration.

---

## Correct integration boundary

Run the Graphify update only after the integrated source tree is final.

The update must target the **base worktree into which the mission was landed**, not necessarily a globally assumed `main` worktree.

This matters because Parallix can integrate missions based on branches other than the primary branch.

Expected ordering:

```text
prepare integration
→ verification
→ squash merge / landed commit
→ required integration bookkeeping
→ Graphify update on landed base worktree
→ closeout
```

Choose the exact location according to the existing integration architecture, but the Graphify call must see the final landed tree.

Do not refresh the mission worktree that is about to be removed.

---

## Command

For an already Graphify-enabled repository, invoke the upstream-documented operation:

```bash
graphify update .
```

Do not substitute Parallix-specific variants such as:

```text
--no-cluster
custom incremental mode
shared cache logic
tree-based refresh modes
```

unless Graphify's own supported documentation changes accordingly.

Parallix owns **when its Git operation requires the upstream command**.

Graphify owns how that command performs the update.

---

## No duplicate Parallix lifecycle policy

Remove or avoid Graphify refreshes whose only justification is:

```text
review starts
state changes
agent edits code
checkpoint occurs
handoff occurs
```

unless Graphify documentation itself requires them.

Parallix should not maintain its own Graphify freshness model.

The explicit post-integration update exists because Parallix itself performs a Git operation for which Graphify documents `graphify update .`.

---

## Interaction with Graphify Git hooks

Graphify may also install its own Git hooks.

Determine whether Parallix's squash-integration commit causes Graphify's post-commit hook to perform an equivalent update.

Do not rely on assumptions.

However, product correctness must be defined by the documented Graphify integration requirement, not by incidental hook timing.

If Graphify's own installed hook reliably covers the exact landed Parallix integration operation, avoid doing the same expensive update twice.

If it does not, Parallix performs the documented:

```bash
graphify update .
```

after landing.

Keep any duplicate-suppression logic extremely simple and based on Graphify's actual documented/observable hook behavior.

Do not introduce Graphify-specific persistent state.

---

## Existing Graphify helper

Prefer adapting the existing Graphify integration helper rather than adding another command runner.

The common helper should continue to own:

- Graphify executable discovery;
- existing-graph detection;
- worktree anchoring;
- command invocation;
- failure handling;
- logging.

The caller should express simply:

> update this Graphify-enabled repository after a merge.

Do not encode integration policy inside the filesystem adapter.

---

## Naming

Current names such as:

```text
maybeUpdateGraphifyOnPrimary
```

are misleading if integration can target a non-primary base worktree.

Rename/refactor where appropriate so the abstraction describes the actual contract, e.g. conceptually:

```text
maybeUpdateGraphifyRepository(baseWorktree)
```

or equivalent.

Do not perform a broad naming cleanup outside this concern.

---

## Acceptance Criteria

- [ ] A successful Parallix squash integration into a Graphify-enabled repository performs the Graphify post-merge update documented by Graphify.
- [ ] This is normal product behavior, not special-cased to the Parallix repository.
- [ ] Graphify activation is inferred from existing repository Graphify state using the same detection semantics as the rest of Parallix.
- [ ] A repository without an existing Graphify graph incurs no Graphify command execution.
- [ ] Parallix never automatically creates a Graphify graph during integration.
- [ ] A missing Graphify executable does not fail integration.
- [ ] A failed `graphify update .` does not fail or roll back an otherwise successful integration.
- [ ] The update executes against the actual integration base worktree.
- [ ] A mission worktree that is about to be cleaned up is not refreshed instead of the landed base worktree.
- [ ] Feature-branch/base-branch integrations work correctly; Graphify behavior does not assume `main`.
- [ ] Existing worktree-isolation protections remain intact.
- [ ] Parallix does not introduce custom Graphify cache, incremental, clustering, or freshness policy.
- [ ] Any existing automatic Graphify refresh whose only justification is a Parallix lifecycle state transition is removed unless supported by Graphify's documentation.
- [ ] Graphify's own hook behavior is tested so Parallix does not knowingly execute duplicate updates for one integration.
- [ ] Relevant integration and Graphify regression tests pass.

---

## Required tests

### Graphify-enabled repository

Create an integration fixture containing:

```text
graphify-out/graph.json
```

with Graphify available through the command-runner seam.

Perform successful integration.

Prove:

```text
graphify update .
```

is invoked exactly against the landed base worktree.

---

### Repository without Graphify

Successful integration with no:

```text
graphify-out/graph.json
```

must perform zero Graphify subprocess calls.

---

### Missing executable

Repository has an existing graph, but Graphify resolution fails.

Integration still completes successfully.

---

### Update failure

Graphify returns non-zero.

Integration remains successfully landed and completed.

The failure may be logged but must not alter repository lifecycle state.

---

### Non-primary base worktree

Integrate a mission whose recorded base is not the repository primary branch.

Prove Graphify updates that base worktree and not an assumed primary checkout.

---

### Worktree isolation

Have multiple worktrees containing distinct Graphify graphs.

Prove the integration refresh touches only the worktree receiving the landed mission.

---

### Hook interaction

With Graphify's supported hook mechanism installed or faithfully represented, establish whether the squash-integration commit already performs the equivalent update.

Assert that the final implementation does not intentionally invoke two equivalent Graphify updates for one landed integration.

---

## Guardrails

Do not:

- make Graphify mandatory;
- add a `graphifyEnabled` Parallix configuration setting when existing graph detection is sufficient;
- bootstrap Graphify automatically;
- create `graphify-out/` for repositories that do not already have it;
- fail integration because Graphify failed;
- optimize around Graphify's current cache behavior;
- add Parallix-specific Graphify cache handling;
- share mutable Graphify graphs across worktrees;
- tie Graphify updates to generic lifecycle-state changes;
- special-case `oxtan-maker/parallix`.

---

## Definition of Done
<!-- DOD:BEGIN -->
The product behavior should be explainable in one sentence:

> When Parallix merges a mission into a repository that already uses Graphify, Parallix performs Graphify's documented post-merge update on that repository; otherwise Graphify is completely out of the lifecycle.

Everything below the `graphify update .` command remains Graphify's responsibility.
<!-- SECTION:DESCRIPTION:END -->

- [ ] #1 Verification gate ran and passed on the final tree with captured proof rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests were introduced (no .only and no bare .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that fails before the fix and passes after
<!-- DOD:END -->
