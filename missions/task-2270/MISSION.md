# Mission: Exclude mission documents from the Graphify graph (task-2270)

## Goal
Add repository-level Graphify exclusion configuration so generated mission-document artifacts are omitted from Parallix's self-hosting graph while source-code relationships remain available.

## Why Now
Parallix generates mission planning and checkpoint documents as it develops itself. Those generated artifacts currently add high-volume workflow text to Graphify, obscuring the code and repository relationships the graph is intended to surface.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: identify Graphify's source-level exclusion seam; wire the narrow mission-document exclusion into this repository's graph configuration or invocation; protect the behavior with a focused fixture or test; refresh the local graph output.

## Scope
- Inspect the Graphify configuration and invocation path used by this repository, and identify the supported source-level mechanism for excluding directories.
- Add the narrowest repository configuration or invocation change that excludes generated mission documentation from Graphify input.
- Add focused automated coverage or a graph fixture that proves a file beneath the excluded mission-document path is absent from graph output while a non-excluded source fixture and its relationship remain present.
- Update the repository's Graphify output after the implementation so local graph artifacts reflect the configured exclusion.
- Document any user-facing Graphify configuration behavior required to maintain the exclusion.

## Out of Scope
- Filtering nodes after Graphify has already indexed mission documents.
- Excluding all of `missions/` when a narrower mission-document directory can be excluded.
- Changing Graphify semantic extraction, clustering, query ranking, or unrelated graph generation behavior.
- Adding a general-purpose UI for graph exclusions or modifying exclusion policy for other repositories.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A Graphify build for this repository uses a supported source-level exclusion mechanism that omits the configured generated mission-document directory before graph nodes are created.
- The repository configuration names the exact excluded mission-document path or pattern and does not exclude `lib/`, `test/`, `docs/adr/`, or other repository source/documentation paths outside the generated mission artifacts.
- Focused automated coverage or a committed graph fixture contains: one file under the excluded path, one non-excluded source file, and a relationship involving the non-excluded source file; its assertions prove the excluded file has no graph node and the non-excluded node and relationship remain.
- The relevant Graphify command or test completes successfully after the change, and `./scripts/verify-local.sh all` completes successfully on the final tree.
- Any documentation changed for the configuration explains the exclusion's effect and identifies the configured mission-document path or pattern.

## Risks and Assumptions
- Assumption: the installed Graphify version exposes a supported input-time directory exclusion option; implementation must use that option rather than post-processing graph output.
- Risk: a broad glob can hide code-relevant mission artifacts. Mitigation: constrain the pattern to generated mission documents and validate a non-excluded source relationship in focused coverage.
- Risk: graph artifacts may be large or derived. Mitigation: update only through `graphify update .` and review the resulting exclusion effect rather than hand-editing generated graph files.

## Checkpoints
- CP 1: Inventory the current repository Graphify invocation/configuration and Graphify's supported input-time exclusion behavior; select the narrow generated mission-document path or pattern and add the focused fixture/test that distinguishes excluded content from retained source relationships.
- CP 2: Wire the selected exclusion into the repository Graphify configuration or invocation, add or complete focused assertions, and update any affected configuration documentation.
- CP 3: Run the focused Graphify validation, run `graphify update .`, inspect the refreshed graph for the excluded path and retained source relationship, then run the required repository verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of work done and a concrete `Next action:` line at the bottom.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited Markdown table header `| Criterion | Evidence | Status |`.
- At least one evidence row for every Success Criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `node scripts/example.mjs` ``, `` `git diff --check` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not acceptable evidence for a weak-agent handoff; when shell output is useful, pair it with at least one accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not implement post-index graph filtering, alter Graphify extraction semantics, or broaden the exclusion beyond generated mission documents without explicit mission-scope approval.
- Do not hand-edit generated `graphify-out/` artifacts; regenerate them only with the supported Graphify update command.
- Preserve existing graph nodes and relationships for non-excluded repository source fixtures in the focused coverage.

## Stop Rules
- Stop and request direction if Graphify has no supported input-time exclusion mechanism, because a post-processing workaround is outside this mission.
- Stop and request direction if the only viable pattern excludes all of `missions/` or any path containing code-relevant artifacts; do not widen scope to decide repository retention policy.
- Stop and request direction if validating the exclusion requires changing Graphify upstream or modifying unrelated graph generation behavior.
