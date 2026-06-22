# CP-2: Guard Implementation and Unit Tests

## Work Done

Implemented the defensive guard in `transitionTask()` and added two unit tests in `test/backlog.test.js`.

### Changes to `lib/tools/backlog.js` (lines 414-426):

Added a guard immediately after resolution and before any file modifications:

```javascript
// Guard: reject suffixed slugs (e.g. "task-1048-regress") to prevent
// resolveTaskFile's base-ID fallback from silently committing to the
// wrong task file when the slug's base ID does not match the resolved
// file's frontmatter id.  See TASK-1265 for the original incident.
const slugHasSuffix = /^(task-\d+)-/i.test(slug);
if (slugHasSuffix) {
  log(fmt.status('WARN',
    `Task ${fmt.slug(slug)} rejected: slug "${slug}" has a suffix; ` +
    'use the exact task id instead to avoid committing to the wrong file.'));
  return false;
}
```

### Changes to `test/backlog.test.js`:

1. **Test: `transitionTask rejects suffixed slug regardless of frontmatter id match`** (lines 817-846): Creates a temp repo with two tasks — `task-1048.md` (id: TASK-1048) and `task-1048-regress.md` (id: TASK-1049). Invokes `transitionTask('task-1048-regress', 'active')` which resolves to the trap file via prefix match. Asserts: returns `false`, no stray commit created, task file unmodified, warning logged. Note: the guard rejects on slug shape alone; the test uses differing frontmatter ids for realism but the guard would reject even if ids matched.

2. **Test: `transitionTask permits exact slug match (no suffix)`** (lines 848-866): Creates a temp repo with `task-1048.md` (id: TASK-1048). Invokes `transitionTask('task-1048', 'active')`. Asserts: returns `true`, commit created with exact slug.

3. **Fixed existing test**: `transitionTask commits a Backlog task update when invoked from a sibling mission worktree` — changed slug from `task-1104-sibling` (suffixed) to `task-2104` (exact match) to be compatible with the guard. Updated task file to `task-2104-sibling.md` with `id: TASK-2104`. This is a behavior change: the guard prevents suffixed slugs from committing, so any existing caller using a suffixed slug must be updated (caller audit shows no production callers do this).

### Local verification

- Both new tests pass individually: `node --test --test-name-pattern='transitionTask rejects suffixed slug|transitionTask permits exact slug' test/backlog.test.js`
- Full test suite: 1558 pass, 0 fail

## Goal Check

| # | Criterion | Evidence | Status |
|---|-----------|----------|--------|
| 1 | Suffixed slug returns false, no commit | `test/backlog.test.js:817-846` — test asserts `ok===false`, no commit, warning logged | PASS |
| 2 | Exact slug match commits normally | `test/backlog.test.js:848-866` — test asserts `ok===true`, commit with exact slug | PASS |
| 3 | Missing task returns false (original path preserved) | `lib/tools/backlog.js:408-411` — existing resolution check unchanged | PASS |
| 4 | Guard does not alter return value when slug has no suffix | `test/backlog.test.js:863` — `ok===true` for exact match | PASS |
| 5 | All existing tests pass | `npm test` — 1558 pass, 0 fail | PASS |

## Behavior Change Note

An existing test (`transitionTask commits a Backlog task update when invoked from a sibling mission worktree`) was rewritten because the guard changes behavior for suffixed slugs. The original test used slug `task-1104-sibling` which has a suffix and was previously accepted. It now uses exact slug `task-2104`. Caller audit confirms no production callers pass suffixed slugs.

## Next action: Run full test suite and verify zero regressions (CP-3)
