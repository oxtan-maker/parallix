# Checkpoint 1 — Review-profile launcher state-home regression test

## Work done

Added failing regression tests to `test/bubblewrap-guard.test.ts` before any
production change (TDD). The tests construct the review sandbox profile for each
supported reviewer launcher and assert the contract the mission requires.

Tests (all in `test/bubblewrap-guard.test.ts`):

- `review profile grants each worktree-local launcher state home as a writable bind`
  — resolves the review profile for `codex`, `qwen`, `vibe` and asserts each
  resolved state home (`<worktree>/.workflow/<family>-home`) is in
  `profile.writable` and is writable on disk.
- `review profile grants claude the transcript directory named after the mangled worktree path`
  — resolves the review profile for `claude` and asserts
  `<HOME>/.claude/projects/<mangled-worktree-path>` is writable, and that no
  writable path is derived from the mission slug.
- `review profile grants the custom family its configured runner state homes`
  — resolves the review profile for `custom` and asserts the configured runner's
  real state home is writable and that no placeholder `custom-home` directory is
  bound.
- `review profile buildBubblewrapArgs binds the claude transcript directory writable without widening the worktree`
  — builds the bwrap args and asserts the worktree is `--ro-bind` while the
  claude transcript dir gets an explicit `--bind`.
- `review profile keeps the reviewed worktree read-only and binds no reviewed source`
  — negative assertion: a reviewed source file inside the worktree is never
  rebound writable and the worktree stays `--ro-bind`.

Regression-test name: `review profile grants each worktree-local launcher state home as a writable bind`
Test path: `test/bubblewrap-guard.test.ts`

Every test that needs a home directory stubs `HOME` to a throwaway directory
under the repository's git-ignored `.workflow/`, so the suite neither reads nor
mutates the operator's real home. The stub deliberately sits outside `/tmp`:
a home under `/tmp` would be covered by the review profile's optional `/tmp`
bind, and the writable-bind assertions would pass without exercising the bind.

### Red proof (mission parent commit)

The regression tests are red against the mission parent source. Reproduce by
restoring the parent's guard module and running the suite:

```
git show ad69d82428ff9e58ab8776b07d131065046433a4:src/adapters/process/bubblewrap.ts > src/adapters/process/bubblewrap.ts
node --import tsx --test test/bubblewrap-guard.test.ts
git checkout -- src/adapters/process/bubblewrap.ts
```

Observed at the mission parent source:

```
✖ review profile grants each worktree-local launcher state home as a writable bind
✖ review profile grants claude the transcript directory named after the mangled worktree path
✖ review profile grants the custom family its configured runner state homes
✖ review profile buildBubblewrapArgs binds the claude transcript directory writable without widening the worktree
ℹ pass 13
ℹ fail 4
```

At that commit `resolveSandboxProfile('review', …)` returns
`{ worktreeWritable: false, writable: [artifactDir], optionalWritable: ['/tmp'] }`
with no launcher state homes, so the four positive tests fail; the negative
read-only test passes.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Regression test added, red at parent, green after fix | `test/bubblewrap-guard.test.ts`; test name `review profile grants each worktree-local launcher state home as a writable bind`; red at `ad69d824` (4 fail / 13 pass), green at HEAD (17 pass / 0 fail) | PASS |
| Review profile asserts each launcher state home writable | `test/bubblewrap-guard.test.ts` → `review profile grants each worktree-local launcher state home as a writable bind`, `review profile grants claude the transcript directory named after the mangled worktree path`, `review profile grants the custom family its configured runner state homes` | PASS |
| Reviewed source / worktree stays read-only | `test/bubblewrap-guard.test.ts` → `review profile keeps the reviewed worktree read-only and binds no reviewed source` | PASS |

## Next action

Implement CP 2: make `resolveSandboxProfile` review-writable for the enumerated
launcher state homes without widening the read-only worktree mount, then run the
suite to green.
