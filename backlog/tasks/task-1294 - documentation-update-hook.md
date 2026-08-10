---
id: TASK-1294
title: documentation update hook
status: backlog
assignee: []
created_date: '2026-06-13 18:24'
updated_date: '2026-07-02 18:12'
labels: []
dependencies: []
ordinal: 27000
---

---

id: TASK-1294
title: make documentation single-source and resistant to drift
status: backlog
assignee: []
created_date: '2026-06-13 18:24'
updated_date: '2026-08-10 20:00'
labels: []
dependencies: []
ordinal: 27000
--------------

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->

Make Parallix documentation resistant to agent-created drift by eliminating duplicated executable facts and volatile implementation evidence from authored documentation. Current runtime facts should have one canonical authority in code, schemas, configuration, tests, or other machine-readable sources; authored Markdown should explain durable user-facing concepts, architectural invariants, and rationale rather than copy command inventories, configuration fields, source paths, line numbers, test filenames, or other implementation details that agents must keep synchronized.

Where humans need reference material derived from executable facts, generate it from the canonical source rather than maintaining a second authored copy. Update the mission workflow so documentation is changed only when human-facing meaning, supported behavior, or architectural intent changes—not merely because implementation files moved or internal structure changed.

<!-- SECTION:DESCRIPTION:END -->

## Codex Pre-Draft

**Goal:** establish a single-source documentation model for Parallix that minimizes documentation agents need to maintain, removes volatile implementation/evidence references from live prose, and makes future documentation updates follow semantic changes rather than source-tree churn.

**Scope and proof:** first audit the current live documentation and identify information duplicated from executable authorities such as CLI/runtime metadata, schemas/configuration, lifecycle/state definitions, tests, package metadata, and source layout. Classify each duplicated fact by its canonical owner, then remove the authored duplicate where practical. In particular, remove live documentation's dependency on implementation file/line evidence (`src/...:123`, historical `lib/...`, test filenames, implementation-module inventories, etc.) unless a document explicitly exists for source-code navigation. Simplify `docs/authority-reference.md` and `docs/use-cases.md` so they describe durable architectural invariants, supported capabilities, confidence/limitations, and rationale without mirroring current implementation locations. Prefer stable capability/use-case/ADR identities over source references. Do not rewrite historical ADRs, completed missions, checkpoints, or retrospective evidence merely because their historical paths are old.

For executable facts that genuinely need a human-readable reference, derive the reference from the canonical source (for example CLI metadata/help or configuration schema) and clearly mark generated output as generated/non-authoritative; verify regeneration produces no drift rather than asking agents to synchronize two authorities. Do not introduce generators merely to preserve documentation that can instead be deleted or replaced with a pointer to the executable authority.

Update documentation standards, mission drafting/execution/review guidance, and relevant scaffolding so agents follow these rules: authored docs must not reproduce volatile implementation facts; internal refactors with unchanged behavior/invariants normally have no documentation impact; user-visible behavior or architectural-intent changes update the relevant authored documentation in the same mission; project/repository content must not be treated as a reason to manufacture implementation evidence into prose. Remove existing guidance that encourages file:line references as durable documentation evidence. Checkpoint evidence may identify the exact mission tree/commit and behavioral test/gate results without turning those references into live documentation that later missions must maintain.

Add focused regression checks for deterministic anti-drift properties that are worth enforcing mechanically: live authored documentation must not accumulate file:line implementation-evidence patterns; generated documentation, if any is retained, must reproduce cleanly from its authority; Markdown links must resolve; references to removed live documentation must fail. Keep semantic truth with draft/execute/review rather than building brittle heuristics that guess documentation necessity from changed source files. Prove that a source/layout refactor can leave authored docs untouched when semantics are unchanged, while a real user-facing or architectural-invariant change is still required to update its documentation.

As the bootstrap proof, reconcile the current live documentation with current HEAD using this model. Remove stale implementation references and duplicated authorities rather than mechanically updating them to today's paths. Preserve concise README/user guidance where repetition is intentionally explanatory, but avoid exhaustive inventories that duplicate executable sources. Do not recreate removed authorities such as CHANGELOG merely to satisfy stale documentation or verification assumptions.

**Checkpoints:** (1) inventory live documentation against its canonical executable/design authorities and capture regression fixtures demonstrating current duplication/drift; (2) remove volatile implementation/evidence duplication and reduce live docs to durable concepts, invariants, capabilities, limitations, and rationale; (3) derive any genuinely necessary reference views from their canonical source and add deterministic anti-drift checks; (4) update draft/execute/review/scaffold/documentation standards so future missions update docs only for semantic documentation impact and do not reintroduce implementation evidence; (5) reconcile current live docs with current HEAD and run documentation, static-analysis, and general verification.

**Stop rule:** do not solve documentation drift by creating another metadata registry that duplicates code, by adding broad auto-rewrite agents, by mechanically updating source paths/line numbers whenever files move, or by requiring documentation changes for every mission. Prefer deleting duplicated information over automating its synchronization. Introduce generated documentation only when the reference has clear user value and a canonical machine-readable authority already exists. If a fact cannot be assigned one clear authority, resolve that authority problem rather than documenting competing versions.
