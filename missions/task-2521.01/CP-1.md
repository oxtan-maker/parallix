# CP-1: ADR re-read and audit of targeted workflow-metadata paths

## Summary

Re-read the landed versions of ADR 0032, 0036, 0037, 0047, 0048, 0051, 0053 and
`docs/adr/0053-persistence-inventory.md` from `docs/adr/` and treated them, not the Mission
paraphrase, as the architecture authority. Then audited every production reader and writer of the
targeted workflow paths (`missions/**`, `MISSION.md`, `CP-*.md`, review-state/review-event files,
`backlog.md`, `backlog/tasks|completed|archive/**`, `stats.csv`, task-file fallback summaries) under
`src/`.

### Landed contract as read

- ADR 0053 makes `<PARALLIX_HOME>/parallix.db` the sole write authority for Parallix-owned
  operational state after each domain's cutover, with no steady-state dual-write or fallback writer.
  Review, measurement, `AgentBlock` and Mission cutovers are recorded as done.
- ADR 0053 transaction rule 4 explicitly preserves writing external task status as *closeout
  representation*, and keeps generated Markdown/JSON/CSV/provider views as rebuildable projections.
- ADR 0037 keeps Backlog material as an external task source and Git as repository-topology
  authority, and states that a checkpoint document is durable evidence for a completed coordination
  step, not an independent workflow state machine.
- ADR 0051 confirms `backlog.md` is an optional legacy aggregate, not the canonical task catalog;
  the catalog is the individual Markdown files under `backlog/tasks|completed|archive/`.

No material contradiction was found between these landed ADRs and this wave's assumptions: the
task-file and mission-document call sites found in the audit are intake reads, closeout
representation writes, generated exports, or evidence documents — all of which the landed ADRs
permit. **No human-stop is recorded.**

### Audit result — writers that reference a retired workflow path

Scanned `src/**/*.ts` for files containing both a durable write token
(`writeFileSync`/`writeFileAtomic`/`mkdirSync`/`renameSync`/`rmSync`/`cpSync`/`appendFileSync`/
`createWriteStream`/`unlinkSync`/`copyFileSync`/`writeJson`/port `writeText(`) and a retired
workflow-path reference or resolver on non-comment code. Eleven files qualify:

| File | Symbol / path reference | Classification |
|---|---|---|
| `src/adapters/backlog/task-transitions.ts` | `missionPathForSlug(...)/review-events` prefix used when moving task files | external task provider (Backlog catalog) |
| `src/adapters/cli/commands/draft-setup.ts` | `path.join(missionDir, 'MISSION.md')` scaffolding | mission contract document (user-facing artifact) |
| `src/adapters/cli/commands/integrate-conflict.ts` | `backlog/(tasks\|completed)` conflict/rewrite paths | external task provider |
| `src/adapters/review/review-events.ts` | `path.join(missionDir, 'review-events')` | explicit one-way export (generated artifact) |
| `src/adapters/review/setup-review-config.ts` | `backlog/` layout description string in workflow config | product/configuration file |
| `src/adapters/verification/redgreen.ts` | `path.join(missionDir, 'MISSION.md')` reproduction-test marker read | mission document evidence read |
| `src/application/handoff-command-use-case.ts` | `CP-1.md` auto-checkpoint + task-file fallback summary through `fileSystem.writeText` | mission document evidence + closeout representation |
| `src/adapters/backlog/task-file-io.ts` | `pruneStaleBacklogDuplicates` removes a duplicate Backlog task file | external task provider (Backlog catalog) |
| `src/adapters/backlog/task-metadata.ts` | `setTaskLabels` / assignment mutators write the resolved task file | external task provider (Backlog catalog) |
| `src/adapters/cli/commands/handoff.ts` | `createHandoffPorts` binds the handoff document writer | closeout representation adapter |
| `src/adapters/verification/verification.ts` | `recordGateResult` writes `.workflow/gate-result.json` | operator-local observation; ignored Git artifact, not Mission persistence |

`src/adapters/review/review-prompts.ts:readGateResultRecord` reads the gate-result artifact back
only to render verification controls; it is registered as a generated artifact in
`ADR0053_PERSISTENCE_INVENTORY`. No writer was found that persists Mission lifecycle state to a retired path, so no
`forbidden-persistence` or obsolete-path entry results from this audit.

### Audit result — application/interface mission-document and task-file call sites

Fourteen files under `src/application/` and `src/interfaces/` reference mission documents, Backlog
task files, or their resolution helpers: `consumer-domain-requirements.ts`,
`execute-mission-service.ts`, `handoff-command-use-case.ts`, `integrate/context.ts`,
`integrate/preflight-checkout.ts`, `integrate/preflight.ts`, `integrate/recovery.ts`,
`integrate/squash.ts`, `mission-checkpoint-service.ts`, `ports/execute-mission.ts`,
`ports/handoff-workflow.ts`, `ports/integrate-workflow.ts`, `ports/rebase-workflow.ts`,
`rebase-workflow.ts`. Each is one of: port declaration, external task intake/closeout, mission
document evidence, Git topology observation, or naming/anchor metadata. `src/interfaces/` has zero
such call sites.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Landed ADRs re-read as authority (not paraphrased) | `ADR 0053`, `ADR 0051`, `ADR 0037`, `ADR 0047`, `ADR 0048`, `ADR 0032`, `ADR 0036`, `docs/adr/0053-persistence-inventory.md` | PASS |
| SC1 — every production writer of the targeted paths accounted for with file:symbol evidence | Eleven writer files listed above, each with its symbol/path reference; generated gate-result read/write is registered in `ADR0053_PERSISTENCE_INVENTORY`; coverage is enforced by `test/persistence-inventory-guardrail.test.ts` and `"SC1 reverse: all durable-IO files under src/ are present in the inventory"` | PASS |
| Application/interface mission-document call sites enumerated for guard 2 | Fourteen files listed above under `src/application/`; `src/interfaces/` has none | PASS |
| SC6 — no ADR contradiction requiring a human-stop | `ADR 0053` transaction rule 4 (task status as closeout representation) and `ADR 0037` (Backlog external source, checkpoint documents as evidence) permit every call site found | PASS (no human-stop) |
| SC4/SC5 — no documentation inventory and no source change in this checkpoint | Only `missions/task-2521.01/CP-1.md` added; `docs/` and `src/` untouched in this checkpoint's commit | PASS |

Next action: CP-2 — add the audited writer set and application/interface call-site set to
`test/fixtures/durable-state-inventory.ts` as `RETIRED_WORKFLOW_PATH_WRITERS` and
`MISSION_DOCUMENT_CALL_SITES`, each entry carrying its classification, so guards 1 and 2 consult the
inventory instead of a hand-maintained pattern list.
