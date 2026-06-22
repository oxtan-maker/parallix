# CP-1: Code Path Analysis

## Work Done

Identified the exact code path in `transitionTask()` where slug-to-file resolution occurs and where `commitTaskFileUpdate` is called.

### Key findings in `lib/tools/backlog.js`:

1. **Resolution** (line 407): `resolveTaskFile(slug, rootDir)` resolves the slug to a task file path. This function implements prefix matching, exact ID matching, and base-ID suffix stripping fallback.

2. **Guard insertion point** (line 413): Between resolution and any file modifications. The resolved `taskFile` is available, and no calls to `enforceTaskAssignee`, `setTaskStatus`, or `commitTaskFileUpdate` have been made yet.

3. **Commit call** (line 437): `commitTaskFileUpdate(taskFile, msg, rootDir)` is called inside the `if (changed)` block, only after status/assignee modifications.

4. **Frontmatter ID extraction**: Need to read the file content and extract the `id:` frontmatter line using `content.match(/^id:\s*([^\r\n]+)/m)`.

5. **Slug base ID extraction**: The regex `^(task-\d+)` extracts the base ID from any slug (e.g., `task-1048-regress` → `TASK-1048`).

### Guard Logic Design

- Extract frontmatter `id` from the resolved task file
- Compare against the slug's canonical form (base ID via `^(task-\d+)`)
- If slug has a suffix (pattern `^(task-\d+)-`) and the base ID does not match the frontmatter ID, warn and return `false`
- This prevents `resolveTaskFile`'s base-ID fallback from silently committing to the wrong task file

## Next action: Implement the guard in transitionTask() and add unit tests
