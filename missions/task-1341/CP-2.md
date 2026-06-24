# CP-2

The stats module now accepts `unknown` as a first-class classification, returns it when no task file exists, and keeps weekly/range reporting stable by surfacing unknown missions explicitly instead of throwing.

## Goal Check
| Check | Evidence |
| --- | --- |
| `unknown` is accepted as a valid classification. | `lib/commands/stats.js:35` |
| Missing task files now resolve to `{ classification: 'unknown', taskFile: null }`. | `lib/commands/stats.js:1179` |
| Weekly and range reports include an unknown-mission bucket. | `lib/commands/stats.js:544`, `lib/commands/stats.js:703`, `lib/commands/stats.js:745` |
| Unit coverage verifies missing-task classification and unknown-row persistence. | `test/stats.test.js:146`, `test/stats.test.js:156` |

Next action: update `px draft` so free-text and directory inputs synthesize a task record instead of failing before branch/worktree setup.
