# Mission: update config documentation (task-2460)

## Goal
Reconcile `docs/config.md` with the current `workflow.config.json` product behavior so the reference no longer describes schema fields or validation gaps that the runtime no longer leaves open. The single durable change is the documentation: stale "known gaps" claims that were closed by the task-2455.0x series (field-level schema validation now enforced) are corrected, and any field that carries a real runtime effect but is undocumented or mis-described is brought into line with `config/workflow.config.schema.json` and `src/adapters/config/product-config.ts`.

## Why Now
`docs/config.md` was last edited in the task-2457 commit (2026-09-06) and still carries a "Known configuration gaps" section that lists TASK-2455.03 as an open defect: "`px config` currently does not validate individual schema field types, enums, or unknown properties (except `adapters.tasks.provider` and `agents.maxConcurrentCustom`)". The task-2455.0x series (2026-09-05/06) then made that validation effective — `validateWorkflowConfig` in `src/adapters/config/product-config.ts` now enforces field types, enums, and closed-object shape for every documented adapter section (tasks, missions, verification, gates, integrate, review, agents). The docs now contradict the product: they tell users that field-level validation is not enforced when it is. This is exactly the drift the backlog task names — config documentation is out of date relative to the last 48 hours of missions.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: config documentation drift behind product behavior; closed schema-validation gap still advertised as open.

## Scope
- Update `docs/config.md` only (plus any config doc it directly cross-references, if any exist in `docs/`).
- Correct the "Known configuration gaps" section: remove or restate every gap whose end-to-end runtime effect was removed by the task-2455.0x series, citing the now-effective behavior, not the stale defect.
- Verify every documented field in `docs/config.md` matches the effective behavior enforced in `src/adapters/config/product-config.ts` (field types, enum constraints, closed-object adapter sections, defaults) and add any effective field that is missing.
- Keep all existing backlog-task cross-reference links valid; do not fabricate new gap links.
- Preserve doc-standards compliance: no volatile source-path or test-inventory evidence, no `file.ts:<line>` citations in live docs.

## Out of Scope
- No changes to `config/workflow.config.schema.json`, `src/`, `test/`, `scripts/`, or any other source.
- No new config fields, no behavior changes, no new ADRs.
- No updates to unrelated docs (README, use-cases, agents, operator-setup) unless a config cross-reference in them is broken by this change.
- No reproduction test (this mission is not bug-labeled).

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable; no subjective adjectives or vague quantifiers.

- Every field listed under `docs/config.md`'s "Known configuration gaps" that the runtime now validates is no longer presented as an open gap. Falsifiable: re-reading the section and running `node -e "require('./src/adapters/config/product-config.js')"`-level checks against `validateWorkflowConfig` shows the previously-closed field-level validation now runs.
- The "Known configuration gaps" section lists only gaps with a confirmed, currently-existing end-to-end runtime effect. Falsifiable: each remaining gap maps to a backlog task that still exists and whose description still describes an unfixed defect; TASK-2455.03 and TASK-2455.04 references are removed or corrected because schema validation and config-command exit status are now enforced.
- Every documented adapter field in `docs/config.md` has a matching effective constraint in `src/adapters/config/product-config.ts`. Falsifiable: for each of `adapters.tasks`, `adapters.missions`, `adapters.verification`, `adapters.gates`, `adapters.integrate`, `adapters.review`, `adapters.agents`, the documented type/enum/default is asserted true by reading the corresponding `validate*` function in `product-config.ts`.
- `docs/config.md` contains no `file.ts:<line>` style citation and no `src/` or `test/` path evidence. Falsifiable: `rg -n '[[:alnum:]_./-]+\.[[:alpha:]_-][[:alnum:]_-]+:[0-9]+' docs/config.md` returns nothing and `rg 'src/|test/' docs/config.md` (outside code fences) returns nothing.
- All relative Markdown links in `docs/config.md` resolve to existing files. Falsifiable: `./scripts/verify-local.sh docs` passes the link check.

## Risks and Assumptions
- Assumption: the task-2455.0x series genuinely closed the gaps it claims; verified against `product-config.ts` before removing the gap entries. If a gap's runtime effect is only partial, the doc must describe the partial effect rather than drop it.
- Risk: removing a gap that still has a subtle runtime effect misleads users. Mitigation: confirm each removal against the actual `validate*` functions and the schema, not against the backlog titles.
- Risk: introducing `file.ts:<line>` or `src/`/`test/` evidence while editing. Mitigation: cite backlog-task links and recognized repo commands only.
- Assumption: no other config doc exists that needs the same reconciliation; if `docs/` contains another config-facing doc, scope expands and the mission pauses for refinement.

## Checkpoints
- CP 1: Investigate config drift and produce a gap inventory mapping each "Known configuration gaps" entry to its current runtime effect.
- CP 2: Update `docs/config.md` — close stale gaps, correct any mis-described effective fields, keep all cross-references valid.
- CP 3: Verify docs compliance and evidence with the repository verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `./scripts/verify-local.sh all` ``, `` `node -e "..."` ``, or `` `rg -n '<pattern>' docs/config.md` ``
  2. **Test names** — e.g., a test name from `test/product-config.test.ts` or `test/config-command.test.ts` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/product-config.test.ts`, `test/config-command.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Example of a weak row: `ls docs/` alone. That must be followed by a recognized reference such as `` `./scripts/verify-local.sh all` `` or `test/product-config.test.ts`. A bare shell listing is not sufficient evidence on its own.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Config gap inventory maps stale entries to runtime effect | `src/adapters/config/product-config.ts`, `config/workflow.config.schema.json` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/`, `test/`, `config/`, `scripts/`, and every file outside `docs/config.md` are off-limits. No source, schema, or test edits of any kind.

## Stop Rules
- Stop before editing any file other than `docs/config.md` and this mission scaffold.
- Stop if investigation reveals the config gap is not actually closed and requires a code fix — escalate by pausing for refinement rather than fixing code.
- Stop if no concrete drift is found beyond what is already documented; report the finding instead of rewriting clean prose.
- Do not run any test or verification gate other than `./scripts/verify-local.sh all`.
- Do not transition the backlog task; the harness transitions it to `ready` after a clean draft.
