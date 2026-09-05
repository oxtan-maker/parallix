# Mission: Design-fidelity audit of the web board against the reference design (task-2437.01)

## Goal
Compare the complete web board slice with the GPU screen in the approved Kanban Board Controller export, correct every observed mismatch that belongs to that slice, and retain the live repository identity as the one approved divergence from that screen.

## Why Now
TASK-2437 deferred CP-8 because `/tmp/Parallix Kanban Board Controller.zip` was unavailable. Its reference screen is `Parallix Board GPU.dc.html`; the archive also contains other designs that are not the comparison baseline. The known repository-label divergence is intentional; the remaining work requires that export so that implementation is evidence-led rather than guessed.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: Medium
- Selection note: activate when the approved reference export is available locally
- Main drivers: complete-surface visual comparison, targeted web-board corrections, and regression coverage for discovered mismatches

## Scope
- Obtain and use `/tmp/Parallix Kanban Board Controller.zip`, specifically its `Parallix Board GPU.dc.html` screen, or an explicitly approved equivalent export, as the comparison baseline.
- Inspect every rendered web-board surface under `web/src/` against that baseline for absent, extra, incorrectly ordered, incorrectly labelled, or incorrectly styled elements.
- Implement only the web-board changes required to match confirmed reference elements and add focused regression coverage for each corrected behaviour that can be exercised in tests.
- Retain the top bar's live projected repository identity as an intentional divergence: the reference does not show a repository name, while the board must show it (for example, `Parallix` for that live repository) separately from the product name.

## Out of Scope
- Redesigning the board, introducing visual features absent from the approved reference, or changing non-web clients and workflow infrastructure.
- Guessing requirements from the task text when the reference export is missing, incomplete, or contradictory.
- Replacing the live repository identity with a hard-coded repository name.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The approved reference export is present and identified in the checkpoint evidence before comparison or implementation begins.
- Every rendered surface in the `web/src/` board slice is compared against the approved reference; each confirmed mismatch is either corrected in this mission or recorded as a separately scoped follow-up with the reference evidence that establishes it.
- The resulting board contains every confirmed reference element in its required label, order, and visual treatment, and contains no confirmed extra element.
- The top bar renders `Parallix` exactly once as the product name and the live projected repository identity as a distinct value. The repository value is an approved divergence from `Parallix Board GPU.dc.html`, which has no repository name.
- Focused automated coverage exists for each corrected testable mismatch, and the required repository gate completes successfully.

## Risks and Assumptions
- The reference zip may remain absent, may not be approved, or may not contain `Parallix Board GPU.dc.html`; stop rather than infer requirements from memory or the deferred task.
- A visual discrepancy can stem from shared layout or projection data outside the board slice; changes must be limited to the smallest confirmed owner and must not alter unrelated clients.
- Screenshot-only differences can be environment-dependent; compare the same viewport and state represented by the approved export before classifying a mismatch.

## Checkpoints
- CP 1: Record the approved reference export identity, enumerate the board surfaces and states it represents, and produce a mismatch inventory with reference evidence. Stop if the export is unavailable or cannot establish a comparison state.
- CP 2: Correct the confirmed web-board mismatches using the smallest changes at their shared owner, with focused regression coverage for each testable correction.
- CP 3: Recompare all audited surfaces against the reference, verify the product-name/repository-identity distinction, run the required gate, and document criterion-by-criterion evidence.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a summary of work done and lead its evidence with durable references Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted when needed but discouraged because line numbers rot.

Use the exact heading `## Goal Check` followed by this exact 3-column table:

| Criterion | Evidence | Status |
|---|---|---|

Include at least one evidence row for every success criterion. Raw `stat`/`ls` output or generic prose alone is not enough: when used as supplemental context, pair it with an accepted reference above. End each checkpoint with a concrete `Next action:` line.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Approved reference export established | approved reference export path and `git status --short` | PASS |
| Corrected testable mismatch remains covered | test file path and exact test name | PASS |
| Required verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify non-web clients, mission workflow code, or backlog ownership fields.
- Do not treat an unapproved, partial, or absent reference artifact as a design specification.
- Do not add a second product-name label to the top bar or hard-code the repository identity.

## Stop Rules
- Stop before implementation if the approved reference export is unavailable, unreadable, or does not contain `Parallix Board GPU.dc.html`; report the missing evidence and preserve the deferred follow-up.
- Stop and request a scoped follow-up when a confirmed mismatch requires redesign, a non-web client change, or a behavior outside the web-board slice.
- Stop and resolve the discrepancy with the reference owner when reference states conflict; do not choose a version by preference.
