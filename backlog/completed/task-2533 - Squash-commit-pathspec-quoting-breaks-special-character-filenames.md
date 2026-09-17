---
id: TASK-2533
title: >-
  Land squash commits fail on special-character filenames because the payload pathspec is git-quoted
status: done
assignee: [custom]
created_date: '2026-09-17 11:15'
labels:
  - bug
  - ai_sdlc
dependencies: []
priority: high
ordinal: 90200
---

## Description

`px integrate` aborts mid-landing when the landed payload contains a file whose
name git chooses to quote — any name with a backslash or non-ASCII byte. The
incident (task-2521.01) landed on exactly such a filename
(`backlog/tasks/task-2521.01 - Mission-1-\342\200\224-...md`) and the final
squash commit failed with:

```
[FAIL] Could not create the squash commit in the local integration checkout.
[FAIL] fel: sökvägsangivelsen ""backlog/tasks/task-2521.01 - Mission-1-\342\200\224-...md""
       motsvarade inte några av git kända filer
```

("pathspec did not match any git-known files".) The repository already carries
several of these backslash-named task files, so any later mission that touches
them hits the same wall.

## Root cause

The landed-squash step captures its payload in
`src/application/integrate/squash.ts` with:

```js
git(['-C', baseWorktree, 'diff', '--cached', '--name-only', '--']).stdout
  .split('\n')
```

Plain `git diff --name-only` emits git's **quoted/escaped** form for special
filenames: the path is wrapped in double quotes and backslashes are doubled
(`"...\342\200\224..."`). That quoted string is then passed straight into
`git commit --only -- <paths>` as a pathspec. Git pathspecs interpret the
leading `"` and the escape sequences literally, so the pathspec never matches
the real file and `git commit --only` rejects it.

The closeout-added paths (`originalTaskPath`, `completedTaskPath` from
`path.relative`) are raw and fine; only the merge-captured payload entries are
quoted. The same quoted set also feeds `isIntendedPayloadAtHead`
(`git diff --quiet HEAD -- <paths>`), so it is a latent there too.

The fix is to capture with `-z` (`git diff --cached --name-only -z`), which
emits NUL-delimited **raw** paths with no quoting — every path stays a literal
pathspec.

## Non-regression constraints (must not break)

- Normal (ASCII, no backslash) payloads must still land exactly as before.
- Do not change what is captured, only *how* it is parsed: still
  `--cached --name-only`, just NUL-delimited.
- Keep the `--only` scoping; the commit must still name only the intended
  payload so a concurrent bare-board commit never inherits ambient index
  entries.

## Acceptance Criteria

- [ ] #1 A mission whose payload includes a backslash/non-ASCII filename lands
  without the "pathspec did not match" abort.
- [ ] #2 A payload with only ordinary filenames still lands identically (same
  set of files, same commit).
- [ ] #3 The captured paths are raw literals, not git-quoted forms.

## Definition of Done

- [ ] #1 Verification gate ran and passed on the final tree with captured proof
  rather than an unverified claim
- [ ] #2 Lint and static analysis report clean on every changed file
- [ ] #3 No focused or unannotated skipped tests introduced (no .only, no bare
  .skip)
- [ ] #4 Final checkpoint Goal Check table cites real evidence using file:line
  references and test names
- [ ] #5 Docs updated to reflect any workflow or user-facing behavior change
- [ ] #6 Bug-labeled missions include a red-to-green reproduction test that
  fails before the fix and passes after

## Implementation guidance (minimal)

In `src/application/integrate/squash.ts`, change the payload capture to
NUL-delimited and split on NUL:

```js
const intendedPayloadPaths = new Set(
  git(['-C', baseWorktree, 'diff', '--cached', '--name-only', '-z', '--']).stdout
    .split('\0')
    .map(file => file.trim())
    .filter(Boolean),
);
```

## Regression test

`test/task-2533-squash-payload-pathspec-quotes.test.ts` (integration-ci): builds
a throwaway repo with a backslash-named file, asserts the quoted `--name-only`
form is rejected by `git commit --only`, and asserts the `-z` raw-path form
commits it.
