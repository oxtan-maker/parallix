# Mission: TS migration phase T3: npm package flips to dist/ layout (task-2226)

## Goal
Make the published npm tarball execute Parallix from built CommonJS files in `dist/`, with source maps and only the runtime assets permitted by ADR 0044, while retaining the existing sibling-`.js` source-checkout development and test runtime for this phase.

## Why Now
TASK-2225 supplies the TypeScript migration prerequisite. ADR 0044 assigns this T3 step to the package boundary: consumers must receive a self-contained built artifact before later phases move repository-runtime tests to `dist/` and retire the compatibility shim. Delaying the package flip leaves the published artifact inconsistent with the accepted distribution model.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: TASK-2225 must be integrated before activation; ADR 0044 and the existing tarball tests provide the package contract.
- Main drivers: package metadata and `files` allowlist changes; TypeScript emit and source-map configuration; tarball install/smoke coverage; package-test updates; changelog and installation documentation.

## Scope
- Change `package.json` to declare `"type": "commonjs"`, point `main`, `bin.px`, and supported `exports` entries to `dist/`, and encapsulate unsupported `lib/` internals.
- Configure TypeScript to emit JavaScript and source maps into `dist/`; make `prepack` run the production build and enable source-map support at shipped CLI entries.
- Replace the npm `files` allowlist according to ADR 0044 §8: ship built JavaScript, maps, required runtime assets, package metadata, license, README, and changelog; exclude `.ts` sources, tests, development configuration, missions, and operator state.
- Add or update tarball-level coverage that packs, installs to a temporary prefix, proves installed `px --version` executes `dist/px.js`, and runs named representative read-only commands outside the checkout.
- Update successors of `test/task-1424-post-integrate-publish-reinstall.test.js` and `test/package-persistent-data.test.js` for the dist-layout artifact.
- Record the required MINOR release entry in `CHANGELOG.md` and update installation steps in `docs/authority-reference.md`.

## Out of Scope
- Removing `build:cjs`, sibling `.js` source-checkout runtime support, or freshness guards (T5 / TASK-2228).
- Moving repository-runtime tests or verification scripts to execute from `dist/` (T4 / TASK-2227).
- Adding declaration-file publication, converting tests to TypeScript, changing public CLI command behavior, or changing target-repository path resolution.
- Broadening public exports beyond the deliberately supported package entry points to preserve incidental internal imports.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `package.json` declares CommonJS and resolves `main` to `dist/index.js`, `bin.px` to `dist/px.js`, and every supported `exports` target to `dist/`; imports of unexported `lib/` internals are rejected by package encapsulation.
- The TypeScript build emits executable JavaScript and `.map` files under `dist/`, `prepack` invokes the production build, and every shipped CLI entry enables Node source-map support.
- `npm pack --dry-run` contains built `dist/` JavaScript and source maps plus the ADR 0044 §8 runtime assets and excludes TypeScript files, `test/`, development-only configuration, `missions/`, and operator-state paths.
- A tarball installed into a temporary prefix runs `px --version` from `dist/px.js` and the mission's explicitly named representative read-only commands succeed from a directory outside the source checkout.
- The dist-layout successors of `test/task-1424-post-integrate-publish-reinstall.test.js` and `test/package-persistent-data.test.js` pass without relying on sibling source `.js` files in the tarball.
- `CHANGELOG.md` contains a MINOR entry for the dist-layout package change and `docs/authority-reference.md` installation instructions describe the published artifact accurately.
- Source-checkout development and test commands continue to use the compatibility sibling-`.js` layout; this mission does not move that runtime to `dist/` or remove `build:cjs`.

## Risks and Assumptions
- Assumes TASK-2225 is integrated and its TypeScript build is available before implementation begins.
- Existing consumers may import a `lib/` internal path that `exports` would block; inventory any discovered consumer and stop for a compatibility decision rather than exporting all internals.
- A runtime-owned asset may not be obvious from package metadata; prove its need against ADR 0044 §8 before including it rather than broadening the allowlist.
- Tarball smoke tests must not pass merely because they execute from the source checkout or leak source files into the package.

## Checkpoints
- CP 1: Inventory current package metadata, TypeScript emit settings, package scripts, source-map entry points, and `npm pack --dry-run` contents. Translate ADR 0044 §8 into a concrete expected include/exclude list and identify the exact read-only commands for tarball smoke coverage.
- CP 2: Apply the package metadata, compiler-output, prepack, source-map, and allowlist changes. Add tarball-content assertions for the required included and excluded paths, while preserving the source-checkout compatibility runtime.
- CP 3: Update the named publish/reinstall and persistent-data package tests. Pack and install the artifact into a temporary prefix; demonstrate the installed executable resolves to `dist/px.js` and run the selected read-only commands outside the checkout.
- CP 4: Add the MINOR changelog entry and authority-reference installation update. Run the required gate and produce final criterion-level evidence, including proof that T4/T5 work was not pulled forward.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.js` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.js` ``, `` `node dist/px.js --version` ``, `` `git diff --check` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough; it may appear as supplemental context only when paired with an accepted reference above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.js`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify the source-checkout compatibility contract (`build:cjs`, sibling `.js` runtime, or freshness guards) beyond changes strictly required to keep it operational with the T3 package flip.
- Do not move test or verification execution to `dist/`; reserve that runtime transition for TASK-2227.
- Do not publish, push a mission branch to `origin`, start review, or run execute/integrate workflow commands.
- Do not expose arbitrary `lib/` internals through `exports` without an explicit compatibility decision.

## Stop Rules
- Stop and request a compatibility decision if a discovered supported consumer requires an internal `lib/` import that the proposed `exports` map would block.
- Stop if tarball success requires shipping TypeScript, tests, development configuration, mission records, or operator state.
- Stop if preserving source-checkout behavior requires removing the T3 compatibility shim or advancing T4/T5 scope.
- Stop if a required runtime asset is absent from ADR 0044 §8; document the asset and its runtime path before changing the inclusion decision.
