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

Prefer one foreground px mission author invocation to record the complete contract atomically, then read it back once with px status {{slug}}. Run px mission --help for the typed flags. The slug is inferred from this worktree. Each write resolves its own current version automatically; --expected-version is optional when you want to pin an earlier read. Validation or a version conflict rejects the whole batch without partial writes.

For example, a small greeting fix can use plain criterion text:

```sh
px mission author --goal 'Fix the greeting' --why 'The greeting contains a typo' --scope 'Correct hello.sh greeting text' --out-of-scope 'Other behavior' --criterion 'hello.sh prints Hello, World! and exits successfully' --checkpoint CP-1 --checkpoint-text 'Correct the greeting and verify public execution' --gate './scripts/verify-local.sh all' --predicted Small --classification ai_sdlc
```

Supply every required part: goal and why, scope, at least one success criterion, an ordered checkpoint plan, exact runnable verification gates, a predicted NEL bucket, and classification. Repeat list flags within the same invocation; the lists replace recorded lists. Out-of-scope entries are optional; record them whenever review should check a deliberate boundary. Checkpoint descriptions are at most 512 characters. Gates contain only runnable commands, without prose, comments or expected outcomes. Expected outcomes belong in criteria.

Use plain text in criteria and evidence values, without literal backticks or embedded double quotes. Quote shell arguments with single quotes as in the example. Execution can cite a repository-relative path such as hello.sh or test/unit/example.test.ts as its evidence reference; formatting characters are unnecessary.

The required parts and their existing single-concept commands are listed below. The batch above records the same parts together; reproduction and dependencies use their own commands.

| Part | Command | Required |
|---|---|---|
| Goal and why | `px goal set --goal <text> --why <text>` | required |
| Scope | `px scope set --scope <text>` | required |
| Out of scope | `--out-of-scope <text>` on `px scope set`, repeatable | optional; record it whenever the mission deliberately leaves something alone, because review checks the diff against it |
| Success criteria | `px criterion add --text <criterion>`, one call each | required, at least one |
| Checkpoint plan | `px checkpoint plan --name <CP-N> --text <what it delivers>`, one call each in execution order (`CP-1`, `CP-2`, ...), at most 512 characters each | required, at least one |
| Verification gates | `px gate add --command <command>`, one call each. Handoff runs every gate with `bash -c` and blocks on a non-zero exit, so a gate is one exact runnable repository command and nothing else (for example `./scripts/verify-local.sh all`): no prose, no `#` comment, no expected outcome. `px gate add` refuses such a gate, and handoff also refuses a gate whose script does not exist in the finished tree; an expected outcome belongs in a success criterion | required, at least one |
| Predicted NEL bucket | `px nel set --predicted <Small\|Medium\|Large>` | required |
| Reproduction test | `px repro set --test <path>` | required for a `bug` mission only |
| Dependencies | `px depends add --on <slug>`, one call each | optional; nothing enforces it |

Existing single-concept commands remain available for focused edits. Record a reproduction test with px repro set --test <path> for a bug mission; add optional dependencies with px depends add --on <slug>. Neither changes lifecycle state. Run any command with --help for exact flags.

Wait for each foreground write to finish; never end your turn while a `px` command is still running: when your turn ends, anything still running is killed and was not recorded.

A write against a stale version is rejected with an explicit conflict and changes nothing; re-read the version with `px status {{slug}}` and retry.

Before you finish, read the contract back with `px status {{slug}}` and check every required part above. Anything it does not report was not recorded.

Plan the checkpoints; do not record their evidence. `px checkpoint record` is for execution: evidence is what the work produces, and there is nothing to cite yet.

Drafting requirements:
- every part you record is concrete and specific to this mission; no placeholders or "TBD"
- plan checkpoints as coherent, independently verifiable slices of the work; together they must cover every success criterion
- each success criterion must be specific and checkable: execution records one Goal Check row of evidence per criterion
- {{classificationInstructions}}
- preserve `{{taskPath}}`: update content as needed but do not delete, rename, or move the file
- do not edit the backlog `assignee` field; the workflow records ownership itself
- predict the size of the change as a net engineering lines (NEL) bucket — Small (0–80), Medium (81–235) or Large (235+)
- Plan a brief check where the implementer exercises the changed behavior through the running application’s public interface and records the observed result, using existing tools without adding E2E tests unless explicitly asked for in the intent.

Bug-labeled missions (regression-test-first / "lock the bug"):
- this section applies only when the backlog task at `{{taskPath}}` carries a `bug` label (in addition to its `ai_sdlc` or `user_value` classification). If there is no `bug` label, ignore this section entirely.
- make the **first planned checkpoint** (--checkpoint CP-1 in the batch) the authoring of a failing reproduction test that locks the bug before any fix is written. Describe in that checkpoint: the test file location (under `test/`), the reproduction scenario, and the assertion that fails at the mission's parent commit (red) and will pass once the fix lands (green).
- record the reproduction test's path with `px repro set --test <path>` (for example, `px repro set --test test/task-1354-repro.test.ts`); the table above makes it required for a bug mission. `px status {{slug}}` reports it back for the reviewer to check against the diff.
- do not author the fix during draft — the reproduction test and its recorded path are the only bug-specific drafting outputs.

Graphify-first: before drafting, check if `graphify-out/graph.json` exists. If it does, run `graphify query "{{slug}} mission scope and dependencies"` to understand the codebase context before filling in the mission contract. Parallix updates existing Graphify graphs after successful squash integration on the receiving base worktree; review, edits and checkpoints do not trigger updates.

Finishing:
- verify the draft with `{{verifyCmd}}` before stopping
- the harness will transition the task to `ready` after a clean draft; do not transition it yourself
