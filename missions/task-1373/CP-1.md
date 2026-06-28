# CP-1: backlog.ts Converted

## Summary

Converted `lib/tools/backlog.js` (834 lines) to `lib/tools/backlog.ts` (835 lines). Changes:
- Replaced 6 `require()` calls with ES `import` statements (fs, path, git, fmt, mission-utils, product-config)
- Replaced `module.exports = {...}` with 24 individual ES `export` statements
- Added explicit TypeScript type annotations to all function declarations
- Preserved all 21 exported names plus internal helpers

## Goal Check

| Criterion | Evidence |
|---|---|
| tsc --noEmit clean | `npx tsc --noEmit` reports 0 errors |
| test/backlog.test.js passes (58/58) | resolveTaskFile reports ambiguous task keys, getAcceptanceCriteria extracts rendered checklist items, backlog mission type comes from exactly one supported label, getTaskAssignee handles empty-array/inline-array/block-form assignees, resolveTaskFile finds tasks in backlog/completed, resolveTaskFile finds tasks in backlog/archive/tasks, resolveTaskFile prefers completed over archived duplicates, findTaskFile returns null when resolution is ambiguous, resolveTaskFile finds exact id match, resolveTaskFile falls back to base task id for suffixed slugs, resolveTaskFile reports ambiguous base-id matches, reportTaskResolution logs actionable guidance, checkBacklogIntegrity reports mismatched frontmatter ids, checkBacklogIntegrity accepts dotted subtask ids, getTaskStatus reads YAML and rendered status formats, completeTask moves active tasks into backlog/completed, completeTask marks already-completed tasks done in place, setTaskAssignee updates empty assignee list, setTaskAssignee inserts new assignee, setTaskAssignee returns false when no assignee field |
| No module.exports remains | `grep -c 'module.exports' lib/tools/backlog.ts` returns 0 |
| No require() remains | `grep -c 'require(' lib/tools/backlog.ts` returns 0 |
| All exports preserved | 24 ES export statements (21 original + parseAssigneeFamilies + clearTaskAgentAssignee) |

## Next action
Convert `lib/tools/gatekeeper.js` to `gatekeeper.ts` (CP-2).
