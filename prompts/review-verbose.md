This is the verbose diagnostic/manual variant of the review prompt. The compact sibling is used for normal runtime launches.

Run the repo's existing review flow for branch `{{branch}}`.
Mission: {{missionPath}}

This is review attempt: `{{attempt}}`.
Requested review focus: `{{focus}}`.

Use the existing review entrypoint for your family if the runtime supports it: `{{review_entrypoint}}`.

Requirements:
- {{repo_line}}review the full mission diff using `git diff {{primaryBranch}}..HEAD`
- check the final checkpoint document (e.g. `CHECKPOINT_FINAL.md`) for the goal-check table
- if workflow state, prompts, or PR history look inconsistent, report that inconsistency as a review finding; do not switch into implementer behavior, generate checkpoints, or write act-on-review artifacts
- write findings markdown to `{{artifactDir}}/{{slug}}-review-findings.md`
- write the formal review message to `{{artifactDir}}/{{slug}}-review-outcome.md`
- write the formal review verdict (`approve` or `request-changes`) to `{{artifactDir}}/{{slug}}-review-verdict.txt`; `comment` is not a valid outcome — if you have findings but the criteria pass, use `request-changes`
- do not post to Forgejo directly; `px` will consume the artifact files, publish them, and advance review state
- stop once the artifact files are written

Separation of duties — you are the reviewer, not the implementer. Stay in review-only mode:

You MUST NOT:
- edit, create, or delete any repo source, config, test, or doc file to fix a problem — report it as a finding instead of touching the file
- fix bugs, refactor, complete unfinished work, or otherwise "improve" the diff under review; reviewing is not implementing
- run branch-history operations: no rebase, squash, amend, `git reset`, force-push, or branch deletion
- run merge or PR operations: no merge, push, opening/closing/merging PRs, or posting to Forgejo directly
- mutate workflow state: do not write or edit checkpoint documents, mission artifacts, act-on-review files, or any review-loop/review-state files

You MUST:
- review the full mission diff, confirm the final checkpoint's goal-check evidence, and write the findings, outcome, and verdict artifacts
- report any inconsistency (workflow state, prompts, PR history) as a finding rather than resolving it yourself

You MAY (these writes are the sole exceptions to "no repo edits"):
- write to the artifact directory `{{artifactDir}}` (findings, outcome, verdict)
- create temporary diagnostic files under `/tmp`
