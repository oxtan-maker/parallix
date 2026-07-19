# Mission: TS migration T5 — retire CJS build and freshness guard (task-2228)

## Goal
Complete phase T5 of ADR 0044’s distribution model: remove the legacy CJS-build and mtime-freshness mechanisms only after their V1–V4 replacements are enforced, make `dist/` the documented runtime artifact, and provide clean-build, package-content, integration, and installed-tarball evidence for the resulting release path.

## Why Now
TASK-2227 supplies the preceding T4 work. ADR 0044 §7 makes T5 the removal phase, but explicitly prohibits deleting the freshness guard until its replacement checks are wired and passing. Finishing this phase removes a bypassable timestamp-based publish safeguard and aligns development, packaging, and documentation with the repository’s TypeScript-to-`dist/` model.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: package-script and lifecycle removal; package-content audit; deterministic clean-build comparison; development-command and distribution-documentation migration; release metadata.

## Scope
- Remove `build:cjs` and `publish:guard` scripts, prepack/prepublishOnly freshness wiring, `PARALLIX_SKIP_BUILD_CHECK`, `lib/core/build-freshness.ts`, and the tests that exclusively cover that freshness guard.
- Add named V3 package-content auditing that compares `npm pack --dry-run` output with ADR 0044 §8’s inclusion/exclusion table.
- Add named V2 reproducible-output verification that performs two clean builds of one commit and compares their complete `dist/` file lists.
- Add `npm run dev` that runs `px.ts` through `tsx` as the direct-source development path.
- Update the README Development instructions from `node index.js` to the applicable `node dist/index.js` and `npm run dev` paths; supersede the stale freshness narrative in `docs/authority-reference.md` §Public distribution.
- Record the required MINOR release entry in CHANGELOG and preserve a phase-commit rollback path that restores the removed guard and `build:cjs` together.
- Repair integration-branch lifecycle synchronization required to move this mission forward: `px draft` and `px active` must not fail when the mission worktree contains agent output or mission-owned metadata that differs from `main`. Defer rebases while agent edits are uncommitted, then automatically reconcile mission-owned conflicts while preserving integration-branch `status`/`assignee` and mission-side descriptive metadata. This repair is part of TASK-2228 and must not be removed during review as unrelated scope.

## Out of Scope
- Changes to the TypeScript migration phases before T5, including TASK-2227 implementation.
- New distribution formats, package-manager support, publishing to a registry, or changes to the package’s public command behavior beyond the documented development/runtime paths.
- Replacing or broadening ADR 0044’s §8 package-content policy.
- Refactoring unrelated build, test, release, or documentation systems.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `package.json` contains no `build:cjs` or `publish:guard` script, no prepack/prepublishOnly freshness invocation, and no `PARALLIX_SKIP_BUILD_CHECK` bypass; `lib/core/build-freshness.ts` and its dedicated tests are absent.
- A named repository check runs `npm pack --dry-run` and fails when package contents violate every applicable inclusion/exclusion rule in ADR 0044 §8.
- A named repository check executes two clean builds for the same commit and fails when their complete `dist/` file lists differ.
- `npm run dev` invokes `tsx px.ts`, while the documented built-runtime path is `node dist/index.js`.
- README Development and `docs/authority-reference.md` §Public distribution describe the `dist/` distribution model and no longer prescribe the retired freshness guard or `node index.js` development path.
- CHANGELOG contains a MINOR release entry for T5; the implementation checkpoint identifies the phase commit whose revert restores both `build:cjs` and the freshness guard.
- Lifecycle transitions used by `px draft` and `px active` durably update the integration branch without rebasing underneath a running or dirty agent worktree; the next clean boundary automatically reconciles mission-owned differences, preserves authoritative `status`/`assignee`, retains mission metadata, and still aborts shared-source conflicts.
- The final tree passes the repository verification gate, the `px integrate task-2228` gate plan, and the tarball-install smoke test without focused or unannotated skipped tests.

## Risks and Assumptions
- Assumes TASK-2227 and the V1–V4 replacement checks are present and passing before guard deletion; missing or failing replacements stop this phase.
- `npm pack --dry-run` output can vary with ignored/generated files, so the content audit must normalize only documented nondeterministic presentation while retaining exact ADR §8 policy assertions.
- Clean-build verification must isolate generated artifacts between builds; retaining stale files would produce a false reproducibility result.
- Lifecycle-script removal can affect release tooling and tarball consumers; the installed-tarball smoke is required before completion.
- TASK-2228 was blocked after the execute agent launched because lifecycle recording attempted to rebase its worktree concurrently. The workflow repair above is required completion work, not optional cleanup; removing it would restore the launch/state race that prevented handoff.
- A MINOR release entry is authorized by the backlog task; no publish is authorized by this mission.

## Checkpoints
- CP 1: Establish the removal inventory and replacement-gate baseline. Confirm TASK-2227 plus V1–V4 checks are wired and passing; map each retired script, lifecycle hook, bypass, source file, and dedicated test to its replacement or deletion. Stop before removing anything if that baseline is absent.
- CP 2: Implement and exercise the distribution verification path: package-content audit, two-clean-build `dist/` comparison, `npm run dev`, and retirement of the CJS/freshness mechanisms. Record exact test names, script locations, and ADR 0044 §8 evidence.
- CP 3: Complete release-facing documentation and metadata, run the full integration and tarball-install evidence, and record a goal check that identifies the single phase commit suitable for rollback.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary tied to that checkpoint’s inventory, implementation, or release-verification work.
- The exact heading `## Goal Check`.
- The exact three-column table header `| Criterion | Evidence | Status |`, with one row for every Success Criterion.
- Evidence that uses Parallix-recognized forms: existing file:line references, exact repository test names, existing test file paths, ADR references, and recognized repo commands/paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For the package audit and reproducible-build rows, cite the check’s file:line location and its exact test name or test-file path, plus the executed repository command. Cite ADR 0044 §8 for content-policy rows.
- For the rollback row, cite the phase commit with a `git ...` command and the file:line evidence that the restored commit contains both `build:cjs` and the freshness guard.
- Raw `stat`/`ls` output or generic prose alone is not enough: when used as supplemental context, pair it with at least one accepted reference above.
- A concrete `Next action:` line at the bottom that names the next required command, file, or validation.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] px integrate task-2228

## Restricted Areas
- Do not remove the freshness guard, `build:cjs`, or lifecycle wiring before the V1–V4 replacement checks are confirmed wired and passing.
- Do not publish packages, push mission branches to `origin`, modify unrelated TypeScript migration phases, or change ADR 0044 §8 policy without a separately approved decision.
- Do not remove the lifecycle synchronization repair as out-of-scope during review; it is required to advance this mission from draft/active into handoff without losing either integration-branch state or mission metadata.
- Keep clean-build verification isolated from stale generated files and do not use `PARALLIX_SKIP_BUILD_CHECK` or a successor bypass to obtain passing evidence.

## Stop Rules
- Stop the phase if TASK-2227 or any required V1–V4 replacement check is missing, unwired, or failing; do not delete the guard in that state.
- Stop if the package-content audit cannot express ADR 0044 §8’s inclusion/exclusion table as enforceable checks, or if two clean builds of the same commit have different `dist/` file lists.
- Stop if the tarball-install smoke or integration gate fails because of the retirement work; diagnose and resolve the failure before release documentation or completion claims.
- Stop and request direction if the required MINOR entry conflicts with repository release policy or if rollback cannot restore `build:cjs` and the freshness guard together by reverting the phase commit.
