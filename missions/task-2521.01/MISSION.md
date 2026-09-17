# Mission: Lock the landed ADR contract and add executable anti-regression guardrails (task-2521.01)

## Goal
Establish exactly what the current architecture says about workflow-metadata persistence and lock that contract with executable tests so no future change can silently reopen the ADR 0053 cutover. Concretely: (1) account for every current production read/write of the targeted paths with file:symbol evidence; (2) add a guard that fails tests when a new normal-runtime call writes to a retired workflow path unless the call site is an explicit importer, export, or test fixture; (3) add a guard that fails when new application/interface code treats `missions/**` or repo Backlog task files as Mission persistence. No behavior or storage model changes beyond the guardrails themselves.

## Why Now
ADR 0053 states that after each domain's cutover the operator SQLite database is the sole write authority for Parallix-owned operational state and that there is "no steady-state dual-write or fallback writer." ADR 0037 retains Backlog Markdown as an external task source and Git as repository-topology authority; ADR 0051 confirms `backlog.md` is an optional legacy aggregate, not the canonical catalog. Those decisions are currently enforced by scattered architecture tests but are not locked behind a single guard that blocks the two most likely regressions: a new normal-runtime write to a retired workflow path, and new code that re-treats `missions/**` or Backlog task files as Mission persistence. Without executable guards, the cutover can silently decay through prose-only authority. This mission captures the landed contract in tests before any further persistence work proceeds.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: ADR 0053 cutover durability; two concrete regression surfaces named in the backlog task; zero behavior change; reuse of existing persistence-guard infrastructure.

## Scope
- Re-read the CURRENT landed versions of ADR 0032, 0036, 0037, 0047, 0048, 0051 and 0053 from `docs/adr/` and treat those files, not this Mission's paraphrase, as architecture authority.
- Audit every production read and write of: `missions/**`, `MISSION.md`, `CP-*.md`, review-state/review-event/NEL workflow files, `backlog.md`, `backlog/tasks/**`, `backlog/completed/**`, `backlog/archive/**`, task-file fallback summaries, and any other machine-generated workflow metadata discovered during the audit.
- Classify each call site as one of: DB-owned state that must become application/DB native; external/task-provider input; explicit legacy importer; explicit user-requested export; ephemeral transport; product/configuration file; obsolete path to remove.
- Register each discovered call site in the existing executable inventory `test/fixtures/durable-state-inventory.ts` (`ADR0053_PERSISTENCE_INVENTORY`) so the audit is checked, not just written down.
- Add guard 1: a test that fails when a new normal-runtime write targets a retired workflow-path pattern unless the call site is registered as an explicit importer/export/fixture.
- Add guard 2: a test that fails when new application/interface code resolves or persists through `missions/**` or repo Backlog task files as Mission persistence.
- Report any material contradiction between the landed ADRs and this wave's assumptions as a human-stop (see Stop Rules), not a code reconciliation.

## Out of Scope
- Changing any behavior, storage model, migration, or domain transition.
- Reconciling or "fixing" any perceived ADR contradiction in code.
- Creating a prose inventory file, index, manifest, or documentation page that tracks the audit (the executable inventory in `test/fixtures/` is the single source of truth).
- Modifying the ADRs themselves.
- Implementing any further ADR 0053 cutover domain (this mission locks the boundary; it does not advance it).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable and free of unqualified subjective adjectives or vague quantifiers.

- SC1 Every current production read/write of the targeted paths is accounted for with file:symbol evidence. → Falsifiable if any targeted path has a production writer with no entry in `test/fixtures/durable-state-inventory.ts` and no row in a checkpoint Goal Check table citing `src/...:symbol`.
- SC2 No unidentified normal-runtime persistence path remains. → Falsifiable if guard 1 fails on the final tree and the checkpoint Goal Check table shows a negative assertion (a synthetic rogue writer is rejected).
- SC3 Architecture tests fail on a newly introduced normal-runtime workflow-metadata writer. → Falsifiable by introducing a throwaway `writeFileSync` to a retired path in a non-exception call site and observing `npm test` failure, then removing it.
- SC4 No new documentation inventory/index/manifest was added to track the audit. → Falsifiable if any new `*.md` under `docs/` or a new inventory/manifest file exists beyond this Mission's checkpoints.
- SC5 No behavior or storage model is changed beyond the guardrails needed to establish the boundary. → Falsifiable if `git diff` against the parent commit touches any non-test source file under `src/` outside pure data/type additions in `test/fixtures/` and the two new test files.
- SC6 Any contradiction between landed ADRs and this wave causes a human-stop result rather than an implementation guess. → Falsifiable if the implementer silently changed behavior to hide a contradiction instead of recording a human-stop in the checkpoint Goal Check.

## Risks and Assumptions
- The landed ADRs may contain internal tensions (e.g. ADR 0037/0051 keep Backlog Markdown as external source while ADR 0053 makes the database the sole persistence authority). Assumption: these are deliberate authority separations, not contradictions; if a read of the current ADRs surfaces a genuine conflict, STOP and record a human-stop.
- Guard 1 must not false-positive on legitimate writers (importers, exports, test fixtures, ephemeral transport). Assumption: those are explicitly registered in the inventory with their classification, so the guard can consult it.
- The guard tests run at `npm test` time and scan the source tree; they must be fast (<500 ms) and must not touch real Forgejo, agents, Git worktrees, or the operator database.
- Reuse of existing guard patterns (`test/persistence-inventory-guardrail.test.ts`, `test/domain-authority.test.ts`, `test/persistence-domain-mapping.test.ts`, `test/domain-attempt-guard.test.ts`) rather than a new mechanism, to stay within the NEL budget and avoid a second enforcement surface.

## Checkpoints
- CP 1: ADR re-read and audit — confirm the current ADR contract and classify every targeted call site.
- CP 2: Register every discovered call site in `test/fixtures/durable-state-inventory.ts`.
- CP 3: Guard 1 — executable anti-regression guard against new normal-runtime writes to retired workflow paths.
- CP 4: Guard 2 — executable guard against new application/interface code treating `missions/**` or Backlog task files as Mission persistence.
- CP 5: Verification, goal-check, and handoff.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/persistence-inventory-guardrail.test.ts` ``, `` `./scripts/verify-local.sh static-analysis` ``, or `` `node --import tsx test/e2e-mission-lifecycle.test.ts` ``
  2. **Test names** — must match a test name in the repo, e.g. `"authority is exhaustive over mission fields and covers the legacy path inventory"`
  3. **Test file paths** — must be an existing test file, e.g. `test/domain-authority.test.ts`
  4. **ADR references** — must correspond to an existing file under `docs/adr/`, e.g. `ADR 0053`
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. This is the weak-agent failure mode: a raw `ls test/` dump, a `grep` transcript, or prose like "the guard exists and works" is NOT sufficient evidence. State exactly which test enforces the criterion, name the test, give its file path, and show the command that proves it (for example `npm test -- test/persistence-inventory-guardrail.test.ts`) alongside the output. Shell output without the matching recognized command or test name is rejected.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh static-analysis` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh static-analysis
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `docs/adr/*.md` — the ADRs are architecture authority; read-only, do not edit.
- Any non-test source file under `src/` except pure data/type additions required to expose an inventory constant that the guards reference. No behavior, storage, migration, or domain change.
- The backlog task file's `assignee` field — the workflow records ownership; do not set it.
- `node_modules`, the operator SQLite database, worktrees, and any real Forgejo/git-push target.

## Stop Rules
- Stop and record a human-stop if a current ADR (0032, 0036, 0037, 0047, 0048, 0051, 0053) materially contradicts this wave's assumptions. Do not reconcile in code.
- Stop before changing any behavior or storage model; this mission is guardrails only.
- Stop if a guard would false-positive on a legitimate importer/export/fixture and cannot be made precise by inventory registration — prefer registering the exception over a brittle pattern.
- Stop if verification cannot run on the current tree; report the blocker rather than claiming a green gate.
- Do not push to `origin` on the mission branch; the review remote is the only push target for mission code.
