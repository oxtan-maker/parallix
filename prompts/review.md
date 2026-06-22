Mode: review. No code changes, no repo-state edits.
Mission: {{missionPath}}
Attempt: {{attempt}}. Focus: {{focus}}.

Entrypoint: {{review_entrypoint}}

Minimum loop contract:
- Load the locked mission at `{{missionPath}}` and `AGENTS.md` before reviewing.
- Run `px review {{slug}} --verify`.
- Review the diff with `git diff {{primaryBranch}}..HEAD`. Do a detailed review, since agents tend to miss stuff and just check off boxes in the checkpoints, which is not the intent here.
- Confirm the final checkpoint document in the mission directory contains a Goal Check table citing real evidence (file:line, test names).
- Write findings to `{{artifactDir}}/{{slug}}-review-findings.md`.
- Write the formal outcome to `{{artifactDir}}/{{slug}}-review-outcome.md` and the legacy verdict (`approve` | `request-changes`) to `{{artifactDir}}/{{slug}}-review-verdict.txt`. `comment` is not a valid outcome: if you have findings but the criteria pass, use `request-changes`.
- Do not post to Forgejo directly; `px review {{slug}} --start` or `--submit` publishes the artifacts.
- Do not edit repo files; do not switch into implementer behavior.
- If workflow state, prompts, or PR history are inconsistent, report that inconsistency as a finding rather than fixing it.
- Graphify-first: before reviewing, check if `graphify-out/graph.json` exists. If it does, run `graphify query "review {{slug}} for correctness and completeness"` to get a graph-based view of the mission scope before examining the diff.
