# Mission: Retire transitional CommonJS and reconcile dependent ADRs (task-2288)

## Goal
Remove the transitional CommonJS `dist/` distribution architecture and its compatibility shims after proving each replacement path is enforced, then align the affected ADRs and authority/release documentation around binary-first distribution with npm as an explicit fallback.

## Why Now
TASK-2284, TASK-2285, and TASK-2287 are the replacement-gate dependencies. Once their source, bundle, distribution, and compatibility paths are proven, retaining the legacy CommonJS emitter and shims leaves two competing distribution models, stale test assumptions, and contradictory operational documentation.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is
- Main drivers: removal spans authored JavaScript, build/package entry points, compatibility exports and tests, release artifacts, mutation/coverage configuration, five ADR/authority documents, and clean-checkout verification.

## Scope
- Inventory every transitional CommonJS mechanism: the `dist/` emitter, package entry, compatibility re-exports, test shims, and asset/package-root assumptions; record the replacement proof before deleting each mechanism.
- Remove authored runtime, test, and build-tool JavaScript, except for explicitly inventoried tool-required configuration files.
- Make the TypeScript source/canonical bundle and binary-first release artifacts authoritative; retain npm only as the documented fallback distribution path.
- Reconcile dated addenda (without rewriting historical ADR decisions) in ADRs 0037, 0042, 0046, and 0049, plus the authority and release documentation that describe the CLI, TUI, web board, task catalog, operator SQLite, repository state, assets, npm, and binary distribution.
- Retarget mutation and coverage configuration to accepted TypeScript source or the canonical bundle and remove stale `dist/` assumptions.
- Establish clean-checkout, deterministic-artifact, post-verification-cleanliness, CLI compatibility, and coherent rollback evidence for the deletion phase.
- Clear up old ADR history no longer relevant, leaving relevant ADR:s forward looking only (git is for checking history)

## Out of Scope
- Implementing or redesigning the replacement gates owned by TASK-2284, TASK-2285, or TASK-2287.
- Adding new supported binary targets, changing release channels, or changing npm publication credentials/security policy beyond documentation reconciliation.
- Feature work for the CLI, Ink TUI, web board, task catalog, SQLite data model, or repository-state model.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: The repository contains no authored runtime, test, or build-tool JavaScript; each remaining tool-required JavaScript configuration exception is listed with its path and tool rationale.
- SC2: The CommonJS `dist/` emitter, package entry, compatibility re-exports, test shims, and obsolete asset/package-root assumptions are removed, and each removal has recorded replacement-gate evidence.
- SC3: The source, canonical bundle, npm fallback, Ink TUI, web board, SQLite/operator path, binary target matrix, and CLI compatibility gates pass before the deletion checkpoint is accepted.
- SC4: ADRs 0037, 0042, 0046, and 0049 contain dated reconciliation updates that preserve their original decision records; the authority documentation consistently describes CLI, TUI, web board, task catalog, operator SQLite, repository state, assets, npm fallback, and binary-first distribution.
- SC5: Mutation and coverage gates target accepted TypeScript source or the canonical bundle and contain no `dist/`-based target or coverage assumption.
- SC6: Release documentation identifies the supported binary targets as primary and npm as fallback, and the release verification produces deterministic artifacts from a clean checkout.
- SC7: A clean checkout contains no generated output before verification and no uncommitted generated output after the required verification plan.
- SC8: The checkpoint record identifies the exact coherent rollback phase that restores all transitional shims together; it does not prescribe partial restoration of individual shims.

## Risks and Assumptions
- Assumption: TASK-2284, TASK-2285, and TASK-2287 have landed and their replacement gates are enforceable before any legacy mechanism is removed.
- Risk: package metadata or a less-visible test/build script may still resolve `dist/`; mitigate by completing the transition inventory and attaching replacement evidence to every deletion group.
- Risk: documentation can describe a mixed authority model after code changes; mitigate by reconciling the enumerated ADRs and all authority/release documents in the same checkpoint sequence.
- Risk: clean-checkout or release generation may create nondeterministic or untracked artifacts; stop release cleanup until the artifact source and cleanup behavior are identified and reproducible.
- Risk: a rollback that restores only one shim can produce an incoherent distribution state; preserve one documented rollback phase covering the emitter, entries, exports, test shims, and assumptions together.

## Checkpoints
- CP 1: Create the transition inventory and dependency-proof record. For each `dist/` emitter, package entry, compatibility re-export, test shim, authored JavaScript file, and asset/package-root assumption, identify its replacement and the exact source, bundle, npm fallback, Ink, web-board, SQLite, binary-matrix, or CLI gate that proves it. Do not delete a mechanism without this record.
- CP 2: Retire the transitional implementation in one coherent change: remove the inventoried CommonJS emitter/entry/shims/assumptions, migrate permitted authored code to TypeScript or canonical-bundle ownership, and update tests, mutation, and coverage targets so no stale `dist/` dependency remains.
- CP 3: Reconcile the dated ADR addenda and authority/release documentation. Preserve ADR 0037, 0042, 0046, and 0049 history; state binary-first distribution, npm fallback, supported binary targets, and the authority boundaries for the CLI, TUI, web board, task catalog, operator SQLite, repository state, and assets consistently.
- CP 4: Execute the clean-checkout/release and compatibility verification plan, capture deterministic-artifact and post-verification-cleanliness evidence, and record the single rollback phase that restores the transitional layer coherently.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited markdown table `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough; it may appear as supplemental context only when paired with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not remove a CommonJS mechanism until CP 1 records its enforced replacement proof and the TASK-2284, TASK-2285, and TASK-2287 dependency status is confirmed.
- Do not rewrite, renumber, or delete ADR history; use dated reconciliation updates for ADRs 0037, 0042, 0046, and 0049.
- Do not alter binary target support, npm publication credentials, security controls, release channels, or unrelated product behavior while retiring the transitional architecture.
- Keep the rollback path coherent: changes to the emitter, package entries, compatibility exports, test shims, and asset/package-root assumptions must be reversible as one phase.

## Stop Rules
- Stop before deletion if any transition mechanism lacks a replacement proof or any dependency gate from TASK-2284, TASK-2285, or TASK-2287 is unavailable or failing.
- Stop and investigate if a package/build/test path still resolves `dist/`, if a permitted JavaScript exception lacks an explicit tool rationale, or if mutation/coverage still targets `dist/`.
- Stop release verification if a clean checkout begins with generated output, produced artifacts differ across equivalent runs, or verification leaves untracked/generated changes; identify the producing command before proceeding.
- Stop documentation completion if the four ADR addenda or authority/release documents disagree about binary-first distribution, npm fallback, supported targets, or authority boundaries.
