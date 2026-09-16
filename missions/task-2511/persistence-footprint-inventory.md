# Persistence Footprint Inventory

Investigation record for task-2511. "Database" means the operator-local
`<PARALLIX_HOME>/parallix.db` selected by ADR 0053. Paths are patterns: one
mission can hold many checkpoints and review events.

This revision supersedes the 2026-09-14 revision, which predates the ADR 0053
rewrite (commit `91aae5c49`). That earlier revision recommended retaining
committed `MISSION.md`, `CP-*.md`, and review-event Markdown as steady-state
audit exports. ADR 0053 now states the opposite: "Normal lifecycle execution
must not create Git-tracked workflow metadata simply because a mission
occurred", and "Rebuildable does not mean routinely materialized."

## Measured footprint

Reproduce on the committed tree:

```sh
git ls-files -z -- 'missions/**'            | xargs -0 cat | wc -c   # mission tree bytes
git ls-files -z -- 'missions/*/CP-*'        | xargs -0 cat | wc -c
git ls-files -z -- 'missions/*/MISSION.md'  | xargs -0 cat | wc -c
git ls-files -z -- 'missions/*/review-events/*' | xargs -0 cat | wc -c
git ls-files -z -- 'missions/*/review-state.json' | xargs -0 cat | wc -c
git ls-files | wc -l ; git ls-files -- 'missions/**' | wc -l
```

Observed at the mission branch point: 2,940 of 4,530 tracked files (65%) and
10.9 MB of 27.7 MB tracked bytes (39%) are under `missions/`, against 2.9 MB of
`src/**` and 5.9 MB of `test/**`. Within `missions/`: 1,704 checkpoint files
(5.4 MB), 443 `MISSION.md` (4.3 MB), 425 review-event exports (0.86 MB), 213
`review-state.json` (0.13 MB), 129 `nel-record.json` (0.02 MB). `backlog/**`
adds 522 files (2.0 MB), 445 of them already-completed task files.

## Artifact inventory

| Path pattern | Writer | Reader | Current purpose | ADR 0053 classification | Recommendation |
|---|---|---|---|---|---|
| `<PARALLIX_HOME>/parallix.db` (+ WAL/SHM) | SQLite adapters and migration runner (`src/adapters/sqlite/`) | mission, review, checkpoint, measurement, session-marker, blocklist, board ports | Sole live authority for Parallix-owned operational state | database-owned domain state | Keep; single backup/restore unit for everything moved below. |
| `<PARALLIX_HOME>/verification-proofs/<identity>.json` | `writeReusableVerificationProof` (`src/adapters/verification/verification.ts`) | `readReusableVerificationProof`, `captureVerifiedTreeProof`; `syncPrimaryBaseline` in `src/adapters/forgejo/forgejo-git.ts` rejects a push without a matching proof | **Primary trust marker**: a mode-0600 file whose presence lets a later command trust that this exact (command, tracked-index fingerprint, toolchain, commit, tree) was verified, and skip re-running the gate | database-owned domain state (bounded row; today a generated artifact on disk) | Move to a bounded `verification_proofs` table keyed by the same identity digest; keep the digest inputs and fail-closed semantics unchanged. |
| `.workflow/sessions/<slug>-<role>.json` | pre-cutover agent launchers (no current production writer) | `importSessionMarkers` only (`src/adapters/sqlite/session-marker-import.ts`, which never modifies or deletes the source) | Legacy agent-family/session resume marker | explicit one-way legacy input | Import-only; `session_markers` is already the live owner. Delete the reader after a recorded import window. |
| `missions/<slug>/MISSION.md` | `px draft` scaffolding (`src/adapters/cli/commands/draft-setup.ts`) and the drafting agent | `startup-preflight.ts`, `gatekeeper.ts`, `worktree.ts` (`Base-Branch:`), `redgreen.ts` (`Reproduction-Test:`), `handoff-command-use-case.ts` (`## Gates`), `stats-backfill.ts`, humans | Mission contract, declared gates, base branch, reproduction-test declaration | database-owned domain state for its bounded fields; the authored body is intake source | Move the bounded fields (goal, scope, gates, base branch, reproduction test, refinement signals) to Mission execution context in the database; render on demand for agents; stop committing a per-mission file. |
| `missions/<slug>/CP-*.md` (`CP-N`, `CP-FINAL`, `CHECKPOINT_*`) | executing agent; `handoff-command-use-case.ts` auto-generates and commits `CP-1.md` when none exists | `mission-paths.findCheckpoints`, `gatekeeper.ts`, `checkpoint-document.ts` parser, `redgreen.ts`, `stats-backfill.ts`, humans | Checkpoint narrative and Goal Check evidence; file presence is today's handoff gate | database-owned domain state (`CheckpointData`, `GoalCheckRow`); the file is a compatibility document | Cut over to `MissionCheckpointService.record`; keep files only as explicit import/export. Largest single footprint (5.4 MB). |
| `missions/<slug>/review-events/*.md` | `exportEventFile` in `src/adapters/review/review-events.ts` — renders a stored row, then `git add` + `git commit` | humans only; no production reader (`review-state.ts` scans them solely for legacy round inference) | Human-readable review history | generated artifact (export of database rows) | Stop writing and committing by default; expose `px review <slug> --export` on demand. Note `missions/*/review-events/` is already in `.gitignore`, yet 425 files are tracked from before that rule — the exporter force-commits. |
| `missions/<slug>/review-state.json` | pre-cutover review workflow (no current writer; `src/adapters/review/review-state.ts` states it "is no longer written") | `px review <slug> --backfill-review` only | One-time seed for a pre-cutover Review | explicit one-way legacy input | Backfill, then delete the file and the reader together. |
| `missions/<slug>/nel-record.json`, `cohort-*.json`, `*-inventory.md`, other mission scratch documents | executing agents and one-off mission tooling | mostly nothing after the mission closes | Per-mission measurement and working notes | generated artifact / removable legacy footprint | Do not recreate: measurements belong to `MissionOutcome`/measurement rows; free-form notes belong to checkpoint evidence. |
| `missions/<slug>/.workflow/gate-result.json` | `recordGateResult` (`src/adapters/verification/verification.ts`) | board/gate presentation | Local observation of the last gate run | generated artifact | Keep local and Git-ignored, or fold into the same bounded row as the verification proof; never a committed assertion (ADR 0048). |
| `.workflow/codex-home/**`, `.workflow/qwen-home/**`, `.workflow/vibe-home/**` (`src/adapters/config/state-homes.ts`) | agent runtimes; Parallix writes their config (`codex.ts` sets `projects.<path>.trust_level="trusted"`, `vibe.ts` passes `--trust`) | the agent runtimes | Provider-local caches, logs, and per-runtime **agent trust configuration** | configuration or secret / external fact | Keep outside the database and outside Git. Agent trust is provider policy, not Parallix operational state. |
| `~/.claude/projects/**`, `~/.claude/.credentials.json`, `~/.claude/session-env` (`state-homes.ts`) | Claude runtime | Claude runtime | Provider session and credentials | configuration or secret | Never migrate. |
| `config/agents.local.json`, `agents.local.json` | operator | agent configuration adapters | Local agent configuration and secrets | configuration or secret | Keep file-backed and Git-ignored. |
| `workflow.config.json`, `config/*.json`, `prompts/**`, `templates/**`, checked policy | repository authors | config/prompt adapters | Versioned distributable policy | configuration or secret | Keep committed; Git is the right authority. |
| `backlog/tasks/*.md`, `backlog/completed/*.md`, `backlog/archive/*.md` | Backlog.md tooling and authors | intake, gate, status adapters (`concrete-gate-read-adapter.ts`, `task-transitions.ts`) | External task source material and its lifecycle position | external fact or intake | Keep external while Backlog.md is the selected provider; database stores the `ExternalTaskRef` plus Mission fields. Completed/archive files (445) are the provider's retention choice, not Parallix state. |
| Git commits, branches, worktrees, integration OIDs | Git | git/worktree adapters | Topology and history | external fact or intake | Observe from Git; store only validated references. |
| Forgejo pull requests, comments, availability | Forgejo | Forgejo adapters | Provider review surface | external fact or intake | Keep provider-authoritative. |
| PIDs, process liveness, active CWDs | operating system | `src/adapters/agents/running-sessions.ts` | Whether an agent runs now | external fact or intake | Observe at query time; never persist. |
| `stats.csv` for `px stats import-legacy` | operator/legacy tooling | explicit importer | Historical analysis input | explicit one-way legacy input | Operator-selected import source only. |
| `/tmp` agent artifacts, `.test-runtime/**`, agent scratch exports (`opencode-export.ts`) | verifier, tests, agent processes | the same process or a one-shot importer | Transport and disposable diagnostics | generated artifact / forbidden persistence | Keep ephemeral, outside the repository, deleted after consumption (ADR 0053 "Agent transport"). |
| Patches, logs, transcripts, captures, build output | tools and agents | humans and tools | Diagnosis evidence | external fact or artifact store | Reference by bounded locator/digest only. |

## Trust markers

Four distinct markers influence trust; only the first is Parallix-owned
operational state.

1. **Verification proof** (`<PARALLIX_HOME>/verification-proofs/<identity>.json`).
   Its presence is the trust decision: `readReusableVerificationProof` accepts a
   proof only when version, status, identity digest, command, tracked-index
   fingerprint, toolchain, commit, and tree all match, and `syncPrimaryBaseline`
   refuses to push without one. It is bounded, already outside the repository,
   and is the marker this mission proposes to move into the database.
2. **Handoff file-presence marker.** `gatekeeper.ts` and
   `handoff-command-use-case.ts` treat the *existence* of `MISSION.md` and at
   least one `CP-*.md` as the evidence that work happened — to the point that
   handoff auto-generates and commits a `CP-1.md` when none exists. This is the
   mechanism that forces the repository footprint to exist; it must be
   re-anchored on database checkpoint evidence before the files can stop being
   written.
3. **Legacy session marker** (`.workflow/sessions/<slug>-<role>.json`). Resume
   metadata only; already superseded by the `session_markers` table and read
   only by the importer. It never proves provider availability.
4. **Agent trust configuration** (`codex --config projects.<path>.trust_level`,
   `vibe --trust`, `pi` `defaultProjectTrust`). Provider-local policy written
   into `.workflow/*-home`; out of scope for migration and for change here.

## Unresolved ownership questions

1. Retention for the ~2,900 already-committed mission files: ADR 0053 says
   removing them from the current tree is enough because Git retains history,
   but no mission has decided *when* that removal happens or whether an export
   bundle is produced first.
2. Whether `px draft` keeps accepting an authored `MISSION.md` as intake input
   after the contract's bounded fields live in the database, or whether drafting
   writes the database directly.
3. Whether gate-result observation and verification proof become one row or two.
4. Whether `backlog/completed/**` retention is Parallix's concern at all while
   Backlog.md remains the external provider.

## Evidence consulted

- `docs/adr/0053-operational-persistence-and-authority-boundaries.md`
- `docs/adr/0053-persistence-inventory.md`, `test/fixtures/durable-state-inventory.ts`
- `src/adapters/verification/verification.ts`, `src/adapters/forgejo/forgejo-git.ts`
- `src/adapters/verification/gatekeeper.ts`, `src/application/handoff-command-use-case.ts`
- `src/adapters/review/review-events.ts`, `src/adapters/review/review-state.ts`
- `src/adapters/sqlite/session-marker-import.ts`, `src/adapters/config/state-homes.ts`
- `src/adapters/filesystem/mission-paths.ts`, `src/adapters/git/worktree.ts`
