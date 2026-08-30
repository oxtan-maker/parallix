# Mission: Integrate safe review actions behind typed board commands (task-2428)

## Goal

Expose only board review commands whose meaning has a proven one-to-one mapping to an existing, checked review application operation, while preserving reviewer separation, reviewed-revision identity, provider/human approval rules, failure truthfulness, and existing CLI review behavior.

## Why Now

The board vocabulary already names `review:submit`, `review:act-on-findings`, and `approve:review`, but the review use case currently chooses behavior through CLI-style flags. Wiring labels directly to convenient flags risks submitting the wrong review operation, allowing browser-supplied review artifacts, or fabricating approval state. The board needs a narrow typed boundary before these actions are exposed.

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: characterize the existing application semantics first; leave any command without an unambiguous mapping unavailable.
- Main drivers: review CLI/application characterization, typed board-command dispatch, lifecycle and failure-path coverage, and negative approval coverage.

## Scope

- Characterize the current CLI and application semantics for the review operations considered by `review:submit`, `review:act-on-findings`, and `approve:review` before changing board dispatch.
- Enable only review board kinds with one trusted application operation and a typed, browser-safe input shape.
- Preserve current-work phase transitions, reviewer-family constraints, reviewed revision identity, and the existing review loop for starting or continuing review.
- If `review:act-on-findings` is enabled, derive the action from existing review artifacts and domain state rather than browser-supplied findings or resolutions.
- Prove a board request cannot create provider or human approval state unless an existing checked application path records the correct approval subject and revision.
- Cover blocked and failed review commands so authoritative lifecycle and review state remains truthful and the failure is surfaced.
- Keep existing CLI review behavior and review-history projection unchanged.

## Out of Scope

- Enabling a board kind merely because its name resembles a CLI flag.
- Any generated `.dc.html` path that approves by mutating authoritative state.
- Browser support for arbitrary CLI flags, review text, shell strings, file paths, option bags, findings, or resolutions.
- Creating a new approval workflow, changing provider/human approval policy, or auto-approving a review.
- Replacing the established CLI review flow or redesigning review-history projection.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: Tests characterize the exact existing application/CLI behavior considered for `review:submit`, `review:act-on-findings`, and `approve:review` before controller-dispatch changes are made.
- SC2: Every enabled board review kind accepts only its typed command input and invokes exactly one existing trusted application operation; its browser-facing request accepts no CLI flags, review text, shell strings, file paths, arbitrary option bags, findings, or resolutions.
- SC3: For every enabled start-or-continue review command, tests verify the existing current-work phase rules, reviewer-family constraints, and reviewed-revision identity are retained.
- SC4: If `review:act-on-findings` is enabled, tests verify it consumes persisted review artifacts/domain state and rejects browser-synthesized findings and resolutions; if no such operation is proven, the kind remains unavailable.
- SC5: A negative board-path test proves `approve:review` cannot fabricate provider or human approval; the kind is enabled only if a checked application path records the correct approval subject and reviewed revision while enforcing the existing approval boundary.
- SC6: A blocked or failed enabled board command leaves authoritative lifecycle/review state unchanged except for the existing truthful failure result, and the command response surfaces that failure.
- SC7: Existing CLI review operation tests and review-history projection tests retain their current behavior, and `./scripts/verify-local.sh all` succeeds.

## Risks and Assumptions

- Risk: CLI flags may select superficially similar operations with different side effects. Mitigation: characterize application behavior and map only a proven one-to-one operation.
- Risk: board display state can be mistaken for authoritative review state. Mitigation: use dedicated domain/projection fields and existing review artifacts rather than lane or display flags.
- Risk: approval records bind a specific provider/human subject and reviewed revision. Mitigation: leave `approve:review` unavailable unless the existing checked path preserves both values.
- Assumption: the review application layer already exposes enough checked operations to support at least the safe subset; unsupported kinds may remain unavailable.
- Assumption: existing CLI and review-history tests establish the compatibility baseline for this mission.

## Checkpoints

- CP 1: Add characterization tests under `test/` for the current application and CLI semantics considered by `review:submit`, `review:act-on-findings`, and `approve:review`. Record the operation selected, its required domain state, side effects, failure result, and whether it is safe to expose; do not alter board dispatch before this evidence exists.
- CP 2: Implement typed board dispatch for each kind proven safe in CP 1, with no browser escape hatch for CLI flags, review content, paths, shell strings, option bags, findings, or resolutions. Keep every unproven kind unavailable and name any misleading board kind only after the tests establish the replacement meaning.
- CP 3: Add lifecycle and failure tests covering current-work phase, reviewer-family, reviewed-revision identity, persisted-artifact-only findings handling, and truthful blocked/failed results for each enabled kind.
- CP 4: Add the negative approval-path test. Enable `approve:review` only if it reaches an existing checked operation that records the correct approval subject/revision and enforces provider/human approval; otherwise document it as intentionally unavailable. Run the verification gate.

### Checkpoint Documentation Requirements

Every checkpoint document (`CP-N.md`) MUST include a summary of work done, then the exact heading `## Goal Check` and this exact 3-column table header:

| Criterion | Evidence | Status |
|---|---|---|

Use at least one durable evidence reference for every success criterion: exact test names, ADR references, test file paths under `test/`, or recognized repository commands/paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. For this mission, cite the characterization test name/path for SC1; board-dispatch and negative approval test names/paths for SC2–SC6; and the relevant existing CLI/history test names plus `./scripts/verify-local.sh all` for SC7. File:line references are accepted when necessary but discouraged because line numbers rot.

Raw `stat`/`ls` output or generic prose alone is not enough: pair any shell output with one of the accepted references above. End each checkpoint with a non-generic `Next action:` line that identifies the next review kind, invariant, or gate to address.

## Gates

- [ ] ./scripts/verify-local.sh all

## Restricted Areas

- Provider and human approval records and their subject/revision binding: do not write them from board or generated UI state.
- Generated `.dc.html` board presentation: it may request a typed command but must not become a reviewer-artifact store or mutate approval state directly.
- Existing CLI review interface and review-history projection: retain their behavior while adding board dispatch.
- Browser command payloads: do not admit free-form review text, findings, resolutions, flags, command strings, paths, or arbitrary options.

## Stop Rules

- Stop enabling a board kind when tests cannot prove one existing checked application operation with the same semantics; leave that kind unavailable.
- Do not enable `approve:review` without a checked path that records the correct approval subject and reviewed revision and enforces the provider/human boundary.
- Do not infer review round, blocking state, reviewer identity, or approval from board lane/display state when dedicated domain or projection state exists.
- If a failure path would require the browser to create review artifacts or alter authoritative state to continue, stop and retain the existing application flow.
- Do not broaden the initial board command API beyond the typed safe subset established by characterization tests.
