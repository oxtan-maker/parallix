# Mission: Build native binary platform matrix and release evidence (task-2287)

## Goal
Deliver native-release evidence for the five initial ADR 0044 executable targets—Linux x64, Linux arm64, macOS x64, macOS arm64, and Windows x64—so that a target is documented as supported only after its locally built SEA executable passes the TASK-2286 shipped-artifact smoke suite on that target. Package each passing target with auditable release materials, retain the npm bundle as a fallback, and prove target-scoped withdrawal.

## Why Now
TASK-2286 established a one-platform SEA build and smoke suite. Before the project can claim broader native-binary support, each candidate needs target-local execution evidence and release artifacts; cross-built output without native execution would create unsupported installation claims and weaken release traceability.

## Refinement Signals
- Predicted NEL bucket: Large (235+)
- Confidence: High
- Selection note: The acceptance criteria define a bounded release-evidence workflow, with TASK-2286 providing the prerequisite smoke suite.
- Main drivers: native runner and toolchain setup; per-target build and smoke evidence; archive and supply-chain artifact generation; clean-environment install/uninstall validation; target-scoped rollback documentation.

## Scope
- Establish the ADR 0044 initial matrix: Linux x64, Linux arm64, macOS x64, macOS arm64, and Windows x64. For every target ultimately claimed as supported, record its native runner, OS/architecture, pinned Node 25/26 SEA toolchain, and source commit.
- Build the SEA binary with `node scripts/build-sea.js` and execute `test/task-2286-native-sea-smoke.test.ts` in the same target's native environment; cross-produced artifacts are evidence of neither a build nor support.
- Produce one target-specific installable archive per passing target using the ADR 0044 naming convention, containing only declared release materials.
- Generate and audit per-target checksums, SBOM, license and third-party-notice material, build metadata, and either a signature or explicit unsigned status.
- Add regression evidence for platform-specific signal, path, terminal, SQLite, Git, and shutdown behavior.
- Validate installation and uninstall instructions in clean environments, document only targets with native evidence, retain npm as a supported fallback, and demonstrate withdrawal of one target without withdrawing other proven targets or npm.

## Out of Scope
- Publishing a release, uploading archives, signing with production credentials, or making external support announcements.
- Claiming support for a target based only on a cross-build or a build that lacks native smoke execution.
- Replacing npm distribution, removing npm fallback support, or changing the package-manager installation model.
- Adding executable targets outside Linux x64, Linux arm64, macOS x64, macOS arm64, and Windows x64.
- Broad refactors unrelated to native-binary build, verification, packaging, release evidence, installation, or target-scoped rollback.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- Every support claim is one of Linux x64, Linux arm64, macOS x64, macOS arm64, or Windows x64, and its evidence identifies the native runner, operating system/architecture, pinned Node 25/26 runtime, source commit, `node scripts/build-sea.js` output, and a passing execution of `test/task-2286-native-sea-smoke.test.ts` on that same target.
- Each passing target has one archive whose name follows the ADR 0044 executable-release convention and whose audited contents are the executable, declared source maps if shipped, LICENSE, NOTICES, checksum manifest, SBOM, build metadata, signature-status record, and installation instructions—without a source checkout, tests, secrets, operator state, or undeclared runtime downloads.
- Each passing target’s release record contains a verified SHA-256 checksum manifest, CycloneDX SBOM, LICENSE, NOTICES, source commit and pinned-runtime metadata, and a signature status of either `signed` or `unsigned`; the archive audit reports no missing declared material and no undeclared material.
- The native evidence for each passing target includes the TASK-2286 assertions covering SIGTERM handling, path-independent asset resolution, real-PTY terminal launch and exit, SQLite create/write/read, Git execution, and graceful shutdown.
- A clean-environment install and uninstall record exists for every passing target; installation documentation lists only those passing targets and separately documents the npm bundle fallback.
- A withdrawal exercise removes exactly one passing target’s executable archive and support claim while preserving the archives and support claims for every other passing target and the npm fallback.
- No mission-branch push is made to the `origin` remote, and publication remains a separately authorized action.

## Risks and Assumptions
- Risk: a candidate target may lack an available native runner or fail its native smoke suite. Assumption: such targets can be omitted from support documentation rather than represented by unexecuted cross-build output.
- Risk: platform differences in signals, paths, terminals, SQLite, Git, or process shutdown may expose behavior not covered by the prerequisite suite. Assumption: target-local regression evidence can be added without weakening the complete TASK-2286 smoke requirement.
- Risk: signing credentials or release publication authority may be unavailable. Assumption: explicit unsigned status is acceptable release evidence when a signature cannot be produced, and publication is not authorized by this mission.
- Risk: archive contents or supply-chain documents can drift by target. Assumption: per-target auditing can identify the exact declared release materials and associated provenance.

## Checkpoints
- CP 1: Record the native-evidence plan for Linux x64, Linux arm64, macOS x64, macOS arm64, and Windows x64: the runner, OS/architecture, pinned Node 25/26 toolchain, `node scripts/build-sea.js` invocation, `test/task-2286-native-sea-smoke.test.ts` invocation, and the evidence location for each target. Define removal from support claims as the outcome for a target lacking any one of those items.
- CP 2: Execute native SEA build and the complete TASK-2286 shipped-artifact suite target by target. Capture evidence for signals, paths, PTY terminal behavior, SQLite, Git, and shutdown; omit a target from support documentation when its native build or suite does not pass.
- CP 3: Create and audit the archive for each passing target. Verify its ADR 0044 executable-release name, declared contents, checksum manifest, CycloneDX SBOM, LICENSE, NOTICES, source-commit and pinned-runtime metadata, and `signed` or `unsigned` status.
- CP 4: Record clean-environment installation and uninstall evidence for every passing target; update documentation to name only passing targets plus the npm fallback; conduct and document withdrawal of one passing target without withdrawing another passing target or npm.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited markdown table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `node scripts/example.js` ``, `` `git status --short` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough: it may appear as supplemental context only when paired with one of the accepted references above.
- A non-generic `Next action:` line at the bottom that names the next matrix target (Linux x64, Linux arm64, macOS x64, macOS arm64, or Windows x64), archive, validation, or documentation action.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not publish artifacts, upload releases, use production signing credentials, or alter externally visible support claims without separate authorization.
- Do not push this mission branch to `origin`; mission-branch review pushes, if later authorized, target the `review` remote only.
- Do not list a binary target as supported unless its native build and complete TASK-2286 smoke-suite evidence are recorded.
- Do not remove or degrade npm fallback support while adding native-binary distribution.

## Stop Rules
- Stop work on Linux x64, Linux arm64, macOS x64, macOS arm64, or Windows x64 when no native runner or pinned Node 25/26 toolchain can be established, its `node scripts/build-sea.js` build fails, or `test/task-2286-native-sea-smoke.test.ts` fails; omit that target from support documentation and continue only with independently proven targets.
- Stop before publication, external distribution, credential use, or support announcements; obtain separate authorization for those actions.
- Stop and escalate if a required archive, checksum, SBOM, license, notice, build-metadata, signature-status, clean-install, uninstall, or rollback check cannot be evidenced with repository-recognized references.
