# Mission: Make the complete agent read/write workflow first-class through `px`, prompts and help (task-2521.03)

## Goal

Replace both sides of the repository-file agent protocol with one
UI-neutral Mission operation surface. Agents, the CLI, TUI, and web transport
must obtain current Mission state through application queries and submit every
legitimate Mission mutation through validated domain operations. `px` is one
adapter for that surface, not its owner. Repository workflow files, direct SQL,
generic database CRUD, and generated request files are not agent APIs.

## Scope

- Audit each legitimate legacy agent mutation and map it to an existing command,
  a command delivered by this wave, an externally-authoritative provider
  operation, or an explicit architectural non-support decision. Keep this as
  checkpoint evidence/test data, not a new inventory document.
- Make `px --help` discoverable read and write paths for Mission context,
  checkpoint evidence, review conversation, lifecycle changes, assignment, and
  dependencies. Support JSON input/output and stdin transport where appropriate.
- Preserve domain validation, lifecycle invariants, and optimistic concurrency
  on every Mission mutation. Omitted update fields preserve existing values;
  supported clears/removals are explicit operations.
- Provide checkpoint record/replace and review decision/resolution operations
  rather than a generic patch endpoint.
- Map legacy task mutations to Mission intake and lifecycle commands. The
  Mission aggregate is the only task record (TASK-2521.04 re-scope); no
  task-source port is defined.
- Migrate the runtime implementer, reviewer, and planning prompts only together
  with the consumers that currently parse workflow files.
- Make the complete typed operation set available through the application
  boundary that the TUI dispatches. CLI, TUI, and web requests must share
  validation, lifecycle rules, concurrency protection, and result types.
- Replace the review-artifact protocol as one cut: review verdicts/findings,
  implementer resolutions, pushbacks, parked/blocked outcomes, and round
  progression must be direct Review aggregate operations before their file
  writers, readers, and prompt instructions are removed.

## Out of scope

- Direct SQLite access, arbitrary table CRUD, opaque Markdown/blob mutation,
  a second Mission model, new lifecycle states, or silently generated evidence.
- Removing a workflow file before its operation-complete replacement is
  available through the shared application boundary.
- A task-source port, provider, table or CLI.
- Mission-to-Mission dependency references; TASK-2521.04 gives them a home.

## Success criteria

1. From a slug and `px --help`, an agent discovers full Mission-context reads.
2. From help, an agent discovers validated execution-context updates.
3. The mutation-parity audit maps every discovered legacy mutation or records a
   concrete architectural reason for non-support.
4. Mutable execution fields with consumers are updated through application
   commands, with no silent clearing of omitted values.
5. Assignment and dependency changes, including valid clears/removals, work.
6. Checkpoint and Goal Check evidence can be recorded and read without `CP-*.md`.
7. Same-checkpoint correction follows domain replacement semantics.
8. Review decisions/findings and implementer resolutions are writable and
   subsequently readable without review-event files.
9. ~~The local task-provider command contract is defined for Mission 4.~~
   (superseded 2026-09-22: TASK-2521.04 was re-scoped so the Mission aggregate is the only task record, with no task-source port, provider, table or CLI.)
10. Every write preserves lifecycle validation and stale-write protection.
11. Agent-facing structured inputs/results exist where formatted CLI parsing
    would otherwise be required.
12. Runtime prompts use the delivered read/write commands and do not instruct
    agents to edit retired workflow files.
13. No SQL, generic CRUD, Markdown authority, or repository request protocol is
    introduced.
14. Negative tests prove malformed, invalid-lifecycle, and stale writes fail
    closed without partial mutation.
15. A synthetic interaction proves read → update → reread → checkpoint → reread
    → review write → reread without a durable workflow file.
16. The TUI can dispatch every supported Mission and Review mutation through
    the same application operation used by `px`; no interface reaches a
    review-artifact, SQL, or filesystem mutation path directly.
17. No normal runtime path reads or writes review artifact files after the
    review operations are delivered. Historical files may only be handled by a
    named import/export migration operation, never as fallback runtime input.

## Checkpoints

- CP-1 — re-draft the Mission, capture the mutation-parity mapping, and land
  the minimum typed Mission write surface with concurrency protection.
- CP-2 — prove the complete synthetic interaction and negative cases; record
  the task-mutation mapping as test/checkpoint evidence.
- CP-3 — migrate prompt and workflow consumers together, then remove the
  remaining file-based instructions only when the new operations cover them.
- CP-4 — complete the shared Review operation set and route the TUI through it;
  remove the review-artifact runtime protocol in the same cut.

## Continuation handoff — 2026-09-19

The earlier CP-4 closeout claim is superseded. It established useful typed
execution-context commands, but it did not complete the wave described here.

- `px verdict` and `px resolve` feed typed in-memory output to the established
  reviewer and implementer consumers. Those consumers remain the durable
  SQLite-event and Review-domain authority: they validate input, persist the
  conversation, apply the review decision/resolution, preserve lifecycle and
  provider ordering, and retain the supplied resulting revision. No file is
  read, written, or deleted on either typed CLI path. The normal loop still
  consumes file transport and must be migrated before this wave is complete.
- The runtime reviewer and implementer prompts, review loop, and artifact
  consumers still use `*-review-findings.md`, `*-review-outcome.md`,
  `*-review-verdict.txt`, `*-round-resolution.md`, and
  `*-review-disposition.txt`. Do not add a database-or-file fallback: that
  creates two runtime mutation protocols.
- The required replacement is operation-complete before the cut: reviewer
  verdict with typed findings; implementer resolution with typed disposition;
  explicit pushback, parked, and blocked outcomes where the existing protocol
  supports them; lifecycle/round validation; and stale-write rejection with no
  partial mutation.
- Put these operations in the application layer and bind them at composition.
  CLI parsing, Ink/TUI input, and web transport are inbound adapters only.
  The TUI must dispatch the same operation request/result types; it must not
  invoke `px`, parse artifacts, or write SQL/files directly.
- Once the replacement is wired into all runtime consumers, remove the
  artifact writers/readers and their runtime prompt instructions in that same
  change. Any retained historical-file reader must be an explicit one-shot
  import/export operation, not a normal workflow fallback.
- Treat the existing review flow as behavioral authority while extracting it.
  Its proven invariants include provider-post-before-approval ordering,
  idempotent replay, review-to-active and review-to-integration lifecycle
  transitions, round recovery/rebounds, and the distinct
  `CHANGES_MADE`/`PUSHBACK_ALL`/`PARKED`/`BLOCKED` outcomes. Preserve and run
  its characterization tests; do not replace this behavior from a simplified
  model or inferred interpretation.
- `review-round.ts` is already the proven Review-domain/SQLite mutation path.
  Do not introduce a second Review service or aggregate façade around it.
  Extend and route through those recorders (and the existing
  `ReviewCommandUseCase`) so a TUI request reaches the same path, with tests
  characterizing each change first.
- The board's `review:submit` operation now delegates to the existing
  `ReviewCommandUseCase` as `--continue`; it does not invoke `px`, inspect an
  artifact, or synthesize state. The remaining unavailable review actions are
  the typed finding-resolution and approval inputs, not a reason to recreate
  the existing review loop.
- `px verdict` and `px resolve` now feed typed reviewer and implementer output
  directly into their existing consumers. Their existing validation, SQLite
  event persistence, domain decision/resolution, provider mirroring, and
  cleanup sequence remain the authority; the consumers simply accept an
  in-memory transport as well as the temporary-file transport. `px resolve`
  preserves the supplied revision and emits only valid persisted dispositions:
  `PUSHBACK_ALL` when every response is a pushback, otherwise `CHANGES_MADE`.
  Prompt and loop migration remain to be completed before removing the file
  consumer.
- An older board/handoff resume path fabricated a complete implementer
  resolution (every finding marked fixed with synthetic evidence) from a
  repeated handoff. That is not aligned with the mission: a repeated handoff
  must never assert resolution on the implementer's behalf. It now fails until
  a real typed resolution exists; replace it only with the shared operation,
  never with a convenience resume write.
- `backlog/tasks/task-2539 - Make-the-Parallix-stack-reclaim-its-own-temporary-directories.md`
  is a standalone task definition, not implementation from another mission.
  It may stay on this branch; do not fold its implementation into this work.

## Constraints and stop rules

## Fresh-session handoff — 2026-09-19

This mission is **not complete**. Do not trust CP-4's old closeout claim or
the earlier continuation bullets where they say the loop still consumes files:
both predate later, partially reviewed work.

Current branch/PR: `mission/task-2521.03`, Forgejo PR #466, latest commit
`ba4cc7670` at the time of this handoff. It was rebased on local `main` and
pushed to `review`. `TASK-2512` and `TASK-2532` were removed as unrelated;
`TASK-2539` is an unclaimed standalone task definition and may remain.

What is actually landed and focused-tested:

- `px verdict` sends typed reviewer data to the established SQLite/domain
  consumer; `px resolve` sends typed implementer data there, derives the head
  revision unless `--revision` is explicitly supplied, and supports
  fixed/pushback/parked/blocked output.
- Production `reviewLoopBindings` reads persisted Review events/state instead
  of artifact files. Existing loop/rebound logic is intentionally preserved.
- Reviewer/implementer prompts now direct agents to `px verdict`/`px resolve`.
- `review:submit` in the board delegates to the existing
  `ReviewCommandUseCase`; no synthetic handoff resolution remains.
- `./scripts/verify-local.sh static-analysis` passed before the final
  prompt-only cleanup commits; focused review-verb and review-binding tests
  passed after the resolve change.

Known defects and required next work:

1. The PR still contains broad earlier work and stale checkpoint claims. Do an
   adversarial diff review against local `main`; retain only behavior needed by
   this Mission. Do not call the Mission complete on the current evidence.
2. `--consume-artifacts` is rejected in `ReviewCommandUseCase`, but its old
   adapter/port/tests remain. Delete or move that implementation behind a
   named one-shot import/export migration, then remove stale command metadata.
3. TUI/web only dispatch `review:submit`; typed resolution and approval inputs
   are still unavailable. Reuse existing domain recorders/command use cases;
   do not add a Review façade.
4. Draft/execute prompts were partially de-slopped after PR review. Re-read
   them together with their prompt tests: no `MISSION.md` scaffold, CP file,
   hardcoded finding ID, or speculative admin-command instructions may remain.
5. Handoff still contains CP-document compatibility paths. Migrate only after
   proving the persisted checkpoint read/write path has equivalent validation;
   persistence must not be removed.

PR review feedback already acted on: unrelated TASK-2512/TASK-2532 removed;
`px resolve` no longer requires a revision; prompt examples no longer hardcode
`F1`; draft/execute prompt wording no longer requires a mission scaffold.
Re-check each change in the diff—these repairs were made under a degraded
session and need independent review.

- Do not hide an unmapped mutation behind a generic patch command. If it needs
  a new architectural concept, stop for architectural review.
- Do not claim prompt/file migration while `active`, `handoff`, or review still
  consumes those artifacts.
- Do not retain a dual runtime protocol for convenience. A temporary file may
  exist only when a concrete runner cannot transport structured input; it must
  be single-use transport, not an authority, reader fallback, or second write
  path.
- Do not bypass version checks to make an agent retry easier; an agent must
  re-query and retry deliberately after a conflict.
- Do not alter the unrelated unresolved TASK-2521.04 merge while executing this
  Mission.

## Gate

- [x] `./scripts/verify-local.sh static-analysis` (2026-09-19)
