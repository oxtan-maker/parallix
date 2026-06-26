# CP-2

Summary of work done (CP-2 = "Draft revised `prompts/review.md` and `prompts/review-verbose.md` with an explicit separation-of-duties section."):

- Added a "Separation of duties — you are the reviewer, not the implementer" section to the compact prompt with MUST NOT / MUST / MAY blocks.
- Mirrored the same section in the verbose prompt.
- Enumerated ≥5 distinct MUST-NOT items covering code edits, branch-history operations, merge/PR operations, and workflow-state mutations, and whitelisted the artifact dir + `/tmp` as the sole permitted writes.
- Preserved all existing minimum-loop-contract bullets (mission load, `px review --verify`, diff inspection, artifact paths, Forgejo prohibition, graphify-first).

## Goal Check Table

| Check | Evidence |
| --- | --- |
| Compact prompt has an explicit Separation-of-Duties section | Section header present. Evidence: [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:18), [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:20) |
| Compact prompt lists ≥5 MUST-NOT items covering code edits, branch ops, PR ops, merge/squash, state mutations | Code edits (l.21), refactor/fix (l.22), branch-history incl. squash/reset (l.23), merge/PR/Forgejo (l.24), workflow-state mutations (l.25). Evidence: [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:23), [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:25) |
| Compact prompt whitelists artifact dir + `/tmp` as sole exceptions | MAY block. Evidence: [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:32), [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:33) |
| Verbose prompt mirrors the same section | Header + MUST NOT + MAY blocks present. Evidence: [prompts/review-verbose.md](/home/magnus/code/parallix-task-1325/prompts/review-verbose.md:21), [prompts/review-verbose.md](/home/magnus/code/parallix-task-1325/prompts/review-verbose.md:26), [prompts/review-verbose.md](/home/magnus/code/parallix-task-1325/prompts/review-verbose.md:34) |
| Existing minimum-loop-contract bullets retained | Mission load, `px review {{slug}} --verify`, `git diff {{primaryBranch}}..HEAD`, artifact paths, Forgejo prohibition all still present. Evidence: [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:8), [prompts/review.md](/home/magnus/code/parallix-task-1325/prompts/review.md:14) |
| Tests run for CP-2 | None yet; assertions added and run in CP-3. |

Next action: add assertions for the new content to `test/review-prompts.test.js` (both `buildCompactReviewPrompt` and `buildReviewPrompt`) and run the suite.
