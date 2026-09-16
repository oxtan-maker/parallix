# Database Migration Proposal for Repository Noise

Investigation output for task-2511. Nothing here is implemented by this mission.

## Decision

Move the Parallix-owned operational facts that currently exist as repository or
worktree files into `<PARALLIX_HOME>/parallix.db`, and stop materializing their
Markdown/JSON projections during normal lifecycle execution. This is what
ADR 0053 already decides ("Normal lifecycle execution must not create
Git-tracked workflow metadata simply because a mission occurred"); the
repository still carries 2,940 mission files because the cutover stopped at
authority and never removed the writers.

Four things move: the **verification proof** (the trust marker), the **bounded
mission-contract fields**, **checkpoint evidence**, and the **review-event
export**. Three things stay outside: external provider content (Backlog.md,
Forgejo, Git, OS), operator configuration and credentials, and unbounded
artifacts (logs, patches, transcripts, captures) which are referenced by
bounded locator only.

The blocking prerequisite is the **handoff file-presence trust marker**: while
`gatekeeper.ts` and `handoff-command-use-case.ts` prove work happened by the
existence of `MISSION.md` and `CP-*.md` — auto-generating and committing a
`CP-1.md` when none exists — no writer can be removed without breaking
handoff. Re-anchoring that check on database checkpoint evidence is the first
implementation mission, not a later cleanup.

## Trust marker resolution

| Marker | Today | Target authority | Rationale |
|---|---|---|---|
| Reusable verification proof, `<PARALLIX_HOME>/verification-proofs/<identity>.json` | mode-0600 JSON file; `readReusableVerificationProof` accepts it only when identity digest, command, tracked-index fingerprint, toolchain, commit, and tree all match; `syncPrimaryBaseline` (`src/adapters/forgejo/forgejo-git.ts`) refuses to push without it | SQLite `verification_proofs`, keyed by the same identity digest | Bounded (one row of digests and timestamps), Parallix-owned, already outside the repository, and read transactionally by integration. One file per verified tree/toolchain combination grows without bound and has no retention owner; a row does. Digest inputs and fail-closed behavior must not change — only the store. |
| Handoff file-presence marker (`MISSION.md` + at least one `CP-*.md`) | `gatekeeper.ts`, `handoff-command-use-case.ts` | Database checkpoint evidence (`CheckpointData`, `GoalCheckRow`) read through `MissionCheckpointService` | ADR 0048 requires harness-verified evidence, not agent prose. A database row is stronger evidence than a file an agent wrote, and removes the auto-generated `CP-1.md` commit entirely. |
| Legacy session marker, `.workflow/sessions/<slug>-<role>.json` | read only by `importSessionMarkers`; no production writer | already `session_markers` | Import-only path; the file is a one-way legacy input. |
| Agent trust configuration (`codex projects.<path>.trust_level`, `vibe --trust`, `pi defaultProjectTrust`) | written into `.workflow/*-home` and operator home | stays with the provider | Provider policy and credentials; ADR 0053 excludes both. Out of scope for this mission by its own Out of Scope section. |

## Per-artifact treatment

| Artifact | Target owner | Migration order | Compatibility / deletion boundary | Backup, recovery, export consequence |
|---|---|---|---|---|
| Verification proof files | `verification_proofs` rows in `parallix.db` | Wave 1 (independent of mission files) | Read-through fallback to the file store for one release; delete the file reader and writer once integration runs prove the row path fails closed with no proof | Proof state joins the single database backup. A lost database re-runs the gate — proofs are safely regenerable, so no export is required. |
| Handoff/gatekeeper evidence check | `MissionCheckpointService` reads | Wave 1, before any file writer is removed | File-presence check is removed, not softened: missing database evidence must fail handoff | No backup consequence; evidence already lives in the database. |
| `missions/<slug>/CP-*.md` | `CheckpointData` / `GoalCheckRow` (already the ADR 0053 authority) | Wave 2, after Wave 1 | Agents record checkpoints through the application boundary; `checkpoint-document.ts` survives only as explicit import (legacy) and export (on request). Stop committing once Wave 1 lands | Database backup restores evidence. Existing committed files stay in Git history; removing them from the working tree needs no history rewrite. |
| `missions/<slug>/MISSION.md` bounded fields (goal, why, scope, gates, `Base-Branch:`, `Reproduction-Test:`, refinement signals) | Mission execution context in `parallix.db`, rendered on demand | Wave 2, with every reader redirected in the same wave: `startup-preflight.ts`, `gatekeeper.ts`, `worktree.ts`, `redgreen.ts`, `handoff-command-use-case.ts`, `stats-backfill.ts` | An authored `MISSION.md` remains valid **intake** for `px draft`; it is imported and validated, not read at runtime afterwards. Delete the runtime readers only when all six are redirected | Contract is restorable from the database as rendered Markdown. A plain clone no longer contains it — accepted in ADR 0053's Negative consequences. |
| `missions/<slug>/review-events/*.md` | Review event rows (already authoritative); file becomes on-demand export | Wave 3 | Delete the `git add` + `git commit` in `exportEventFile`; keep rendering behind an explicit export flag. No production reader exists today, so removal has no consumer to migrate | Audit history is regenerated from rows; Git history retains the 425 already-committed exports. |
| `missions/<slug>/review-state.json` | `Review` (backfill only) | Wave 3, alongside the review-event change | Delete file and its `--backfill-review` reader together once a recorded backfill report shows no remaining pre-cutover mission | Legacy files retained until their mission is backfilled; afterwards the database is the only needed copy. |
| `missions/<slug>/nel-record.json`, cohort/scratch JSON and Markdown | Measurement rows / checkpoint evidence | Wave 3 | Stop creating new ones; no migration of historical scratch | Excluded from backup; regenerate measurements by query. |
| `.workflow/gate-result.json` | No durable owner (local observation) | Not migrated | Stays Git-ignored and local | Excluded from backup; re-run the gate. |
| Backlog task files, Git/worktree facts, Forgejo facts, configuration, credentials, provider homes, logs, patches, captures | External system, repository, or tool | Never migrated | No database compatibility path | Backed up by their owning system; Parallix stores validated references only. |

## Migration order and validation gates

1. **Wave 1 — trust markers.** Add the `verification_proofs` table and redirect
   `readReusableVerificationProof` / `writeReusableVerificationProof`; re-anchor
   `gatekeeper.ts` and `handoff-command-use-case.ts` on database checkpoint
   evidence. Gate: integration tests prove a missing/mismatched proof still
   blocks `syncPrimaryBaseline`, and handoff still fails closed when the mission
   has no recorded checkpoint.
2. **Wave 2 — mission contract and checkpoints.** Redirect all six `MISSION.md`
   readers and the checkpoint writers; keep `px draft` intake import. Gate: a
   mission completes `intake -> refinement -> execution -> checkpoint -> handoff`
   with no `missions/<slug>` directory created (ADR 0053's stated acceptance
   condition).
3. **Wave 3 — export and legacy cleanup.** Remove the review-event auto-commit,
   the `review-state.json` reader, and the mission scratch writers. Gate: review
   history renders identically from rows via the export command.
4. **Wave 4 — working-tree removal and operations.** Remove historical mission
   files from the working tree (Git history retains them), and verify backup,
   restore, interrupted-migration, and export regeneration on the larger
   database. Gate: restore-from-backup test plus an export that reproduces a
   sampled historical mission's checkpoint and review content.

Each wave backs up `<PARALLIX_HOME>/parallix.db` and validates migration
checksums before running. There is no steady-state dual write at any point:
legacy files are read by explicit, idempotent importers that report conflicts
rather than overwriting database state.

## Retention and recovery policy

- The database is the only thing that must be backed up for operational state;
  it stays outside every target repository and worktree.
- Regenerable markers (verification proofs, gate results) need no export: losing
  them costs a gate re-run, not evidence.
- Evidence (checkpoints, review events, mission contracts) is exportable on
  demand as Markdown. Export is an operator action, not a lifecycle side effect.
- Historical committed mission files are removed from the working tree, not from
  Git history, so auditability of past missions survives a compact tree.
- Unbounded artifacts stay in the filesystem or their owning tool; the database
  holds a bounded locator or digest only.

## Follow-up implementation missions

| ID | Outcome | Depends on |
|---|---|---|
| PERSIST-1 trust-marker migration | `verification_proofs` table plus adapter; verification proof reads/writes go through it; identity digest and fail-closed push behavior unchanged; file store removed after a read-through release | This proposal |
| PERSIST-2 handoff evidence re-anchor | `gatekeeper.ts` and `handoff-command-use-case.ts` prove work from database checkpoint evidence; the auto-generated, auto-committed `CP-1.md` path is deleted | PERSIST-1 (ordering only) |
| PERSIST-3 mission-contract cutover | Bounded contract fields persisted as Mission execution context and rendered on demand; all six `MISSION.md` runtime readers redirected; `px draft` keeps authored intake as an import | PERSIST-2 |
| PERSIST-4 checkpoint write cutover | Checkpoint recording goes through `MissionCheckpointService`; `CP-*.md` becomes import/export only | PERSIST-2 |
| PERSIST-5 review export cutover | `exportEventFile` stops committing; export moves behind an explicit command; `review-state.json` and its backfill reader are removed after a recorded backfill report | PERSIST-4 |
| PERSIST-6 footprint removal and operations | Historical mission files removed from the working tree; backup, restore, interrupted-migration, and export-regeneration verification on the resulting database | PERSIST-3, PERSIST-5 |

Each follow-up is independently executable from this document plus the
inventory; none depends on unrecorded investigation knowledge.

## Deferred decisions

- Whether `verification_proofs` and `gate-result` observations share one row.
- Retention period for verification-proof rows (they are regenerable, so a
  time- or count-bounded prune is sufficient; no policy is chosen here).
- Whether `px draft` eventually writes the database directly instead of
  accepting an authored contract file as intake.
- Whether `backlog/completed/**` retention is addressed at all while Backlog.md
  remains the external task provider — it is provider-owned today.

None of these block PERSIST-1 through PERSIST-5.
