# CP-3

`px draft` now accepts free-text intent and directory paths by deriving a synthetic mission slug, creating an `unknown` synthetic task in the mission worktree, and continuing through the normal draft flow without a pre-existing backlog file.

## Goal Check
| Check | Evidence |
| --- | --- |
| Free-text and directory inputs are normalized into task-like mission slugs. | `lib/commands/draft.js:19`, `lib/commands/draft.js:35`, `lib/commands/draft.js:107` |
| Draft preflight tolerates missing main-repo task files when synthetic input is in play. | `lib/commands/draft.js:154`, `lib/commands/draft.js:163` |
| Synthetic task files are created with `unknown` classification and committed in the worktree. | `lib/commands/draft.js:564`, `lib/commands/draft.js:583`, `lib/commands/draft.js:606` |
| Unit coverage verifies free-text slug synthesis and synthetic task creation. | `test/draft-command.test.js:370`, `test/draft.test.js:631` |

Next action: remove downstream hard-fails so execute, gatekeeper, and integrate treat synthetic or missing task files as supported rather than exceptional.
