# CP-1: squash payload pathspec regression

Added a throwaway-repository regression guard that exercises the real squash
landing with backslash, non-ASCII, and ordinary payload paths. The focused
checks assert Git's quoted display form cannot be a commit pathspec and that the
raw NUL-delimited form commits the special path, including whitespace-safe
parsing. These are regression assertions against the shared capture, not a
red-to-green production fix (the `-z` protocol already existed at the mission
parent).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Quoted display form fails as commit pathspec (regression guard) | `test/task-2533-squash-payload-pathspec-quotes.test.ts` — `TASK-2533: the quoted \`--name-only\` form is NOT a valid commit pathspec` | Pass |
| Raw NUL paths commit special filenames | `test/task-2533-squash-payload-pathspec-quotes.test.ts` — `TASK-2533: the \`-z\` raw-path form commits the special file as a pathspec` | Pass |
| Squash landing retains raw special and ordinary payload paths | `test/task-2533-squash-payload-pathspec-quotes.test.ts` — `TASK-2533: squash landing commits backslash and non-ASCII payload paths with ordinary ones` | Pass |
| Focused regression is runnable in the CI-safe integration tier | `node --import tsx --test test/task-2533-squash-payload-pathspec-quotes.test.ts` | Pass |

Next action: confirm the shared squash capture uses the NUL-delimited raw-path protocol for both commit and intended-payload checks.
