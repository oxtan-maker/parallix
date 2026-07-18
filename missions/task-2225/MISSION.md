# Mission: Harden package-root asset resolution (task-2225)

## Goal
Make package-owned assets resolve from the installed Parallix package root rather than from depth-coupled paths or the caller's current working directory, and make integration gates immune to inherited Bash startup hooks, so verification and the current source layout continue to work before the T3 `dist/` flip.

## Why Now
ADR 0044 phase T2 must remove layout assumptions before phase T3 changes the runtime distribution layout. Leaving depth-coupled resolution in place risks commands failing when invoked outside the checkout or after source files move into `dist/`. The pre-review gate failure also showed that an inherited `BASH_ENV` can execute outside-project shell code before the verifier or an integration gate starts.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: a shared `packageRoot()` resolver; migration of every package-owned asset lookup; temporary-directory coverage that proves resolution is independent of the checkout CWD

## Scope
- Add one `packageRoot()` helper under `lib/core/` that starts at the calling module's `__dirname`, walks upward, and identifies the nearest `package.json` whose package name is `@magnusekdahl/parallix`.
- Ensure the helper does not read or depend on `process.cwd()`.
- Inventory and migrate every depth-coupled package-owned lookup for `prompts/`, `templates/`, `config/`, `data/`, `docs/`, `examples/`, and executable scripts to resolve from `packageRoot()`.
- Add focused automated coverage that runs the relevant asset-resolution paths while the process CWD is a temporary directory outside the checkout.
- Preserve the current source-layout behavior of the migrated commands and scripts until phase T3 changes the distribution layout.
- Ensure `scripts/verify-local.sh` clears inherited `BASH_ENV` before Bash starts and does not pass `BASH_ENV` to `bash -c` integration gates; cover the behavior with the existing integration-verifier test.

## Out of Scope
- Changing the T3 `dist/` distribution layout or packaging strategy.
- Moving, renaming, or changing the contents of prompts, templates, configuration, data, documentation, examples, or scripts.
- Replacing non-package-owned user input paths with package-root resolution.
- Broad conversion of additional JavaScript files to TypeScript beyond the helper and call-site changes required for phase T2.
- Changing workflow semantics, command interfaces, or asset contents, except for preventing inherited `BASH_ENV` hooks from executing in the local verification runner and its integration gates.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A single `lib/core/` `packageRoot()` helper walks upward from a module `__dirname`, returns the nearest directory whose `package.json` names `@magnusekdahl/parallix`, and does not consult `process.cwd()`.
- All package-owned lookups for `prompts/`, `templates/`, `config/`, `data/`, `docs/`, `examples/`, and executable scripts use paths derived from `packageRoot()`; no migrated lookup retains a fixed count of `..` segments to reach the package root.
- A test changes the process CWD to a temporary directory outside the checkout and proves each migrated resolution path still finds its intended package asset.
- Existing behavior in the current source layout is retained for every migrated command or script: its resolved asset remains the same package-owned asset as before the refactor.
- `./scripts/verify-local.sh integrate` neither runs an inherited `BASH_ENV` file while the verifier starts nor exposes that variable to a `bash -c` integration gate; `test/verify-local-integrate.test.js` proves this by using a hook that would create a sentinel file.
- `npm test`, `node test/e2e-mission-lifecycle.test.js`, `./scripts/verify-local.sh all`, and `./scripts/verify-local.sh static-analysis` complete successfully on the final mission tree.
- The phase remains revertible as one focused commit sequence: reverting its changes restores the prior asset-lookup expressions without requiring asset-content or distribution-layout changes.

## Risks and Assumptions
- Assumption: the package root can be identified unambiguously by the nearest ancestor `package.json` with name `@magnusekdahl/parallix` in both the source tree and the future built layout.
- Risk: package-owned asset resolution is duplicated in command and script code outside the initially identified example; mitigate with a category-by-category repository inventory before edits.
- Risk: a test may exercise a helper directly while missing a real call site; mitigate by testing the command or script resolution path after changing CWD.
- Risk: symlinked or installed-package paths may differ from the checkout; keep the resolver anchored to module `__dirname` and avoid CWD-derived fallback behavior.
- Risk: shell startup configuration may affect a verifier before its normal argument handling starts; use a POSIX-sh bootstrap that removes `BASH_ENV` before re-execing Bash, and remove it again from each gate environment.

## Checkpoints
- CP 1: Inventory every package-owned lookup in the seven required asset categories, identify each depth-coupled root traversal and its owning command or script, and add focused tests that execute representative migrated resolution paths from a temporary non-checkout CWD.
- CP 2: Add `packageRoot()` in `lib/core/`, migrate the complete inventory to it, and verify that current-layout asset targets remain unchanged for each migrated call site.
- CP 3: Run the required focused, end-to-end, general, and static-analysis gates; record criterion-level evidence and confirm the diff contains no T3 layout change or asset-content change.
- CP 4: Restore the previously reverted verifier-isolation fix, extend the mission scope to include it, and verify inherited `BASH_ENV` hooks cannot affect verifier startup or integration gates.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion. Accepted evidence forms are file:line references, exact test names, ADR references, test file paths, and recognized repository commands or paths such as backticked `npm test`, `node test/e2e-mission-lifecycle.test.js`, `git diff --check`, `px checkpoint`, or `./scripts/verify-local.sh all`.
- For this mission, cite the `packageRoot()` implementation location, each migrated lookup location or a documented inventory, and the temporary-CWD test file plus its exact test name.
- Raw `stat`/`ls` output or generic prose alone is not enough; when shell output is useful, pair it with an accepted reference above.
- A concrete `Next action:` line at the bottom that names the next file, test, command, or review action.

## Gates
- [ ] npm test
- [ ] node test/e2e-mission-lifecycle.test.js
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh static-analysis

## Restricted Areas
- Do not edit package asset contents, relocate package assets, or implement the T3 `dist/` flip.
- Do not introduce `process.cwd()`-dependent fallback behavior for package-owned assets.
- Do not alter user-supplied filesystem-path handling merely because it appears near a migrated package-asset lookup.
- Do not modify mission workflow, backlog ownership, or unrelated TypeScript migration phases.
- Do not make shell-environment changes beyond the `BASH_ENV` isolation explicitly included in this mission.

## Stop Rules
- Stop and request direction if no unique ancestor `package.json` named `@magnusekdahl/parallix` is available from a required runtime module path.
- Stop and request direction if a required lookup targets a user workspace, repository checkout, or externally supplied path rather than a package-owned asset.
- Stop and request direction if preserving an existing command's asset target conflicts with resolving from the package root.
- Stop and request direction if making the temporary-CWD test pass requires a distribution-layout change, package-asset move, or T3 work.
