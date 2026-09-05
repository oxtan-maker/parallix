# Mission: document config (task-2455)

## Goal
Audit every configurable piece of `workflow.config.json`, confirm each one actually works end-to-end, then publish one user-facing config reference (`docs/config.md`) documenting every working piece and link it from `README.md`. For any piece that does not currently work, file a separate `backlog/tasks/*.md` bug task per independent broken piece (plus a `Reproduction-Test:` line in this mission only if that bug task is itself drafted as a mission) and defer its documentation until fixed.

## Why Now
`workflow.config.json` is the single override surface for the whole workflow runtime, but there is no single authoritative user guide for it: the schema lives in `config/workflow.config.schema.json`, the resolution logic is scattered across `src/adapters/config/product-config.ts`, and the README only sketches the verification gate and Forgejo. Operators currently cannot learn what each adapter field does, how it is validated, or what the built-in default is. `px config` already prints the effective config and `validateWorkflowConfig` already rejects bad input, so the machinery to validate every piece exists today — only the documentation does not.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: config surface has no user doc; schema + resolver + `px config` already exist to validate each piece; README references `workflow.config.json` but does not enumerate its fields.

## Scope
- Enumerate every configurable piece under the `product` and `adapters` (tasks, missions, verification, review, agents, integrate) keys of `workflow.config.json`.
- For each piece, confirm it works by (a) reading its resolver in `src/adapters/config/product-config.ts` and any consumer, (b) confirming its schema entry in `config/workflow.config.schema.json`, and (c) exercising it through the read-only `px config` command (`npm run dev -- config` or the built `px config`), which prints the effective config and fails non-zero on invalid JSON or structural violations.
- Document each working piece in `docs/config.md`: field path, schema type, built-in default, what overriding it changes, and a minimal `workflow.config.json` snippet.
- Add a link to `docs/config.md` from `README.md` in the existing configuration section (around the `px setup` / verification-gate paragraph).
- File one `backlog/tasks/<slug> - <broken-config-piece>.md` bug task per independent config piece that fails validation, each describing the exact reproduction, the failing assertion, and the fix intent; do not fix them here.

## Out of Scope
- Changing any resolver, validator, or default value in `src/` — this is a documentation-and-audit mission; behavior is fixed unless an audit finds a genuinely broken piece, in which case the output is a bug task, not a fix.
- Adding new config fields or schema properties.
- Rewriting the JSON schema itself beyond noting discrepancies found during the audit.
- Documenting non-config surfaces (Forgejo account setup, mission lifecycle, backlog adoption) beyond the minimal cross-references already in the README.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Every one of the six `adapters` pieces (`tasks`, `missions`, `verification`, `review`, `agents`, `integrate`) plus the `product` keys is present in `docs/config.md`, each with its field path, schema type, built-in default, and an override snippet.
- `docs/config.md` exists as a file under `docs/` and contains no placeholder text (no `TBD`, `<...>`, or "coming soon").
- `README.md` contains a hyperlink to `docs/config.md` in the configuration section and the link resolves to an existing file.
- `px config` exits `0` and prints the effective config for a repo with no `workflow.config.json`, and exits non-zero with a `invalid JSON` / `structurally invalid` message for a malformed or schema-violating `workflow.config.json` (verified against `test/config-command.test.ts`).
- Each broken config piece (if any) has its own `backlog/tasks/*.md` file; if zero pieces are broken, this criterion is satisfied by the absence of any such file and a statement to that effect in `docs/config.md`.
- No adapter field that is documented in `docs/config.md` is absent from `config/workflow.config.schema.json` or unresolvable in `src/adapters/config/product-config.ts`.

## Risks and Assumptions
- A piece documented as "working" may have a resolver that reads a field the schema does not declare (or vice versa); caught by cross-referencing schema vs. `product-config.ts` before writing each doc entry.
- `px config` requires installed dependencies (`fastify`, etc.); if the environment cannot run it, the audit falls back to reading the resolver + schema + `test/config-command.test.ts` and states that the command was not executed live.
- `docs/config.md` could drift from the schema again; the durable guard is the `px config` command and `validateWorkflowConfig`, which are the source of truth operators should run, not the doc.
- Over-documenting fields that are internal-only (e.g. `storagePath` is a code alias, not a documented schema key) would mislead users; scope docs to schema-declared keys only.

## Checkpoints
- CP 1: Audit and classify — enumerate all config pieces, mark each working or broken, and record the verdict with evidence.
- CP 2: Author `docs/config.md` for all working pieces and file bug tasks for any broken pieces.
- CP 3: Link `docs/config.md` into `README.md` and run the verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify any resolver, validator, default, or schema file in `src/` or `config/` — documentation only, unless a bug task is being filed (the bug task file itself is the only source change for a broken piece).
- Do not author a fix for any broken config piece; the output for a broken piece is a `backlog/tasks/*.md` bug task, not a code change.
- Do not add new config fields or schema properties.
- Do not run the test suite beyond the single `./scripts/verify-local.sh all` gate.
- Do not touch Forgejo, git remotes, or push anything (local-only; this is a draft).

## Stop Rules
- Stop drafting once every scaffolded section is filled with concrete content and `./scripts/verify-local.sh all` passes.
- Stop if the audit reveals the config surface cannot be validated in this environment — record the limitation in the mission and finish; do not fabricate a "working" verdict.
- Stop before implementing any fix; this mission produces a contract only.
