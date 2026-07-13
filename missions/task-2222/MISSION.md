# Mission: Standardize Durable State Persistence (task-2222)

## Goal
Establish one explicit persistence contract for a bounded, high-value tranche of durable machine-readable state, migrate the confirmed session-metadata and NEL-record writers to that contract, and enforce failure-safe behavior without changing their paths or on-disk schemas.

## Why Now
The repository already has an atomic persistence primitive in `lib/core/storage.ts`, but durable workflow data is still written through direct filesystem calls and subsystem-specific temporary-file conventions. Once TASK-2220 has established fail-closed review-state behavior, leaving adjacent durable writers inconsistent would preserve crash windows, ambiguous error propagation, permission drift, and duplicated cleanup logic. A classified inventory and bounded migration now prevents another persistence convention from becoming entrenched while keeping this mission reviewable.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: Medium
- Selection note: activate after TASK-2220 is complete; narrow the migrated tranche rather than exceeding the line budget
- Main drivers: repository write-path classification, shared storage-contract changes, migration of two durable-state families, fault-injection coverage, and a prevention guard

## Scope
- Create a code-adjacent, reviewable inventory or test fixture that classifies machine-written paths as durable state, user-authored content, generated output, cache/scratch data, or secrets/configuration, including an explicit classification for session metadata, NEL records, generated mutation configuration, and token-bearing files.
- Define the approved durable-write API in or adjacent to `lib/core/storage.ts`, including atomic replacement, parent-directory creation, UTF-8 encoding, exactly one final newline for serialized JSON, temporary-file cleanup, and propagation of filesystem failures.
- Preserve the existing mode of replaced durable files and retain or strengthen restrictive modes for credentials and operator-local sensitive data; token-file guarantees must remain at least as strict as before.
- Migrate the inventory-confirmed session-metadata and NEL-record durable JSON writers. If either family is not durable, record that classification and substitute no additional writer without documenting the scope decision.
- Ensure migrated callers report write failure to their caller and neither emit a success indication nor advance dependent durable workflow state after persistence fails.
- Add focused fault-injection coverage for write failure, rename failure, stale temporary-file cleanup, successful replacement, and preservation of the prior valid file after failed replacement.
- Add an automated guard that rejects new direct durable JSON writes outside the approved storage module, while allowing only inventory-documented exceptions.
- Keep the implementation tranche within 250–500 added-plus-deleted lines where feasible and document follow-up candidates rather than expanding into a repository-wide rewrite.

## Out of Scope
- Review-state semantics and fixes owned by TASK-2220.
- Changes to persistent file names, locations, JSON schemas, or compatibility with existing files.
- Migration of user-authored Markdown, generated mutation configuration, cache files, scratch artifacts, or other paths classified as non-durable.
- A database, journal service, cross-process locking, or a broad conversion from synchronous to asynchronous filesystem APIs.
- Mechanical replacement of every `writeFileSync` call or migration of durable writer families beyond session metadata and NEL records.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: A code-adjacent inventory or test fixture assigns each examined machine-written path to exactly one of five classes—durable state, user-authored content, generated output, cache/scratch data, or secrets/configuration—and explicitly records session metadata, NEL records, generated mutation configuration, and token-bearing files.
- SC2: One approved durable-write API implements parent creation, UTF-8 serialization, exactly one trailing newline, same-directory temporary-file replacement, cleanup of its temporary file after failure, and propagation of write and rename errors.
- SC3: Replacing an existing durable file preserves its permission mode, and tests demonstrate that token-bearing or operator-local sensitive files retain or strengthen their pre-mission restrictive mode guarantees.
- SC4: Every inventory-confirmed session-metadata and NEL-record durable JSON writer uses the approved API or is named as a documented exception; generated mutation configuration and classified cache/scratch writers do not use it.
- SC5: For each migrated caller, an injected persistence failure is observable by its caller, produces no success indication, and prevents any dependent durable state transition.
- SC6: Focused tests cover all five outcomes: write failure, rename failure, stale temporary-file cleanup, successful replacement, and preservation of the previous valid file when replacement fails.
- SC7: An automated guard fails on a newly introduced direct durable JSON write outside the approved storage module and passes for each explicitly inventoried exception.
- SC8: Compatibility tests or exact fixture comparisons demonstrate unchanged paths and JSON field structure for migrated session metadata and NEL records.
- SC9: The final implementation diff is 250–500 added-plus-deleted lines, or the final Goal Check records why the safe minimum exceeded that range and identifies migrations deferred to named follow-up backlog tasks.
- SC10: `./scripts/verify-local.sh static-analysis`, the focused storage/session/handoff test commands selected during CP2, and `./scripts/verify-local.sh all` pass on the final tree with exact commands and test names captured in checkpoint evidence.

## Risks and Assumptions
- TASK-2220 is a hard dependency: this mission assumes its fail-closed review-state contract is merged and must stop if the two missions would edit or redefine the same review-state behavior.
- The existing atomic primitive may not currently support mode preservation or deterministic fault injection; extending it must not create a second competing durable-write API.
- Classifying a path incorrectly could either over-engineer generated data or leave true durable state crash-prone; ambiguous paths must remain unmigrated until their lifecycle and recovery expectations are documented.
- Atomic rename and permission behavior varies by platform and filesystem; tests should assert repository-supported semantics without claiming cross-filesystem atomicity.
- The 250–500-line target may not fit both writer families plus fault injection and a guard. The migration tranche may shrink, but the shared contract, inventory, and safety tests may not be weakened to meet the target.
- Existing on-disk files are assumed to be valid inputs whose schema and location must remain compatible; no migration utility is authorized.

## Checkpoints
- CP 1 — Inventory and contract boundary: confirm TASK-2220 is complete; enumerate relevant machine-written paths in the code-adjacent inventory; classify session metadata, NEL records, generated mutation configuration, token-bearing files, and each proposed exception; then record the exact durable-write API contract and the bounded writer tranche before changing write mechanics.
- CP 2 — Shared primitive and fault model: implement the single approved contract in or adjacent to `lib/core/storage.ts` with mode handling and injectable failure seams; add focused tests for the five SC6 outcomes plus newline, encoding, parent creation, and sensitive-mode behavior; record the exact focused test commands for the final gate.
- CP 3 — Bounded caller migration and policy guard: migrate only inventory-confirmed session-metadata and NEL-record writers; prove failed writes propagate without success reporting or dependent state advancement; add the direct-write prevention guard and its positive and negative cases.
- CP 4 — Compatibility and final proof: compare paths and serialized structures with pre-mission fixtures, run every gate, measure added-plus-deleted lines, create named follow-up backlog tasks for deferred durable writers when required, and complete the final Goal Check for SC1–SC10.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done and any inventory or scope decisions made at that checkpoint
- A section using the exact heading `## Goal Check`
- A 3-column pipe-delimited markdown table with the exact header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.js` ``, `` `px review task-2222 --verify` ``, or `` `./scripts/verify-local.sh all` ``
- For this mission, cite the inventory entry and durable-write implementation with file:line references; cite exact fault-injection and compatibility test names together with their test file paths; cite any governing ADR; and record recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...` commands.
- Raw `stat`/`ls` output or generic prose alone is not enough. It may appear as supplemental context only when paired with at least one accepted file:line reference, exact test name, test file path, ADR reference, or recognized repo command/path above.
- A non-generic `Next action:` line at the bottom that names the next writer family, test, guard, gate, or stop-rule decision

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [x] `./scripts/verify-local.sh static-analysis`
- [x] `./scripts/verify-local.sh all`

## Restricted Areas
- Do not change review-state behavior owned by TASK-2220.
- Do not change persistent paths, file names, schemas, or add a data migration.
- Do not weaken credential, token-file, or operator-local sensitive-file permissions.
- Do not route user-authored, generated, cached, or scratch files through the durable-state API merely to eliminate direct writes.
- Do not add a database, journaling layer, cross-process lock, or broad asynchronous filesystem conversion.
- Do not migrate durable writer families beyond session metadata and NEL records without stopping for mission re-scope.

## Stop Rules
- Stop before implementation if TASK-2220 is not complete or if its resulting contract makes this mission's scope contradictory.
- Stop and request re-scope if preserving an existing on-disk schema or location is impossible with the proposed shared contract.
- Stop migration of any path whose classification is ambiguous; document the ambiguity and leave that writer unchanged.
- Stop and escalate if the only implementation would weaken token or sensitive-file permissions, swallow filesystem errors, or remove preservation of the prior valid file on replacement failure.
- Stop adding writer migrations when the bounded tranche would exceed 500 added-plus-deleted lines; retain the inventory, shared contract, safety coverage, and guard, and create named follow-up tasks for deferred writers.
- Stop if the prevention guard cannot distinguish durable state from classified generated/cache/scratch writes without a broad allowlist that would make the policy non-enforcing.
- Stop handoff if any required gate fails, any SC1–SC10 row lacks accepted evidence, or checkpoint evidence consists only of generic prose or raw `stat`/`ls` output.
