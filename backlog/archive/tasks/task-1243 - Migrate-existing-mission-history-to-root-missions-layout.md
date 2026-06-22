---
id: TASK-1243
title: Migrate existing mission history to root missions/ layout
status: backlog
assignee: []
created_date: '2026-06-04 04:45'
updated_date: '2026-06-13 18:13'
labels:
  - ai_sdlc
dependencies:
  - TASK-1233
priority: low
ordinal: 4000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Bulk-migrate existing missions from docs/missions/<year>/<slug>/ to missions/<slug>/

task-1233 changes the *default* mission-artifact path to `missions/<slug>/` (dropping the `<year>` tier) for newly-created missions. This task performs the one-time bulk migration of all **existing** history so WrGroceries has a single convention rather than a split brain.

### Why this is a separate task

Measured blast radius (2026-06-04): **279 mission directories / 1,916 files** to move, plus **796 files reference `docs/missions`** and need rewriting (262 in `backlog/`, 469 in `docs/`, 45 in `workflow/`, plus `AGENTS.md`, `.githooks`, k8s, scripts). This is a ~2,700-file mechanical change — too large and too risky to fold into task-1233's config contract, and it has a self-referential hazard (task-1233's own artifacts live under `docs/missions/2026/task-1233/`).

### Preconditions

- task-1233 has landed (default path logic now points at `missions/<slug>/`; `<year>` tier removed from `review-events.js` / `mission-utils.js`).
- **Run when no mission is in-flight** (no active review round), so the move does not collide with a live mission's review-state machinery.

### Scope

1. `git mv` all `docs/missions/<year>/<slug>/` → `missions/<slug>/`. Resolve any slug collisions across years explicitly (decide a disambiguation rule if two years share a slug).
2. Rewrite all 796 referencing files from `docs/missions/<year>/<slug>` and `docs/missions/<slug>` forms to `missions/<slug>` (code, tests, backlog task bodies, docs, AGENTS.md, hooks, scripts).
3. Update any code/tests that still assume the `docs/missions` base or `<year>` tier after task-1233.
4. Remove the now-empty `docs/missions/` tree.
5. Verify: no remaining reference to `docs/missions` outside historical ADR text; `./scripts/verify-local.sh docs` passes; the workflow can create and resolve a new mission at `missions/<slug>/`.

### Approach

Scripted and reviewable: a migration script (git mv + reference sweep) plus a verification pass, so the diff is mechanical and auditable rather than hand-edited across 2,700 files.

### References

- task-1233: changes the forward default + path logic (dependency)
- `workflow/lib/review-events.js`, `workflow/lib/mission-utils.js` — `<year>`/`docs/missions` path logic
- Blast-radius recon: 279 dirs / 1,916 files moved, 796 referencing files
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All existing missions are moved from docs/missions/<year>/<slug>/ to missions/<slug>/ via git mv, with any cross-year slug collisions resolved by a documented rule
- [ ] #2 All ~796 referencing files (backlog, docs, workflow, AGENTS.md, hooks, scripts) are rewritten to the missions/<slug> form
- [ ] #3 The docs/missions/ tree is removed and no reference to docs/missions remains outside historical ADR text
- [ ] #4 ./scripts/verify-local.sh docs passes after migration
- [ ] #5 The workflow can create and resolve a new mission at missions/<slug>/ end to end
<!-- AC:END -->
