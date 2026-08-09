# Mission: Remove all CommonJS traces and make the repository ESM-only (task-2328)

## Goal
Complete the repository-wide ESM cutover by removing every project-authored CommonJS compatibility surface, including the generated `.test-runtime` tree, and replacing legacy writable-export test seams with deterministic native-ESM isolation.

## Why Now
TASK-2279 established the ESM cutover, but production, build, release, verification, and test paths still contain CommonJS-era code and assumptions. Maintaining both models leaves package and executable outputs vulnerable to drift and keeps tests dependent on a generated compatibility runtime.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: activate as-is; the task names the migration boundary, affected compatibility tree, and required verification surfaces.
- Main drivers: removal of `.test-runtime`; conversion of tests that mutate CommonJS exports; cleanup of production, bundle, release, SEA, package-audit, verification, and documentation references; addition of a durable regression guard.

## Scope
- Remove project-authored CommonJS syntax, CommonJS compiler output, `type: commonjs` boundaries, and synthetic CommonJS globals from production code, scripts, tests, configuration, comments, and generated artifacts.
- Delete the `.test-runtime` compatibility tree and remove the build path represented by `scripts/build-test-runtime.ts`.
- Convert tests that rely on writable CommonJS exports to explicit dependency injection or another ESM-native seam, retaining the behavioral coverage while preventing real-agent launches and Forgejo access.
- Remove transitional branches, rollback shims, compatibility exports, and task-era CommonJS assumptions from the canonical bundle, npm package, native executable/SEA, release tooling, default tests, integration tests, static analysis, and package-audit paths.
- Add a repository guard that fails on reintroduced CommonJS syntax, configuration, generated output, or references to `.test-runtime`.
- Update active developer and architecture documentation to describe the ESM-only module and test strategy.

## Out of Scope
- Changing externally observable product behavior unrelated to module loading or test isolation.
- Introducing a new module system, transpiler, bundler, package manager, or test framework.
- Retaining a temporary CommonJS fallback, compatibility runtime, rollback branch, or dual-module distribution after the migration.
- Changes to external Forgejo services, real-agent infrastructure, or published release artifacts outside the repository verification and build paths.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- SC1: No project-authored production, test, script, configuration, comment, or generated-artifact file contains CommonJS module syntax, CommonJS compiler output, a `type: commonjs` boundary, or synthetic CommonJS globals.
- SC2: `scripts/build-test-runtime.ts`, the generated `.test-runtime` CommonJS tree, and every repository reference or build invocation that creates or consumes that tree are removed.
- SC3: Every test formerly dependent on writable CommonJS exports uses an explicit ESM-native isolation seam, preserves its pre-existing asserted behavior, and cannot launch real agents or access Forgejo.
- SC4: The canonical bundle, npm-package, native-executable/SEA, release, verification, package-audit, default-test, integration-test, and static-analysis paths contain no CommonJS compatibility branch, shim, export, global, or stale migration assumption.
- SC5: A repository guard has focused coverage demonstrating failure for reintroduced CommonJS syntax, CommonJS configuration or output, and `.test-runtime` references, while accepting the compliant ESM-only tree.
- SC6: Active developer and architecture documentation describes an ESM-only repository and ESM-native test seams, with no active CommonJS migration or compatibility guidance.
- SC7: `./scripts/verify-local.sh all` completes successfully on the final tree, with checkpoint evidence that identifies the relevant files and tests.
- SC8: The ports-and-adapters layout certified by TASK-2332.06 survives the migration: the final tree contains no file under `src/platform/`, no project-authored source, test, script, or configuration file names a `src/platform/` specifier, every ESM test-seam target and rewritten import resolves to a module under one of the six canonical layer roots declared at `src/adapters/architecture/boundary-guards.ts:8` (`src/domain`, `src/application`, `src/adapters`, `src/interfaces`, `src/composition`, `src/entry`), and `test/dependency-graph.test.ts` passes with a repository-level assertion that `findPlatformPaths(process.cwd())` (`src/adapters/architecture/boundary-guards.ts:51`) returns an empty array.

## Risks and Assumptions
- Risk: Tests may currently mutate imported exports indirectly; conversion must preserve their intended observations without an ESM-incompatible mock mechanism.
- Risk: Generated bundle, SEA, and package-audit paths can retain text or output metadata after source conversion; the guard and end-to-end repository scans must cover these paths.
- Risk: Broad replacement could alter test execution or accidentally invoke expensive real dependencies. Assumption: test seams can be injected or mocked entirely in-process.
- Risk: The ESM seam rewrite was authored against the pre-TASK-2332.06 tree, where production modules lived under `src/platform/runtime/lib/**`. Mock targets, rewritten imports, and rebase conflict resolutions can silently resurrect those retired module homes and regress TASK-2332.06 AC #1. CP 4's conformance scan and `test/dependency-graph.test.ts` must run on the final tree, not on an intermediate one.
- Assumption: TASK-2279 is the authoritative baseline for the prior ESM cutover; this mission removes residual compatibility surfaces rather than reopening its completed design decisions.
- Assumption: Existing verification commands provide the canonical checks for default tests, integration coverage, static analysis, bundles, packages, and executable outputs.

## Checkpoints
- CP 1: Inventory all CommonJS and `.test-runtime` occurrences across production, scripts, tests, configuration, generated artifacts, and documentation; identify each writable-export test dependency and choose its ESM-native seam.
- CP 2: Remove the `.test-runtime` generator and consumers; migrate affected tests to deterministic injected dependencies or equivalent ESM-native seams, adding focused tests for retained behavior and isolation.
- CP 3: Remove remaining compatibility code and stale assumptions from build, canonical-bundle, release, SEA/native-executable, verification, package-audit, and documentation paths; add the CommonJS reintroduction guard and focused coverage.
- CP 4: Certify that the ESM migration preserves the TASK-2332.06 ports-and-adapters layout. Relocate every module the migration reintroduced under `src/platform/` to its owning layer root; re-point every module-mock target, `importFresh` specifier, and rewritten test import from a retired `src/platform/runtime/lib/**` or `.test-runtime/lib/**` path onto the canonical layer roots at `src/adapters/architecture/boundary-guards.ts:8`; and extend `test/dependency-graph.test.ts` with a repository-level assertion that `findPlatformPaths(process.cwd())` returns an empty array, so an empty or asset-only `src/platform/` directory cannot pass.
- CP 5: Run the repository verification gate, resolve migration regressions, and record final goal-check evidence for every success criterion.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done.
- The exact heading `## Goal Check`.
- A 3-column pipe-delimited Markdown table with this exact header: `| Criterion | Evidence | Status |`.
- At least one evidence row for every success criterion, using verifiable Parallix evidence forms: existing file:line references; exact repository test names; ADR references; test file paths; and recognized repository commands or paths such as backticked `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`.
- For this mission, cite removed/replaced CommonJS surfaces, each test seam and its exact test name, the guard test path and test name, and the final `./scripts/verify-local.sh all` invocation with accepted evidence references.
- For SC8, cite the canonical layer root each relocated module and re-pointed seam target now resolves to, and the exact `test/dependency-graph.test.ts` test name proving no `src/platform/` path survives on the final tree.
- Raw `stat`/`ls` output or generic prose alone is not enough. Shell output may be supplemental only when paired with a file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above.
- A concrete `Next action:` line at the bottom that names the next migration surface or verification command.

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not introduce or retain CommonJS fallbacks, dual-module package outputs, writable-import workarounds, or synthetic globals to make migration tests pass.
- Test changes must be fully mocked or injected: they must not access real Forgejo, start real agents, or invoke performance-heavy CLI workflows.
- Keep the work confined to the ESM migration and its directly required test, build, verification, guard, and documentation updates; do not redesign unrelated product behavior.
- Do not create, restore, or import any file under `src/platform/`, and do not re-point a seam or import at a retired module home to make an ESM conversion resolve. Move the module to its owning layer root instead.
- Preserve the mission-branch policy: do not push this branch to `origin`.

## Stop Rules
- Stop and seek direction if a required consumer cannot run as ESM without a public API, package-format, or release-contract change not named in this mission.
- Stop and seek direction if preserving an affected test requires real Forgejo access, a real agent launch, or an unmocked expensive CLI command.
- Stop and seek direction if removal exposes a dependency on a generated artifact or external release process whose owner and replacement are not identifiable in the repository.
- Stop and seek direction if the required gate fails for an unrelated pre-existing failure that cannot be isolated from the migration changes.
- Stop and seek direction if an ESM conversion cannot resolve without placing a module outside the six canonical layer roots, or if the correct owning layer for a module the migration must relocate is not identifiable from TASK-2332.06's ownership table.
