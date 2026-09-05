# CP-3: Link the reference and verify

## Summary

Linked the configuration reference from the README's existing configuration
paragraph. The mission gate passed after the documentation, audit records, and
bug-task records were added.

The audit also established two existing command defects: malformed config is
reported but the real CLI exits zero, and schema field violations are accepted.
They are intentionally not represented as working behavior in the reference;
their four focused backlog tasks preserve the reproductions and fix intent.

Round-one review corrected two reference inaccuracies: failed configuration is
reported while the current real CLI returns zero, and a storage path ending in
`tasks` is treated as the tasks directory rather than a storage root.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Configuration reference exists, has concrete content, and links to each audited gap | `docs/config.md`, `backlog/tasks/task-2455.01 - make-product-target-user-config-effective.md`, `backlog/tasks/task-2455.04 - preserve-config-command-failure-exit-status.md` | PASS |
| README configuration section links to the reference | `README.md`, `docs/config.md` | PASS |
| Working adapter and product configuration is documented while broken pieces have separate backlog tasks | `docs/config.md`, `backlog/tasks/task-2455.02 - make-task-provider-config-effective.md`, `backlog/tasks/task-2455.03 - enforce-workflow-config-schema-validation.md` | PASS |
| Review-identified config-reference inaccuracies are corrected | `docs/config.md`, `missions/task-2455/review-events/2026-09-05T120122-reviewer_findings-1-claude.md` | PASS |
| `px config` gives non-zero status for malformed and schema-violating input | `test/config-command.test.ts`, `backlog/tasks/task-2455.03 - enforce-workflow-config-schema-validation.md`, `backlog/tasks/task-2455.04 - preserve-config-command-failure-exit-status.md` | DEFERRED — existing real-process defects recorded separately |
| Mission verification gate passes | `./scripts/verify-local.sh all` | PASS |

Next action: Implement the four filed configuration defect tasks before changing the deferred settings from known gaps to supported overrides.
