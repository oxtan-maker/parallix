# Mission: Reposition the README and npm description around the trust ladder (task-2486)

## Goal
Make the README and npm package description lead with Parallix's verified trust ladder, while preserving every existing condition on review, verification, sandboxing, Forgejo, and the internal measurement claim.

## Why Now
Isolation is now a commodity in the developer-agent category, so the current parallel-isolation lead compares Parallix on its weakest axis. Tasks TASK-2484 and TASK-2485 supply the npm-image and single-family-review evidence needed to make the new lead accurate without overstating default-path guarantees.

## Refinement Signals
- Predicted NEL bucket: Small (0–80) / Medium (81–235) / Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: README and package metadata repositioning; claim-and-caveat inventory; optional Forgejo setup framing; lifecycle-diagram adjacency; task dependencies TASK-2484 and TASK-2485

## Scope
- Create a claim inventory for README.md that maps every guarantee claim to its caveat and implementation evidence in the review, Bubblewrap, and setup-review code.
- Rewrite README.md's opening to present the trust ladder before parallel Git isolation, using the inventory to retain or attach each qualifying condition.
- Update package.json's npm description to use the same trust-ladder-first framing.
- Move Forgejo bootstrap from the required setup narrative to an optional-integrations section, and revise `px setup` help text so it does not imply Forgejo is required.
- Keep the ASCII lifecycle diagram accurate and place its qualifying review caveat adjacent to it.
- Retain the internal label and non-external-evidence framing for the self-measurement figure, and validate the result against the README standard and docs verifier.

## Out of Scope
- Changing review-provider eligibility, self-approval enforcement, verification-gate behavior, Bubblewrap behavior, Forgejo defaults, or package publishing behavior.
- Creating a new trust mechanism, changing the visual design system, or rewriting README sections unrelated to the opening, lifecycle, setup framing, and existing measurement caveat.
- Altering the npm tarball contents or resolving the TASK-2484 npm demo-image delivery issue.
- Treating a reviewer-family fallback as a guaranteed distinct reviewer, or presenting Linux-only Bubblewrap confinement as universal.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A committed claim inventory identifies each guarantee claim in README.md, its exact adjacent caveat after the rewrite, and implementation evidence from `src/domain/review.ts`, `src/adapters/process/bubblewrap.ts`, or `src/adapters/review/setup-review.ts` as applicable.
- README.md's opening introduces the trust ladder before any lead claim about parallel Git isolation, and package.json's `description` uses trust-ladder-first wording consistent with that opening.
- The rewritten README preserves these conditions without weakening or separating them from their claims: a different reviewer family is used only when available; Bubblewrap confinement is Linux-only and conditional on availability, with unsandboxed execution warned about; Forgejo is optional; and repository verification applies where a gate is configured.
- Every guarantee claim found inaccurate or uncaveated by the inventory is removed or qualified, and no rewritten README statement contradicts another README statement.
- README.md presents Forgejo bootstrap only in an optional-integrations context, and `px setup` help no longer presents Forgejo bootstrap as part of the required path.
- The ASCII lifecycle diagram remains technically accurate, and its nearby text states the same reviewer-availability condition that qualifies the review rung.
- The self-measurement figure remains explicitly labelled internal and is not presented as external evidence.
- The final README satisfies the task-1350 README standard, `scripts/verify-docs.mjs` succeeds, and `./scripts/verify-local.sh all` succeeds on the implementation tree.

## Risks and Assumptions
- Risk: a concise new lead can detach a caveat from the claim it constrains. Mitigation: author the inventory before prose changes and check each inventory row after the rewrite.
- Risk: TASK-2484's npm image-path decision and TASK-2485's single-family transcript may not be available at implementation start. Assumption: implementer verifies both dependency outcomes before finalizing wording; stop if either changes the factual basis of a claim.
- Risk: README edits can make a condition locally accurate but contradictory elsewhere. Mitigation: perform a whole-file consistency pass, including the lifecycle strip, defence-in-depth text, setup path, and measurement caption.
- Assumption: the existing code remains the authority for review eligibility, process confinement, and Forgejo setup semantics; documentation must follow code rather than introduce a new product promise.

## Checkpoints
- CP 1: Inventory the README guarantee claims, their qualifying language, and the implementation evidence; inspect TASK-2484 and TASK-2485 outcomes before selecting final lead wording.
- CP 2: Rewrite the README opening, lifecycle adjacency, and Forgejo setup framing; update the npm description and `px setup` help text while retaining every inventory condition.
- CP 3: Perform the whole-README contradiction and README-standard review, confirm the internal-measurement label, and run the documentation and general verification gates.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include a work summary followed by the exact heading `## Goal Check` and the exact 3-column table header `| Criterion | Evidence | Status |`.

Lead every evidence row with durable forms Parallix verifies today: exact test names, ADR references, existing test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. For this mission, cite `README.md`, `package.json`, `src/domain/review.ts`, `src/adapters/process/bubblewrap.ts`, `src/adapters/review/setup-review.ts`, `docs/readme-rewrite-benchmark.md`, `./scripts/verify-docs.mjs`, and `./scripts/verify-local.sh all` where they prove a criterion. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.

Include at least one evidence row for every Success Criterion and end with a concrete `Next action:` line. Raw `stat`/`ls` output or generic prose alone is not enough: it may supplement a checkpoint, but must be paired with an accepted reference above.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Claim inventory preserves review and confinement conditions | `README.md`, `src/domain/review.ts`, `src/adapters/process/bubblewrap.ts` | PASS |
| npm description leads with the trust ladder | `package.json` | PASS |
| Verification gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-docs.mjs
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not change runtime review, verification, process sandboxing, Forgejo-provider, package-publishing, or workflow behavior to make documentation claims true.
- Do not remove, weaken, relocate away from its claim, or replace with an unverified promise any documented condition on reviewer availability, Bubblewrap availability and Linux scope, unsandboxed warnings, optional Forgejo, configured verification gates, or internal measurement status.
- Do not modify unrelated README content, assets, npm tarball configuration, or the TASK-2484/TASK-2485 implementations.

## Stop Rules
- Stop and request direction if TASK-2484 or TASK-2485 has not landed and its unresolved outcome determines whether the proposed npm image or reviewer-family wording is true.
- Stop and request direction if implementation evidence contradicts a required trust-ladder claim and the discrepancy cannot be resolved by retaining an accurate caveat or removing the claim.
- Stop and request direction before changing product behavior, defaults, provider configuration, or package publication to support the documentation rewrite.
- Stop and request direction if satisfying the task-1350 README standard requires a broader landing-page redesign beyond the listed scope.
