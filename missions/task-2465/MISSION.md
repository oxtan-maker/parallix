# Mission: Split each prompt into a Parallix core and an overridable default (task-2465)

## Goal
Split the five shipped stage prompts into mandatory Parallix-owned core files and replaceable default-opinion files, while preserving every original non-blank prompt line byte-for-byte when no override is configured.

## Why Now
Prompt instructions currently combine workflow mechanics that must remain invariant with review and execution preferences that repositories need to tailor. A single optional override must allow local opinion replacement without letting a repository remove parser-visible, safety, lifecycle, or artifact requirements.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: five prompt splits; launch-point assembly; preservation and configuration-boundary coverage; one configuration documentation update

## Scope
- Split the draft, execute, review, act-on-review, and portfolio prompts into ten files: one core and one shipped default-opinion file for each stage.
- Classify a line as core only when removing it mechanically breaks the loop: artifact paths or filenames, parser-visible tokens or formats, harness placeholders, permitted `px`/Git/Forgejo commands, safety or separation-of-duties rules, and lifecycle mechanics. Keep a mixed-purpose line wholly in core and never split a line.
- At every existing stage launch point, load the stage core and append either its shipped default or the one repo-local override selected by exactly one new configuration key.
- Add preservation, default-behaviour, override-survival, and unknown-configuration-key tests using established repository patterns.
- Document the optional configuration key in `docs/config.md`, including unchanged unconfigured behaviour and links to the shipped defaults.

## Out of Scope
- Any prompt wording, policy, formatting, or line-content change beyond moving existing lines, boundary blank lines, and one heading naming each new file.
- Prompt selection or override granularity by stage, agent, model, user, mission, or repository setting beyond the single override; maps, arrays, registries, precedence layers, and per-stage keys are forbidden.
- Runtime prompt editing, a management UI, a templating language, plugin interface, resolver hierarchy, factory, new dependency, or any mechanism that makes a core instruction configurable.
- Source changes outside the minimum two-file loading/concatenation path; non-test, non-prompt, non-documentation changes under `src/` reaching 150 lines or more.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Exactly ten files under `prompts/` provide a core and default-opinion half for each of draft, execute, review, act-on-review, and portfolio.
- For each of the five stages, a preservation test proves that the non-blank-line multiset from core plus default equals that stage's parent-commit prompt, excluding only the added file heading; changing a moved line makes that test fail.
- With no override configured, each of the five existing launch points produces the same instruction content as its corresponding pre-split prompt; one test covers each launch point.
- With the single override configured, every assembled stage prompt contains replacement content and retains a named core instruction; a test proves an override cannot drop that core instruction.
- Exactly one new configuration key selects the optional replacement; a test proves unknown keys beneath it fail through the existing configuration-error path.
- The final non-test, non-prompt, non-documentation `src/` diff is fewer than 150 lines, and the final Goal Check records the measured count.
- `docs/config.md` documents the optional key, states that an unconfigured repository retains current behaviour, and links to the five shipped default-opinion files.

## Risks and Assumptions
- Assumption: the current five prompt files and launch points are the complete stage surface; implementation must stop if another path supplies any of those prompts.
- Risk: a mechanically required line can look like opinion. The stated classification rule is authoritative; ambiguous or mixed lines remain core unchanged.
- Risk: one configuration key may not select a replacement for all five stages without forbidden selection logic. Stop rather than adding per-stage configuration or an abstraction.
- Risk: textual drift during file moves invalidates prompt behaviour. Preservation tests must compare non-blank lines against parent-commit content.

## Checkpoints
- CP 1: Inventory the five current prompt files and all launch points; record the line-by-line core/default classification and confirm that each line is moved unchanged or retained as a boundary blank line.
- CP 2: Add the ten prompt files and the minimum configuration/loading path, then demonstrate no-override equivalence and override retention of core content.
- CP 3: Add configuration-boundary and line-preservation coverage, document the one optional key, measure the qualifying `src/` diff, and run the required gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A concise summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column table `| Criterion | Evidence | Status |` with one row for every Success Criterion.
- Lead each evidence cell with durable evidence Parallix verifies today: exact test names, ADR references, test file paths, or recognized repository commands and paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.
- For prompt preservation, name each of the five preservation tests and its test path; for launch equivalence, name all five launch-point tests; for the diff budget, cite the recognized `git ...` command used to count qualifying `src/` lines and state its result.
- Raw `stat`/`ls` output or generic prose alone is not evidence. If used, pair it with an accepted command, path, exact test name, or ADR reference above.
- A non-generic `Next action:` line at the bottom.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- The core prompt half is mandatory and cannot be replaced, omitted, configured, or selected conditionally.
- Do not edit Scope, Success Criteria, Out of Scope, or Restricted Areas during execution to authorize prohibited work.
- Do not change prompt text: allowed prompt-file edits are only whole-line moves, boundary blank lines, and one file-naming heading. File a separate task for any incorrect existing instruction.
- Do not add more than one configuration key or any per-stage, per-agent, per-model, per-user, per-mission, array, map, registry, template, resolver, plugin, factory, interface, or dependency.
- Keep non-test, non-prompt, non-documentation changes under `src/` below 150 lines.

## Stop Rules
- Stop and ask if preserving the split requires changing any prompt wording or a line cannot be classified without splitting it.
- Stop and ask if one configuration key cannot serve all five stages, or if a launch point cannot concatenate two files without adding a forbidden abstraction.
- Push back when a requested change conflicts with this contract. For an operator direction outside the contract, quote it in the round resolution, state whether it fits, and raise it as a scope question rather than silently acting or ignoring it.
- Review only split defects: changed rather than moved text, core text in the overridable half, an override able to drop core, a launch point assembling one half, or a broken default path. Do not expand review into override-design preferences or requests for more configuration or abstraction.
