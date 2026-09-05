# CP-2: Publish the audited configuration reference

## Summary

Added `docs/config.md` with field paths, schema types, built-in defaults,
behavior, and minimal JSON overrides for every audited working configuration
piece. The reference deliberately excludes the two ineffective fields and
links each known gap to a separately scoped backlog task.

Filed four independent bug tasks: ineffective `product.targetUser`, ineffective
`adapters.tasks.provider`, missing field-level schema validation, and the real
CLI's failure-status overwrite. The CP-1 audit was corrected to include the
last finding observed during the real-process command exercise.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Working configuration pieces have paths, types, defaults, behavior, and override examples | `docs/config.md`, `config/workflow.config.schema.json` | PASS |
| Ineffective product target-user setting has a separate defect record | `backlog/tasks/task-2455.01 - make-product-target-user-config-effective.md` | PASS |
| Ineffective task-provider setting has a separate defect record | `backlog/tasks/task-2455.02 - make-task-provider-config-effective.md` | PASS |
| Field-level validation and real process-status defects have separate reproduction records | `backlog/tasks/task-2455.03 - enforce-workflow-config-schema-validation.md`, `backlog/tasks/task-2455.04 - preserve-config-command-failure-exit-status.md` | PASS |
| Documentation declares the audit limitation instead of representing broken settings as working | `docs/config.md`, `missions/task-2455/CP-1.md` | PASS |

Next action: Add the configuration-reference link to the README, then run the mission's single verification gate and record its result.
