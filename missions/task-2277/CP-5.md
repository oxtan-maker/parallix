# CP-5 — source-checkout handoff rebase repair

The automated handoff rebase failed before any Forgejo operation because its
nested launcher executed `lib/index.js`, while this TypeScript-first checkout
tracks `lib/index.ts` and starts the CLI through `tsx px.ts`. The fix restores
the source-checkout launcher: when `px.ts` exists in the worktree,
`rebaseBeforeReviewRound` runs the local `tsx` binary with `px.ts rebase
<slug> --push`. Packaged installations without `px.ts` continue to run the
compiled `dist/px.js` entrypoint with Node.

The review-status path had a related source-runtime failure: `tsx` wraps the
CommonJS-compatible handoff module in a default export, so the lazy import
must unwrap that default before calling `performHandoff`. Compiled
distributions continue to expose named exports directly.

The focused regression test stubs both Git and the subprocess, so it confirms
the precise command without rebasing, contacting Forgejo, or requiring a
Forgejo token. This is the narrowly scoped production-runtime exception added
to the mission after the previous handoff repair was reverted as out of scope.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC8 source checkout launches `tsx px.ts rebase <slug> --push` | `lib/review/rebase.ts:164`, `test/task-1107-repro.test.js`, `"rebaseBeforeReviewRound uses the tsx source runtime in a checkout"` | PASS |
| SC8 packaged installation retains the compiled CLI entrypoint | `lib/review/rebase.ts:171`, `test/task-1107-repro.test.js`, `"rebaseBeforeReviewRound uses the compiled CLI outside a source checkout"` | PASS |
| SC8 review handoff import supports both `tsx` and compiled export shapes | `lib/review/review-commands.ts:28`, `test/review.test.js`, `"unwrapHandoffModule supports the tsx default-export wrapper"` | PASS |
| Focused regression avoids external workflow services | `test/task-1107-repro.test.js`, `"rebaseBeforeReviewRound uses the tsx source runtime in a checkout"` | PASS |
| Mission-declared verification gate passes | `./scripts/verify-local.sh all` | PASS |

Next action: submit the repaired mission for handoff; the nested rebase now uses the TypeScript source runtime in this checkout.
