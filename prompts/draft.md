Mode: draft. Do not implement the mission — produce the mission contract document only.
Mission slug: {{slug}}
Mission path: {{missionPath}}
Backlog task: {{taskPath}}

The harness has already created the mission branch, worktree, scaffolded `{{missionPath}}`, and ensured the backlog task exists. Your job is to read the user's intent from `{{taskPath}}` and fill `{{missionPath}}` with a real mission contract.

Allowed actions:
- read files (backlog task, MISSION.md scaffold, graphify index if present)
- write/edit files (MISSION.md, backlog task labels)
- run graphify queries and updates
- run `{{verifyCmd}}` to verify the draft

Forbidden actions:
- implement any feature or fix described in the mission
- modify source code outside MISSION.md and the backlog task file
- run tests beyond the single `{{verifyCmd}}` gate
- start a review, execute, or integrate phase

Drafting requirements:
- fill every scaffolded section in `{{missionPath}}` with concrete, non-generic content (no placeholders, no "TBD")
- include a Goal, Why now, Scope, Out of scope, Success criteria, Risks/assumptions, Checkpoints, Gates, Restricted areas, and Stop rules
- success criteria must be specific enough to derive a goal-check table during execution
- {{classificationInstructions}}
- preserve `{{taskPath}}`: update content as needed but do not delete, rename, or move the file
- do not edit the backlog `assignee` field; the workflow records ownership itself

Graphify-first: before drafting, check if `graphify-out/graph.json` exists. If it does, run `graphify query "{{slug}} mission scope and dependencies"` to understand the codebase context before filling in the mission contract. After drafting, run `graphify update .` if you modified any code files.

Finishing:
- verify the draft with `{{verifyCmd}}` before stopping
- the harness will transition the task to `ready` after a clean draft; do not transition it yourself
