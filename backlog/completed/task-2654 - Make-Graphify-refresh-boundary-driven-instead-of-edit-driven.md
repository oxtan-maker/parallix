---
id: TASK-2654
title: Make Graphify refresh boundary-driven instead of edit-driven
status: done
assignee: [codex]
created_date: '2026-10-06 04:37'
labels: []
dependencies: []
ordinal: 166008
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Reduce Graphify-related lifecycle overhead in Parallix without weakening agent codebase understanding or review correctness.

Parallix currently treats Graphify freshness too eagerly:

- agents are instructed in several prompts to run `graphify update .` after modifying code;
- the autonomous review workflow performs a synchronous Graphify refresh before review setup;
- the actual pre-review rebase happens after that refresh, meaning Parallix can pay the refresh cost and then immediately make the graph stale;
- successful integration also refreshes the primary-worktree graph.

Graphify itself supports incremental updates and is designed to tolerate temporarily stale graphs. Graph freshness is useful context for agents, but it is not part of Parallix's repository-correctness boundary.

Change the policy from:

> keep Graphify continuously current while an agent works

to:

> refresh Graphify at lifecycle boundaries where freshness materially improves the next consumer's decisions.

The primary target is one fresh graph immediately before autonomous review of the final verified tree, rather than repeated refreshes throughout implementation.

---

## Problem to validate

Current main contains at least these behaviours:

### Agent-side eager refresh instructions

Inspect all current instructions and templates, including at minimum:

- `AGENTS.md`
- `templates/AGENTS.md.template`
- `prompts/execute-core.md`
- `prompts/act-on-review.md`
- `prompts/draft-core.md`

They currently contain variants of:

```text
Run `graphify update .` after modifying code.
```

This encourages repeated updates inside one mission.

### Pre-review refresh ordering

Current review startup calls Graphify before the review workflow has performed its pre-review rebase.

Relevant code currently includes:

- `src/application/review-loop/review-loop.ts`
- `src/application/review-loop/pre-review.ts`
- `src/adapters/review/review-loop.ts`
- `src/adapters/review/review-agent-fallback.ts`
- `src/adapters/filesystem/mission-graphify.ts`

The current effective order is approximately:

```text
graphify update
→ prepare review
→ rebase onto current base
→ run pre-review verification
→ launch reviewer
```

This means the refresh can be made stale by the rebase it precedes.

### Post-integration refresh

The successful integration path currently refreshes Graphify in the primary/base worktree.
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
