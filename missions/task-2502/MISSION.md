# Mission: Add local CodeQL SAST gate and reach zero findings (task-2502)

## Goal
Add GitHub CodeQL as a first-class, repository-owned local SAST gate for Parallix and drive the repository to a green CodeQL security scan with zero unmitigated findings. The gate must be an executable command in the integration path, not merely documented.

Concretely:
1. Provide `npm run test:codeql` backed by `scripts/codeql-sast.sh` that runs the official CodeQL CLI against the current checkout/worktree (`javascript-typescript` language), using a pinned CodeQL version, failing loudly if CodeQL cannot be obtained, returning non-zero on qualifying findings, and isolating generated databases/results per worktree.
2. Select and record a query suite (`security/code-scanning` minimum; `security-extended` preferred when deterministic without unacceptable false positives) and never ship a deliberately weak configuration.
3. Wire CodeQL into the integration gate as an unconditional (`"always": true`) gate in `config/integration-pipelines.json`, ordered after cheap static checks/build and before expensive E2E/real-agent gates, and mirror it into `workflow.config.json`'s `adapters.gates.preIntegration` array (the merge-gate authority).
4. Baseline the current codebase, classify every finding, fix every genuine/actionable finding, and add regression tests at high-risk boundaries.
5. Mitigate genuine false positives transparently by making safety visible in code; use suppressions only as a last resort.

## Why Now
Parallix is a trust layer around AI-generated software changes. Its own integration path must carry independent static security analysis in addition to tests, linting, type checking, review, and runtime verification. Security-relevant data flows cross architectural areas, so CodeQL must be an unconditional gate that does not depend on Parallix's changed-area classification. This closes the gap where SAST exists in intent but not as a runnable, blocking, repository-owned gate.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: trust-layer integrity, unconditional SAST gate, zero-findings baseline, integration-gate wiring

## Scope
- Add `scripts/codeql-sast.sh` and wire `npm run test:codeql` into `package.json` scripts.
- Run CodeQL (`javascript-typescript`) against the current checkout/worktree, respecting `PARALLIX_EXECUTION_ROOT`.
- Pin the CodeQL version in the runner and fail loudly when it is missing or wrong.
- Keep CodeQL distribution and generated databases/results out of Git (`.gitignore` / per-worktree temp dirs), caching tooling outside tracked source.
- Choose and record the query suite; never weaken it to pass.
- Baseline every CodeQL finding and classify it (genuine vuln / actionable-but-hard-to-exploit / false positive / accepted behavior).
- Fix genuine and actionable findings, prioritizing high-risk boundaries (see below), and add regression tests where the security boundary is demonstrable.
- Mitigate genuine false positives by restructuring code so safety is visible to humans and static analysis; suppress only as a last resort, with recorded justification.
- Add the CodeQL gate to `config/integration-pipelines.json` (`always: true`, ordered after build/static analysis and before E2E gates) and to `workflow.config.json` `adapters.gates.preIntegration`.
- Update authored documentation (e.g. README, prompts, or verification docs) to describe the new gate and command.

## Out of Scope
- Adding CodeQL for any language other than `javascript-typescript` (Parallix is TypeScript/JavaScript).
- Replacing or removing the existing static-analysis gate (ESLint + tsc + test-hygiene) — CodeQL is additive.
- Building a custom SAST engine, query authoring, or a full findings dashboard/baseline file UI.
- CI/remote-runner integration beyond the local gate (the local gate is the deliverable; CI wiring is a follow-up).
- Changing intended application behavior solely to satisfy the scanner without understanding the underlying data flow.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- `npm run test:codeql` resolves to `scripts/codeql-sast.sh` (grep `test:codeql` in `package.json` returns the script path).
- `scripts/codeql-sast.sh` invokes the official `codeql` CLI, builds a `javascript-typescript` database, runs a recorded suite, and exits non-zero when qualifying findings exist.
- The runner pins a CodeQL version and exits non-zero with a clear message when the CLI is missing or below the pinned version.
- CodeQL distribution and generated databases/results are not tracked by Git (confirmed by `git ls-files` showing no `codeql-dbs/` or `*.codeql` artifacts; runner writes to a per-worktree temp dir derived from `PARALLIX_EXECUTION_ROOT`).
- `config/integration-pipelines.json` contains a CodeQL gate with `"always": true` whose `order` is greater than the `build`/static-analysis gate order and less than the `workflow`/`custom-agent-smoke` gate order.
- `workflow.config.json` `adapters.gates.preIntegration` includes a CodeQL gate command (merge-gate authority includes SAST).
- Baseline classification covers 100% of findings emitted against the parent commit's tree; every finding row is one of (genuine vuln, actionable, false positive, accepted).
- Zero unmitigated findings remain on the final tree: every finding is either fixed, or recorded as a false positive with visible-in-code mitigation, or recorded as an accepted behavior with a written justification.
- Every fixed high-risk finding has a regression test that fails before the fix and passes after (path where a fix is demonstrable).
- `./scripts/verify-local.sh all` passes on the final tree, and `./scripts/verify-local.sh integrate` passes with the CodeQL gate included.
- No `.only` or bare `.skip` tests introduced; lint and static analysis clean on changed files; docs updated for the new command/gate.

## Risks and Assumptions
- CodeQL CLI must be obtainable offline or via a pinned, cached download; network may be unavailable during execution. Assumption: a pinned CodeQL version can be cached outside tracked source, and a preinstalled `codeql` binary is accepted only if it satisfies the pinned version.
- `security-extended` may emit findings that are hard to eliminate structurally; risk of spending mission budget on low-severity/false positives. Mitigation: classify first, fix genuine/actionable, mitigate false positives in code, accept with justification only when safe.
- Regression tests for security boundaries may require constructing inputs that trigger CodeQL-reported flows; some findings may not have a cheap deterministic test. Assumption: test where the boundary is demonstrable; otherwise rely on the static gate plus a written safety argument.
- Adding an unconditional gate could slow `./scripts/verify-local.sh integrate`; risk of timeout. Mitigation: keep the analysis scoped to the checkout and use a deterministic pinned suite.
- The runner must not corrupt sibling worktrees. Assumption: per-worktree isolation via `PARALLIX_EXECUTION_ROOT`-derived temp paths.

## Checkpoints
- CP 1: Baseline — run CodeQL against the parent-commit tree, capture all findings, and produce a classification table (genuine / actionable / false positive / accepted) with per-finding location and severity.
- CP 2: Runner — implement `scripts/codeql-sast.sh`, wire `npm run test:codeql`, pin the CodeQL version, add per-worktree isolation and Git-ignore for CodeQL artifacts, and verify it fails loudly on missing/wrong CLI and non-zero on findings.
- CP 3: Gate wiring — add the unconditional CodeQL gate to `config/integration-pipelines.json` and `workflow.config.json`, ordered after static/build and before E2E gates; record the chosen query suite.
- CP 4: Remediation — fix every genuine/actionable finding, add regression tests at demonstrable high-risk boundaries, and mitigate false positives in code; keep suppressions last-resort with justification.
- CP 5: Verification — pass `./scripts/verify-local.sh all` and `./scripts/verify-local.sh integrate` on the final tree with zero unmitigated findings; update docs.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- A `## Goal Check` section
- A 3-column pipe-delimited markdown table with columns: Criterion | Evidence | Status
- At least one evidence row per criterion using durable, verifiable references. Parallix already accepts:
  1. **Recognized repo commands or paths** — e.g., `` `npm run test:codeql` ``, `` `./scripts/verify-local.sh all` ``, `` `npm run test:integration` ``, `` `git ls-files` ``, or `` `npm run test:codeql -- --dry-run` ``
  2. **Test names** — must match a test name in the repo (cite the exact string)
  3. **Test file paths** — e.g., `test/codeql-sast.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0039` (must correspond to an existing file under `docs/adr/`)
  5. **File:line references** — accepted when needed, but line numbers eventually rot; prefer the forms above
- Raw `stat`/`ls` output or generic prose may appear as supplemental context, but pair them with one of the accepted references above. Concretely: a `git ls-files | grep codeql` line or `ls scripts/` listing is NOT sufficient on its own — append the recognized command/test/ADR/file reference that proves the criterion.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| `npm run test:codeql` wired to runner | `package.json`, `scripts/codeql-sast.sh` | PASS |
| CodeQL gate runs during integration | `./scripts/verify-local.sh integrate` | PASS |
| Baseline covers all findings | `missions/task-2502/checkpoints/CP1.md` classification table | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all
- [ ] ./scripts/verify-local.sh integrate
- [ ] npm run test:codeql

## Restricted Areas
- Do not modify anything outside the mission scope: no changing the ESLint/tsc/test-hygiene static-analysis gate, no removing existing integration gates, no altering the review/merge ownership flow.
- Do not commit CodeQL distribution, generated databases (`*.codeql`, `codeql-dbs/`), or result artifacts to Git.
- Do not weaken the query suite to obtain a green result, and do not add blanket suppressions without a recorded per-finding justification.
- Do not change intended application behavior solely to satisfy the scanner without understanding the underlying data flow.

## Stop Rules
- Stop before introducing any change that breaks `./scripts/verify-local.sh all`.
- Stop if CodeQL cannot be obtained at the pinned version and cannot be cached; do not substitute an unverified SAST tool.
- Stop if reaching zero findings requires weakening the query suite or adding unexplained suppressions — escalate instead of gaming the gate.
- Do not proceed to fix implementation before the baseline classification (CP 1) is complete.
- Do not transition the task; the harness transitions to `ready` after a clean draft.
