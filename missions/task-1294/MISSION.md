# Mission: Make documentation single-source and resistant to drift (task-1294)

## Goal
Eliminate volatile implementation evidence (file:line paths, test filenames, source inventories) from live authored documentation so docs reflect durable concepts, invariants, and rationale — not current source-tree layout that agents must keep synchronized on every refactor.

## Why Now
Live docs (`docs/authority-reference.md`, `docs/use-cases.md`) carry source paths (`src/adapters/backlog/backlog.ts`, `src/application/measurement-ports.ts`, `test/backlog_gate.test.ts`) and test-name evidence that drift every time code moves. Agents currently copy implementation facts into prose, creating duplicated authorities future missions must re-sync. A source refactor with unchanged behavior should not require doc edits, yet today it does because docs mirror file structure.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: reduce agent doc-maintenance burden, prevent drift across future refactors, clean current evidence duplication in authority-reference.md and use-cases.md

## Scope
- Audit `docs/authority-reference.md`, `docs/use-cases.md`, `docs/doc-standards.md`, and `README.md` for duplicated executable facts and volatile implementation references
- Classify each duplicated fact by its canonical owner (CLI metadata, schema, config, test, source code)
- Remove volatile implementation references (source paths, test filenames, line numbers) from live docs where the info is available from the canonical machine-readable authority
- Simplify `docs/authority-reference.md` and `docs/use-cases.md` to describe durable architectural invariants, supported capabilities, confidence/limitations, and rationale — without mirroring current implementation locations
- Update `docs/doc-standards.md` with explicit rules: authored docs must not reproduce volatile implementation facts; checkpoint evidence may cite file:line/test paths but those references must not become live documentation
- Add deterministic anti-drift verification checks: live authored docs must not accumulate file:line implementation-evidence patterns; markdown links must resolve
- Reconcile current live docs with current HEAD using the single-source model
- Update `AGENTS.md` documentation guidance to enforce single-source rules for future missions

## Out of Scope
- Historical ADRs, completed missions, checkpoints, and retrospective evidence — do not rewrite for stale paths
- Creating new generated documentation unless a clear user-value reference need exists and a canonical machine-readable authority already exists
- Creating a metadata registry or auto-rewrite agent for synchronization
- CHANGELOG revival or new artifact creation
- Code changes beyond documentation files, verification scripts, and standards

## Success Criteria
- SC1: `docs/authority-reference.md` contains zero bare `src/...` or `lib/...` source-path references that duplicate code layout (stable capability descriptions or config references OK)
- SC2: `docs/use-cases.md` contains zero bare `test/...` test-filename references that duplicate test inventory (capability descriptions and confidence levels OK)
- SC3: `docs/doc-standards.md` includes explicit rules prohibiting volatile implementation evidence in authored documentation and defining the single-source model
- SC4: `AGENTS.md` documentation guidance updated with rules: authored docs must not reproduce volatile implementation facts; internal refactors with unchanged behavior normally have no documentation impact
- SC5: `./scripts/verify-local.sh docs` passes on the final tree
- SC6: All relative Markdown links in `docs/authority-reference.md`, `docs/use-cases.md`, `docs/doc-standards.md`, and `README.md` resolve to existing files
- SC7: A new or updated verification step detects file:line implementation-evidence patterns in live docs and reports them as drift

## Risks and Assumptions
- Risk: Removing implementation references may reduce navigability for operators who use docs as code index. Mitigation: preserve stable capability/use-case identities and ADR cross-references; source-code navigation belongs in graphify, not prose
- Risk: Anti-drift checks may produce false positives for genuinely durable path references (e.g., `workflow.config.json` is a stable config identity, not volatile layout). Mitigation: checks target `src/...:\d+` and `test/...` filename patterns, not config or schema identities
- Assumption: Current `docs/authority-reference.md` and `docs/use-cases.md` are the primary surfaces carrying drift; README.md is lighter on implementation evidence
- Assumption: No code changes beyond docs, verification scripts, and standards are needed

## Checkpoints
- CP 1: Inventory live documentation against canonical executable/design authorities. Catalog every source path, test filename, and line-number reference in `docs/authority-reference.md`, `docs/use-cases.md`, `docs/doc-standards.md`, and `README.md`. Classify each as (a) volatile implementation fact to remove, (b) stable config/capability identity to keep, or (c) evidence that should derive from canonical source. Capture findings as regression fixtures.
- CP 2: Remove volatile implementation/evidence duplication from live docs. Reduce `docs/authority-reference.md` and `docs/use-cases.md` to durable concepts, invariants, capabilities, limitations, and rationale. Preserve concise user guidance where repetition is intentionally explanatory; remove exhaustive inventories duplicating executable sources.
- CP 3: Derive any genuinely necessary reference views from canonical source. Add deterministic anti-drift checks that flag file:line implementation-evidence patterns in live docs and verify markdown link resolution.
- CP 4: Update `docs/doc-standards.md` and `AGENTS.md` documentation guidance so future missions update docs only for semantic documentation impact and do not reintroduce implementation evidence. Remove existing guidance encouraging file:line references as durable documentation evidence.
- CP 5: Reconcile current live docs with current HEAD using the single-source model. Run documentation verification, static analysis, and general verification.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- `src/` source code files (do not modify beyond doc-reconciliation)
- `test/` test files (do not modify beyond adding anti-drift verification)
- Historical ADRs under `docs/adr/` (do not rewrite for stale paths)
- `config/` files (do not modify unless anti-drift check needs config)
- `CHANGELOG.md` (do not revive or modify)

## Stop Rules
- Do not solve documentation drift by creating another metadata registry that duplicates code
- Do not add broad auto-rewrite agents for synchronization
- Do not mechanically update source paths/line numbers whenever files move
- Do not require documentation changes for every mission
- Prefer deleting duplicated information over automating its synchronization
- Introduce generated documentation only when the reference has clear user value and a canonical machine-readable authority already exists
- If a fact cannot be assigned one clear authority, resolve that authority problem rather than documenting competing versions
