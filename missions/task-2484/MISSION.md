# Mission: Fix dead npm metadata URLs and verify them automatically (task-2484)

## Goal
Make the npm metadata for `@magnusekdahl/parallix` point at the operator-confirmed canonical repository, homepage, and bug tracker, and reject future manifest URLs that disagree with `origin` without network access.

## Why Now
Anonymous npm visitors currently receive 404s from all three project links. This contradicts the trust-layer repositioning before a prospective user can inspect the project, and the same stale values propagate into generated release metadata.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: activate as-is
- Main drivers: one manifest correction, an offline verifier extension, targeted regression coverage, and verifier-contract documentation.

## Scope
- Confirm the canonical public repository URL with the operator before changing metadata.
- Update `package.json` `repository.url`, `homepage`, and `bugs.url` to that confirmed canonical location.
- Extend `scripts/verify-docs.mjs` to reject each manifest field when it disagrees with `git remote get-url origin`, without HTTP requests.
- Add regression coverage for metadata URLs that disagree with `origin`.
- Update the authored documentation that describes `verify-docs.mjs` so its manifest-metadata validation is accurate.

## Out of Scope
- Making a private or missing repository public, creating repositories, or changing remote hosting ownership.
- Verifying arbitrary external documentation URLs or adding network access to the docs verifier.
- Changing release-metadata behavior beyond receiving corrected manifest values.
- Reworking unrelated npm package metadata or release workflow behavior.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- The operator-confirmed canonical repository URL is recorded in the implementation checkpoint before `package.json` changes.
- `package.json` `repository.url`, `homepage`, and `bugs.url` identify that canonical location and agree with `git remote get-url origin` under the verifier’s normalization rules.
- `scripts/verify-docs.mjs` exits non-zero for an input where any one of `repository.url`, `homepage`, or `bugs.url` disagrees with `origin`.
- The metadata-agreement check makes no network request and passes against the final matching manifest and `origin` remote.
- `test/task-2484-npm-metadata-urls-repro.test.ts` is red on the mission parent commit for mismatched metadata and green after the verifier change.
- Documentation that states what `verify-docs.mjs` validates includes npm manifest metadata URL agreement with `origin`.
- `./scripts/verify-local.sh all` exits zero on the final tree.

## Risks and Assumptions
- The operator may confirm that `magnusekdahl/parallix` is intentionally private; stop rather than repointing metadata until the operator chooses whether to expose it or adopt the `origin` repository as canonical.
- `origin` is assumed authoritative for this checkout; if it is not, stop for an operator decision rather than encoding a different remote.
- npm URL fields and the Git remote may differ in transport syntax or a trailing `.git`; normalize only representational differences necessary to compare the same location.
- The existing verifier test seam is assumed to permit a synthetic manifest and remote result; if it cannot, add the smallest testable seam rather than invoking GitHub or npm.

## Checkpoints
- CP 1: Create `test/task-2484-npm-metadata-urls-repro.test.ts` before any production fix. It must run the documentation verifier against a manifest whose `repository.url`, `homepage`, or `bugs.url` disagrees with the simulated `origin` URL and assert rejection; this assertion must fail on the mission parent commit (red) and pass after the verifier change (green).
- CP 2: Obtain and record the operator’s canonical-URL decision. If it matches `origin`, correct all three manifest fields and implement the offline origin-agreement validation in `scripts/verify-docs.mjs`; otherwise stop under the stop rules.
- CP 3: Document the verifier’s manifest-metadata contract, run the required repository gate, and record final Goal Check evidence.

Reproduction-Test: test/task-2484-npm-metadata-urls-repro.test.ts

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Evidence led by durable forms Parallix verifies today: exact test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./scripts/verify-local.sh all`.
- The exact heading `## Goal Check` followed by the 3-column table `| Criterion | Evidence | Status |`.
- At least one evidence row per success criterion. File:line references are accepted parenthetically when needed but discouraged because line numbers rot.
- The CP 1 red result and green result using the exact regression-test name and `test/task-2484-npm-metadata-urls-repro.test.ts`, plus the operator’s URL decision with applicable `git ...` evidence.
- Raw `stat`/`ls` output or generic prose alone is not enough; pair shell output with one of the accepted references above.
- A non-generic `Next action:` line at the bottom.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Mismatched manifest metadata is rejected | `test/task-2484-npm-metadata-urls-repro.test.ts`, exact regression-test name | PASS |
| Final repository gate ran | `./scripts/verify-local.sh all` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not contact npm, GitHub, or any external URL from the verifier or tests.
- Do not alter the `origin` remote, publish a package, create or expose a repository, or change repository ownership.
- Do not modify generated release metadata contracts except through corrected `package.json` fields.

## Stop Rules
- Stop before changing `package.json` if the operator has not confirmed the canonical repository URL.
- Stop and request an operator decision if the confirmed canonical URL does not match `origin`, if `origin` is not authoritative, or if making the intended repository reachable requires an external hosting change.
- Stop if the required verification would need a real network call; retain an offline comparison against the local Git remote instead.
