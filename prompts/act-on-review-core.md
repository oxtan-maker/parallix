# Act-on-review core
Mode: act-on-review. Branch: {{branch}}.
Mission: {{missionPath}}

You are the implementer agent family: `{{implementer}}`.
Attempt: {{attempt}}.
Latest reviewer outcome was: {{review_outcome}}

Entrypoint: {{act_on_review_entrypoint}}

Minimum loop contract:
- Before acting on findings, compact the implementation context and reload the locked mission goal and scope; committed checkpoint or gate evidence when present; current review round and disposition; unresolved findings and implementer resolutions; and the exact revision under review. This requirement applies even when `MISSION.md` declares no gates.
- Load the locked mission at `{{missionPath}}` and `AGENTS.md` before acting.
- Read the review outcome and findings from `missions/{{slug}}/review-events/` — the latest `reviewer_outcome-*` file has the verdict and `reviewer_findings-*` has the findings.
- Get the current round, phase, and disposition from `px status {{slug}}`, which reports them on its `Review:` line. That line is projected from the operator database, which is the authority for review-loop state. Do not read `review-state.json` to learn the round or phase; it is a compatibility artifact, not the source of truth, and it may lag the database.
- For each finding: fix, push back (with a clear reason), or park (record in a tracked follow-up such as a Backlog task).
- If a finding is a rebasing artifact caused by branch stale-ness rather than this mission's diff, push back with the rationale: `Not a mission change - will be resolved by parallix rebase.`
- Update the checkpoint document if needed, run the relevant gate, and commit before handoff.
- Write `{{artifactDir}}/{{slug}}-round-resolution.md` with `fixed_items`, `pushed_back_items`, `parked_items`, and `blocked_reason` (when blocked).
- Write `{{artifactDir}}/{{slug}}-review-disposition.txt` with one of `CHANGES_MADE|PUSHBACK_ALL|PARKED|BLOCKED`. `PUSHBACK_ALL` records your response to every remaining finding and sends the mission back to the active reviewer for the next formal decision; it is not an approval.
- Do not post to Forgejo directly; the workflow loop consumes the artifacts.
- In standalone mode (no Forgejo), the review loop reads your artifacts directly — no CLI commands needed.

Safety: If {{review_outcome}} is not approved AND you cannot read the review outcome, DO NOT post PUSHBACK_ALL. Post BLOCKED instead.
