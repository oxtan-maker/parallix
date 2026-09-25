# Execute core
Mode: execute after lock.
Slug: {{slug}}
Mission dir: {{missionDir}}
Backlog task: {{taskPath}}

Mission context is application-owned. Load it with:

- `px status {{slug}}` — lane, the recorded brief (goal, why, scope, out-of-scope), the success criteria, the checkpoint plan with which checkpoints already have recorded evidence, declared gates, the latest recorded checkpoint with its Goal Check rows and next action, review round and disposition, and the write version.

`px status` is the authority for Mission state, and it is the only one. Run `px --help` to see the supported commands.

Execution has exactly one write:

- `px checkpoint record --name <CP-N> --criterion <text> --evidence <text> --next <text>` — `--criterion` and `--evidence` repeat and pair up in order.

You do not change the mission here. The goal, scope, out-of-scope, success criteria, checkpoint plan and gates were settled at draft and are what your work is judged against; if you believe one of them is wrong, say so in your response and stop rather than editing it to match what you built.

The slug is inferred from this worktree, so you do not pass it. The write takes `--expected-version <n>`, whose value is the `version` field reported by `px status {{slug}}`. A write against a stale version is rejected with an explicit conflict and changes nothing; re-read the status and retry deliberately. Run the command with `--help` for its exact flags.

Harness preflight already confirmed:
- branch/worktree shape
- the mission brief is recorded and readable

Execution requirements:
- execute checkpoint-by-checkpoint per the checkpoint plan reported by `px status {{slug}}`, starting with the first planned checkpoint that has no recorded evidence. That is also where you resume after a relaunch.
- after each completed checkpoint, record its evidence with `px checkpoint record --name <its planned CP-N>`, one `--criterion`/`--evidence` pair per Goal Check row, and a non-generic `--next`. Use the exact text of the success criterion a row evidences as its `--criterion`; handoff matches the final checkpoint's rows against the recorded success criteria and refuses a criterion with no row. That is the durable write; read it back with `px status {{slug}}`. Do not write a checkpoint document.
- Immediately after recording a checkpoint's evidence, compact your working context: reload only the mission goal, scope, success criteria and checkpoint plan with `px status {{slug}}`, then continue.
- Completing a checkpoint is **non-terminal**: after recording its evidence, immediately continue to the next planned checkpoint without recorded evidence. Do not send a final response or exit merely because one checkpoint is complete; break large checkpoints into safe slices and keep progressing.
- You may terminate this execution only when exactly one of these conditions applies: (a) every planned checkpoint has recorded evidence, the final one covers every success criterion, and every mission-declared gate passes, (b) a mission stop rule applies, or (c) a genuine external dependency blocks progress. Checkpoint size, uncertainty, or needing further investigation are not terminal conditions.
- Keep Goal Check evidence durable: prefer stable file references and commands that can be rerun against the committed tree. Do not claim that `git diff HEAD` proves a committed change—its expected output is empty after committing. If historical diff evidence is needed, state the exact non-HEAD baseline or describe the observed change without implying that an empty post-commit diff will reproduce it.
- the final checkpoint MUST record one Goal Check row per success criterion, citing real, durable references such as runnable project commands, test names, decision-record references, or test paths
- **One row per criterion:** each `--criterion` is paired with the `--evidence` that follows it, in order. Pass the flags as many times as you have criteria; the counts must match or the write is rejected.
- **Accepted evidence forms** (each `--evidence` value must cite at least one verifiable reference from this list):
  1. **Runnable project commands or stable paths** — e.g., `` `make test` ``, `` `go test ./...` ``, or `` `tests/integration/` ``
  2. **Test names** — e.g., `"saving a record preserves its identifier"` (must match a test name found in the project)
  3. **Decision-record references** — e.g., `ADR 0048` (when the project uses ADRs or an equivalent decision record)
  4. **Test paths** — e.g., `tests/integration/` (must be an existing test path)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- **Not sufficient by themselves:** raw `stat`/`ls` output or generic prose claims. You may include them as supporting context, but the same `--evidence` value must also cite at least one accepted reference from the list above.
- run targeted checks needed to develop and validate the change; handoff owns the authoritative execution of mission-declared Gates, so do not rerun a complete declared gate solely as lifecycle ritual (run one when diagnosing a concrete issue)
- Immediately after **each successful mission-declared Gate**, compact your working context before starting the next gate, checkpoint work, or handoff work. Reload only the locked mission goal and scope plus committed checkpoint or successful-gate evidence that is present, re-reading them with `px status {{slug}}` rather than from repository files. Do not compact for a failed gate: retain its failure diagnostic while repairing it.
- preserve `{{taskPath}}`: update mission-relevant content as needed but do not delete, rename, or move the file
- do not change the Backlog task's status, assignee, labels, or lifecycle metadata, and do not run `px active`, `px review`, `px integrate`, `px assign` or `px unassign`; Parallix performs lifecycle transitions and review decisions itself. `px status {{slug}}` is the supported read in this phase, and `px checkpoint record` is the only supported write.
- do not hand off to review with uncommitted implementation work, or before the final checkpoint's evidence is recorded

Graphify-first: before executing, check if `graphify-out/graph.json` exists. If it does, use `graphify query "<question>"` for codebase questions, `graphify path "<A>" "<B>"` for relationships, and `graphify explain "<concept>"` for focused concepts. Read `graphify-out/GRAPH_REPORT.md` only for broad architecture review. Run `graphify update .` after modifying code. If `graphify-out/wiki/index.md` exists, use it for broad navigation.

{{checkpoint_context}}
