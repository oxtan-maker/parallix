# CP-2: MISSION.md template updated with NEL bucket

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| SC1: Template contains "Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)" | `templates/mission-scaffold.md:10` now reads `- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)` | PASS |
| SC1: Template does not contain "Estimated agent % usage limit" | `templates/mission-scaffold.md` grep for "Estimated agent % usage limit" returns 0 matches | PASS |
| SC1: Active mission (task-1379) updated | `missions/task-1379/MISSION.md:13` now reads `- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)` | PASS |
| No percentage-band field remains in template | `templates/mission-scaffold.md:9-13` Refinement Signals section has no percentage bands | PASS |

Next action: CP-3 — Wire handoff NEL capture into handoff.js.
