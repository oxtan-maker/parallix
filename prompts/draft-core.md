# Draft core
Mode: draft. Do not implement the mission — record the mission contract.
Mission slug: {{slug}}
Backlog task: {{taskPath}}

The harness has already created the mission branch, worktree, mission record, and backlog task. Your job is to turn the user's intent from `{{taskPath}}` into a complete mission record. There is no mission document to write; every fact below is recorded with a command.

Allowed actions:
- read files and graphify index if present
- run graphify queries and updates
- run `{{verifyCmd}}` to verify the draft

Forbidden actions:
- implement any feature or fix described in the mission
- modify source code
- run tests beyond the single `{{verifyCmd}}` gate
- start a review, execute, or integrate phase

Mission state authority: `px status {{slug}}` is the authority for recorded Mission facts.

Record the mission contract with typed commands. The slug is inferred from this worktree, and every write takes `--expected-version <n>` from the `version` field reported by `px status {{slug}}`:

- `px goal set --goal <text> --why <text>`
- `px scope set --scope <text> [--out-of-scope <text> ...]` — what the mission covers, and what it deliberately leaves alone.
- `px criterion add --text <criterion>` — one call per success criterion: something that must be true for the mission to be done.
- `px checkpoint plan --name <CP-N> --text <what it delivers>` — one call per checkpoint, in execution order (`CP-1`, `CP-2`, ...). Execution works through this plan and records each checkpoint's evidence under its name.
- `px gate add --command <command>` — one call per gate. Recorded gates are what handoff executes.
- `px nel set --predicted <Small|Medium|Large>` — the predicted net-engineering-lines bucket.

A write against a stale version is rejected with an explicit conflict and changes nothing; re-read and retry. Run any command with `--help` for its exact flags.

The draft is not complete until `px status {{slug}}` reports every one of: a goal, a why, a scope, at least one success criterion, a checkpoint plan, at least one declared gate, and a predicted NEL bucket — plus a reproduction test for a `bug` mission. Record what is out of scope too whenever the mission deliberately leaves something alone; it is the boundary review checks the diff against, but it is not required. Read it back and check each one before you finish; anything it does not report was not recorded.

This is enforced, not advisory: the draft does not complete while any of the required parts above is missing, and names what it is missing. A draft that ends without them does not become a mission.

Plan the checkpoints; do not record their evidence. `px checkpoint record` is for execution: evidence is what the work produces, and there is nothing to cite yet.

Drafting requirements:
- record a concrete, non-generic goal, rationale, scope, out-of-scope, success criteria, checkpoint plan and gates; no placeholders or "TBD"
- plan checkpoints as coherent, independently verifiable slices of the work; together they must cover every success criterion
- each success criterion must be specific and checkable: execution records one Goal Check row of evidence per criterion
- {{classificationInstructions}}
- preserve `{{taskPath}}`: update content as needed but do not delete, rename, or move the file
- do not edit the backlog `assignee` field; the workflow records ownership itself
- predict the size of the change as a net engineering lines (NEL) bucket — Small (0–80), Medium (81–235) or Large (235+) — and record it with `px nel set --predicted <bucket>`
- Record each verification gate with `px gate add --command <command>`, one call per gate, giving the exact runnable repository command and nothing else (for example, `./scripts/verify-local.sh all`). Handoff executes the recorded gates.
- Never append outcome or explanatory prose to a gate command, including phrases such as "passes on the final tree". Put outcome expectations in a success criterion (`px criterion add`) instead. A gate carrying trailing prose is rejected.

Bug-labeled missions (regression-test-first / "lock the bug"):
- this section applies only when the backlog task at `{{taskPath}}` carries a `bug` label (in addition to its `ai_sdlc` or `user_value` classification). If there is no `bug` label, ignore this section entirely.
- make the **first planned checkpoint** (`px checkpoint plan --name CP-1`) the authoring of a failing reproduction test that locks the bug before any fix is written. Describe in that checkpoint: the test file location (under `test/`), the reproduction scenario, and the assertion that fails at the mission's parent commit (red) and will pass once the fix lands (green).
- record the reproduction test's path with `px repro set --test <path>` (for example, `px repro set --test test/task-1354-repro.test.ts`). `px status {{slug}}` reports it back for the reviewer to check against the diff.
- do not author the fix during draft — the reproduction test and its recorded path are the only bug-specific drafting outputs.

Graphify-first: before drafting, check if `graphify-out/graph.json` exists. If it does, run `graphify query "{{slug}} mission scope and dependencies"` to understand the codebase context before filling in the mission contract. After drafting, run `graphify update .` if you modified any code files.

Finishing:
- verify the draft with `{{verifyCmd}}` before stopping
- the harness will transition the task to `ready` after a clean draft; do not transition it yourself
