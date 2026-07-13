# Mission: Add a configurable pre-merge build gate for Parallix self-development (task-1419)

## Goal

Make `px integrate` run `npm run build:cjs` before merge when a Parallix mission changes a TypeScript runtime surface. The build must be a normal, ordered integration-pipeline gate, enabled and scoped by repository configuration so repositories that do not need a TypeScript build do not run it.

## Why Now

The existing lifecycle has build coverage in several places, but not at the right pre-merge decision point:

- `px draft` creates the mission contract and does not need runtime artifacts.
- `px active`, checkpoints, and review normally use the repository verification command; in this repository `./scripts/verify-local.sh all` runs `npm test`, whose `pretest` runs `npm run build:cjs`.
- `npm test` rebuilds before running the complete suite, and the mutation gate rebuilds before mutation testing. The integration-only workflow E2E command is instead invoked directly with `node`; its fixture environment bypasses the build-freshness guard, so it can exercise pre-existing compiled output unless the integration plan explicitly builds first.
- `px integrate` resolves the candidate worktree's changed areas and runs `./scripts/verify-local.sh integrate` before the squash merge. Its current static-analysis gate checks lint, `tsc --noEmit`, and test hygiene, but does not emit the runtime JavaScript.
- After the squash commit, `refreshBuildBeforeVerification()` can rebuild stale artifacts for publication proof. That is too late to replace a failing pre-merge gate: it acts on the base checkout after the candidate has already been merged.

The integration plan therefore needs a separate early build gate for the self-hosted TypeScript runtime surfaces. It must not turn a repository-wide Parallix feature into an unconditional `npm` assumption for consumers with a different build system.

## Refinement Signals

- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: config gate metadata and filtering in `lib/commands/integrate.ts`, repository gate configuration, and focused integration-plan tests.

## Scope

- Extend integration-pipeline gate metadata so a gate can be disabled and can declare the changed areas for which it applies. Preserve current key-based matching as the compatibility default for gates without the new metadata.
- Add the Parallix `build` gate to `config/integration-pipelines.json`, enabled by configuration, ordered at `2` after `lib` static analysis, with `run_last: false`, command `npm run build:cjs`, and applicability limited to the `lib` and `workflow` areas.
- Make both `px integrate`'s plan and `./scripts/verify-local.sh integrate` use the same enabled/scoped gate behavior through the exported integration helpers.
- Add focused tests proving the ordered plan includes `lib`, `build`, and the existing run-last workflow gates for a relevant change; excludes `build` for docs-only changes; and omits an explicitly disabled build gate.
- Run the actual build command as part of final verification to prove the configured command succeeds on the final tree.

## Out of Scope

- Changing `tsconfig.json`, module resolution, emission format, or the runtime loader model.
- Adding a `build` subcommand to `scripts/verify-local.sh`; the integration dispatcher already executes each configured gate command directly.
- Making every Parallix consumer run `npm run build:cjs`; the default applies only where the repository's own pipeline config enables and scopes this gate.
- Replacing the existing post-squash freshness refresh or publication guard.
- Rewriting `.js` import specifiers in TypeScript. They are the expected specifiers for emitted JavaScript under the current NodeNext/CommonJS build; a build gate validates emit/runtime artifacts, not a different source-loader convention.
- Changing the existing `lib`, `mutation`, `workflow`, or `custom-agent-smoke` gate commands or their ordering semantics except where test expectations must acknowledge the inserted build gate.

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various").

- SC1: `config/integration-pipelines.json` declares a `build` gate with command exactly `npm run build:cjs`, `order: 2`, `run_last: false`, an explicit enabled setting, and applicability for exactly `lib` and `workflow`.
- SC2: The gate-plan implementation ignores any gate explicitly disabled by configuration and preserves current behavior for pre-existing entries that omit the new metadata.
- SC3: For changed areas `lib`, the resolved gate plan orders `lib` before `build`, and still places existing `run_last` gates after non-`run_last` gates; for changed areas `workflow`, the enabled build gate is selected; for `docs` only, it is not selected.
- SC4: `./scripts/verify-local.sh integrate` uses the same plan in dry-run mode and prints the build gate only when its configured areas are present.
- SC5: `npm run build:cjs` exits 0 on the final tree, and a configured build-gate command failure causes integration dispatch to exit non-zero before merge.
- SC6: The existing `lib` gate remains order `1`; the mutation gate remains order `40`; and the workflow and custom-agent-smoke gates remain run-last gates at orders `50` and `51`.

## Risks and Assumptions

- Risk: emitting JavaScript mutates generated artifacts or executable bits in the worktree. Mitigation: run the build in the candidate worktree before squash, as other pre-merge gates do; do not confuse its output with a source change to commit.
- Risk: a generic metadata change could silently alter selection of existing gates. Mitigation: absent `enabled` means enabled, and absent area metadata retains the current key-based matching behavior; cover both in focused tests.
- Risk: the gate may run twice for a workflow mission because tests/E2E paths also build. Mitigation: this is intentional defense in depth: the early integration build validates the candidate, while later refreshes protect the merged/published tree.
- Assumption: `npm run build:cjs` is the authoritative command because it produces the shipped CommonJS artifacts and preserves the `px.js` executable setup.
- Assumption: import-specifier correctness for direct execution of `.ts` source is a separate runtime-loader concern. The current `.js` specifiers are required by emitted JavaScript and must not be used as a failure fixture for this mission.

## Checkpoints

- CP 1: Add focused red/green tests in the existing integration-pipeline and verify-local test suites. Cover enabled relevant-area selection and ordering, docs-only exclusion, disabled-gate omission, legacy entries without new metadata, and dry-run dispatch output. Do not change production behavior before these cases describe it.
- CP 2: Implement the minimal gate-metadata parsing/filtering and matching changes in `lib/commands/integrate.ts`, retaining compatibility for existing configuration entries.
- CP 3: Add the repository-local `build` gate configuration and adjust focused test assertions to include it without changing the existing gate contracts.
- CP 4: Exercise the lifecycle boundary: run the focused integration-plan tests, inspect `./scripts/verify-local.sh integrate` in dry-run mode with controlled changed areas, then run the required static-analysis and build gates.
- CP 5: Complete final verification and record whether generated outputs leave expected ignored/untracked state; do not commit generated artifact churn unless the repository intentionally tracks it.

### Checkpoint Documentation Requirements

Every checkpoint document (CP-N.md) MUST include a summary, the exact heading `## Goal Check`, and a 3-column pipe-delimited table with `| Criterion | Evidence | Status |`. Include at least one accepted reference per criterion: a file:line reference, exact test name, existing test-file path, ADR reference, or a recognized backticked repository command/path such as `npm run build:cjs`, `./scripts/verify-local.sh integrate`, or `px integrate`. Raw `stat`/`ls` output and generic prose alone are insufficient; pair them with one of those accepted references. End each checkpoint with a concrete `Next action:` line.

## Gates

- [ ] `./scripts/verify-local.sh static-analysis`
- [ ] `npm run build:cjs`
- [ ] `./scripts/verify-local.sh all`

## Restricted Areas

- `tsconfig.json` and the TypeScript module/runtime configuration: do not modify.
- `package.json` build, pretest, test, pack, and publish scripts: do not modify.
- `lib/core/build-freshness.ts` and post-integrate refresh logic: do not modify; this mission adds pre-merge gating rather than replacing publication safeguards.
- Entry-point and library import specifiers: do not mass-convert `.js` to `.ts` or introduce an ESLint rule for that policy.
- Generated `.js` artifacts: do not commit unrelated regenerated output.

## Stop Rules

- Stop if `npm run build:cjs` fails on the unmodified baseline; report the baseline failure instead of masking it in pipeline logic.
- Stop if adding metadata cannot preserve existing configurations that contain only `command`, `order`, and `run_last`; re-scope before changing production behavior.
- Stop if the only way to scope the gate requires a product-wide build-system abstraction or changes to external consumer repositories; retain this as repository-local integration-pipeline configuration.
- Stop if the proposed test relies on `.js` imports in `.ts` files failing compilation; that premise is false for the current emitted-runtime model, so replace it with a build-command or integration-dispatch failure fixture.
