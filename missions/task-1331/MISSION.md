# Mission: Publish parallix credibly and remove stale visualBoard branding (task-1331)

## Goal
Turn the now-public `parallix` repository into a coherent public-facing product surface by
locking one credible near-term distribution model, aligning the package/docs metadata to
that model, and removing stale `visualBoard` branding from current public-facing
parallix-owned surfaces.

## Why Now
The repository was pushed to public GitHub on 2026-06-22, but the current public story is
internally inconsistent:

- `package.json` is marked `"private": true` and its `description` calls parallix
  "unpublished".
- `README.md` opens (line 3) by framing the tool as the "visualBoard AI mission lifecycle".
- The active distribution ADR (`docs/adr/0044-workflow-distribution-model.md`) is still
  `Status: Proposed` even though the repo now exists publicly and needs a concrete
  operator-facing story.
- Current docs/templates (for example `templates/vibe/skills/*`) still describe the
  workflow with `visualBoard` wording.

That combination makes the project look half-renamed and half-unreleased. A public repo
needs one explicit acquisition/install story and one consistent product name.

## Refinement Signals
- Estimated agent % usage limit: 25-50%
- Confidence: High
- Selection note: activate as-is
- Main drivers: public credibility, distribution clarity, naming consistency, reduce
  confusion for external operators evaluating parallix

## Scope
- Choose and document one supported near-term distribution model for public parallix use.
  The preferred shape is a scoped Node package / tarball-backed `px` CLI story because the
  repo already ships `px.js`, a `bin.px` entry, a `files` allowlist, and a Node test suite;
  if execution evidence shows a different model is cleaner, document that alternative
  explicitly and align all touched surfaces to it.
- Align public-facing package metadata and install/run guidance to the chosen model in the
  active repo surfaces: `package.json`, `README.md`, and any directly linked release /
  distribution documentation updated by the mission.
- Convert stale `visualBoard` references in current parallix-owned public-facing docs and
  templates to `parallix` or neutral wording where they are describing the current product
  rather than historical provenance.
- Update tests only where assertions or fixtures must change because the public-facing
  strings or supported distribution model changed.
- Keep historically accurate references when they are clearly presented as history,
  evidence, or external-path examples tied to older repos/tasks.

## Out of Scope
- Actually publishing to npm or another registry.
- Building release automation, CI release pipelines, signing, Homebrew, Docker, or
  standalone-binary distribution.
- Rewriting archived backlog tasks, historical review artifacts, or old mission evidence
  purely to remove legacy `visualBoard` names.
- Changing workflow behavior unrelated to distribution or product naming.
- Renaming purely internal temporary test paths unless those paths are part of current
  public-facing output or assertions that the mission intentionally updates.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

1. `README.md` contains one explicit public distribution section for parallix that answers
   all of: supported acquisition/install path, how the operator invokes `px`, what remains
   source-compatible for local development, and what is not yet supported. The README no
   longer describes parallix as a `visualBoard` workflow.
2. `package.json` no longer contradicts the chosen distribution model. Concretely, the
   fields governing public packaging and operator expectations (`name`, `description`,
   `private`, `bin`, and any newly added publish-related metadata) are mutually consistent
   with the README's install story.
3. The architectural decision record for distribution is no longer left in an ambiguous
   pre-public state. Either `docs/adr/0044-workflow-distribution-model.md` is moved off
   `Status: Proposed` to reflect the selected public distribution stance with current
   evidence, or a successor ADR is added and linked from `docs/adr/index.md`; in either
   case, the repo has one authoritative distribution decision for contributors and
   operators.
4. The current parallix-owned public-facing branding surfaces no longer use `visualBoard`
   to describe the current product. At minimum this audit includes `README.md` and the
   active skill templates under `templates/vibe/skills/`. Any remaining `visualBoard`
   mention in touched files is explicitly historical, external-reference-only, or
   otherwise justified in-file by context.
5. If public-facing strings or distribution behavior change, the affected tests are updated
   so the suite passes without removing existing coverage for `px` invocation, packaging
   metadata, or touched documentation-driven behavior.
6. `npm test` completes with zero failures after the mission changes.

## Risks and Assumptions
- The mission assumes "credible distribution model" means documenting and aligning the
  supported near-term delivery path, not completing a live registry release.
- ADR 0044 may contain still-valid reasoning even if the final stance changes; update it
  carefully so historical analysis is preserved while the current decision becomes clear.
- Some `visualBoard` references are intentionally historical or external-path examples
  (for example the historical mapping table at `README.md:95`). Those should be preserved
  when they carry evidence value; blanket search-and-replace is explicitly unsafe.
- `package.json` changes may have knock-on effects in tests or local tooling, especially if
  `private` or publish metadata changes.
- This repo's only configured verification command is `npm test`
  (`workflow.config.json` → `adapters.verification.command`); there is no `scripts/`
  directory and no `verify-local.sh` script in this repo.

## Checkpoints
- CP 1: Inventory and decide. Confirm which current files define the public distribution
  story (`package.json`, `README.md`, ADR/docs) and which `visualBoard` references are
  current-product branding versus historical evidence. Lock the chosen near-term
  distribution model before editing broad copy.
- CP 2: Apply the public-facing distribution updates. Align README/package/ADR surfaces so
  the public install/run story is consistent and contributor-readable.
- CP 3: Clean the remaining current-product `visualBoard` references in scoped
  docs/templates/tests, preserving justified historical references, then run `npm test`.

## Gates
- [ ] npm test

## Restricted Areas
- Do not edit the backlog task `assignee` field.
- Do not rewrite archived backlog tasks, archived review artifacts, or historical mission
  records solely for branding cleanup.
- Do not broaden the mission into release automation, registry publishing, CI/CD, or
  unrelated workflow refactors.
- Do not silently preserve contradictory public statements; if two public surfaces disagree,
  resolve the conflict explicitly in favor of the chosen distribution model.
- Do not remove historically important `visualBoard` references from ADR evidence or path
  citations unless the replacement preserves the historical meaning.

## Stop Rules
- Stop if the only credible distribution answer requires external inputs not present in the
  repo (for example registry ownership, package scope ownership, or enterprise policy
  constraints) and the mission cannot proceed without inventing them.
- Stop if resolving the distribution model would require a broader architectural extraction
  than the repo currently supports, rather than a scoped public-story/package-doc cleanup.
- Stop if `npm test` failures appear unrelated to touched distribution/branding changes and
  cannot be confidently attributed or fixed within mission scope.
- Stop if the cleanup would require mass-editing historical artifacts instead of current
  parallix-owned public surfaces.
