# CP-2: raw squash payload capture

Confirmed the shared squash payload capture already requests Git's
NUL-delimited cached filename stream, removes only its terminal empty record,
and passes the same raw set to both the scoped squash commit and the
already-landed payload check. No production change was needed in this
checkpoint.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Cached payload selection remains scoped and raw | `src/application/integrate/squash.ts` — `git diff --cached --name-only -z --` | Pass |
| Parsed paths retain legal whitespace bytes | `test/task-2533-squash-payload-pathspec-quotes.test.ts` — `TASK-2533: \`-z\` capture preserves leading/trailing whitespace in filenames (no trim)` | Pass |
| Same raw set reaches intended-payload check and scoped commit | `src/application/integrate/squash.ts` — `isIntendedPayloadAtHead` and `git commit --only -- <paths>` | Pass |
| Backslash, non-ASCII, and ordinary payload files land together | `test/task-2533-squash-payload-pathspec-quotes.test.ts` — `TASK-2533: squash landing commits backslash and non-ASCII payload paths with ordinary ones` | Pass |

Next action: run `./scripts/verify-local.sh all` and capture final criterion evidence.
