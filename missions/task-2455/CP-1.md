# CP-1: Audit and classify configuration

## Summary

Audited every schema-declared `product` and `adapters` field against its
resolver and runtime consumer, and exercised the read-only config command.
The working surface is `product.name`; task storage and state-map paths;
mission layout, branch, worktree, and primary-branch settings; verification;
review; agent limits, models, runners, and subagent limits; and the
post-integrate hook.

Four independent pieces are not ready to document as working configuration:

1. `product.targetUser` is accepted and merged but has no runtime consumer.
2. `adapters.tasks.provider` is accepted and merged but has no runtime
   consumer; the task implementation remains backlog-md-specific.
3. `px config` does not enforce the schema's field-level types, enums, or
   unknown-property constraints. `validateWorkflowConfig` currently checks
   only top-level/adapter object shape and `agents.maxConcurrentCustom`.
4. In the real CLI process, malformed JSON prints the expected failure message
   but exits zero: the entry point overwrites the command's `process.exitCode`
   with its resolved result. The mocked command tests do not exercise that
   process boundary.

The third and fourth findings mean the mission's schema-violation and
non-zero-exit command criteria are not currently satisfiable without code
fixes, which are out of scope. CP-2 will file a bug task for each gap and
document only the audited, working fields.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Every product and adapter field was cross-referenced with the public schema and runtime resolution | `config/workflow.config.schema.json`, `src/adapters/config/product-config.ts`, `src/adapters/filesystem/mission-paths.ts`, `src/adapters/verification/verification.ts` | PASS |
| Config command reports malformed JSON and structural violations non-zero | `test/config-command.test.ts`, `"config reports malformed JSON as fallback defaults and exits non-zero"`, `"config reports structurally invalid overrides as fallback defaults and exits non-zero"` | PASS |
| Schema-declared fields without an end-to-end consumer are classified as broken | `config/workflow.config.schema.json`, `src/adapters/config/product-config.ts`, `src/interfaces/cli/runtime.ts` | PASS |
| Field-level schema validation gap is recorded rather than hidden | `src/adapters/config/product-config.ts`, `test/config-command.test.ts` | PASS |
| Real CLI process preserves config-command failure status | `src/entry/px.ts`, `src/adapters/cli/commands/config.ts` | FAIL — malformed JSON exits 0 in the audited process |

Next action: Author the working-field reference in `docs/config.md` and create four independent backlog bug tasks for the classified gaps.
