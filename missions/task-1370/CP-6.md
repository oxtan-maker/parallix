# CP-6: Mission contract corrected after operator clarification

## Why this checkpoint exists

The branch had reached a review loop around `.gitignore` / `.eslintignore` handling for generated `lib/commands/*.js` files. The operator clarified the intended end state for this mission:

- compiled `lib/commands/*.js` should stay ignored in the worktree
- Git rename detection for the future squash into `main` should come from the tracked `.js` removal plus the tracked `.ts` addition
- the mission definition, not the TS conversion itself, was the part that had drifted

This checkpoint records that clarification so a reviewer can distinguish a contract correction from a code change.

## Contract correction

Updated the mission artifacts to match the established JS→TS migration pattern already used by the completed neighboring missions:

- Restored `lib/commands/*.js` in `.gitignore`
- Restored the canonical `.eslintignore` posture for `lib/commands/*.js`
- Updated `MISSION.md` success criteria and CP-5 narrative so they no longer claim generated command `.js` should become visible as untracked files
- Kept `## Gates` entries as executable commands only, since `runDeclaredGates()` executes the checkbox-stripped line verbatim

## Evidence

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Operator intent captured in mission artifacts | [missions/task-1370/MISSION.md](/home/magnus/code/parallix-task-1370/missions/task-1370/MISSION.md:28), [missions/task-1370/CP-5.md](/home/magnus/code/parallix-task-1370/missions/task-1370/CP-5.md:5) | PASS |
| Generated `lib/commands/*.js` are ignored, not untracked | `git status --short --ignored lib/commands` shows `!! lib/commands/*.js` entries after `npm test` / `build:cjs` | PASS |
| Required gate still passes after contract correction | `./scripts/verify-local.sh static-analysis` → `ALL STAGES PASSED` | PASS |
| Rename detection remains intact | `git diff -M --summary main..HEAD -- lib/commands/{draft,active,checkpoint,handoff}.*` shows 88%–94% renames | PASS |

Next action: branch is ready for the next review pass with the mission definition aligned to the intended migration semantics.
