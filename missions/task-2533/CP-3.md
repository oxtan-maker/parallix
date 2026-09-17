# CP-3: final verification

The required local verification gate completed successfully. The final focused
regression covers Git's quoted display form, raw NUL-delimited path capture,
whitespace preservation, and the shared squash landing with special and
ordinary filenames.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Quoted line-delimited Git output cannot be used as a commit pathspec | `test/task-2533-squash-payload-pathspec-quotes.test.ts` — `TASK-2533: the quoted \`--name-only\` form is NOT a valid commit pathspec` | Pass |
| Raw NUL-delimited output commits the same special path | `test/task-2533-squash-payload-pathspec-quotes.test.ts` — `TASK-2533: the \`-z\` raw-path form commits the special file as a pathspec` | Pass |
| Shared squash capture uses raw cached Git paths for both consumers | `src/application/integrate/squash.ts` — `git diff --cached --name-only -z --`, `isIntendedPayloadAtHead`, and `git commit --only -- <paths>` | Pass |
| Backslash and non-ASCII payload paths land with an ordinary path | `test/task-2533-squash-payload-pathspec-quotes.test.ts` — `TASK-2533: squash landing commits backslash and non-ASCII payload paths with ordinary ones` | Pass |
| Required repository verification passes | `./scripts/verify-local.sh all` | Pass |

Next action: hand off the committed mission artifacts for Parallix lifecycle processing.
