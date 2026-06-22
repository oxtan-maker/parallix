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
- do not edit repo files
- stop once the artifact files are written
