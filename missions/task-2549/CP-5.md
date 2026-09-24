# CP 5: Remediate pre-existing dependency debt; restate ADR 0061 baseline rationale

Status: complete (local gates green; two open decisions recorded below).

## Summary of work done

1. **Baseline audit** (`npm audit`, pre-remediation): 6 vulnerabilities
   (3 high, 3 moderate).
2. **Safe fix** (`npm audit fix`, no `--force`): 2 vulnerabilities cleared by
   top-level transitive bumps in `package-lock.json` (e.g. adm-zip 0.6.0→0.6.1,
   axios 1.18.1→1.20.0, b4a 1.8.1→1.9.0, bare-events 2.9.1→2.9.2, bare-fs
   4.7.4→4.8.1). 4 remained (2 high, 2 moderate).
3. **Remaining debt located** — all nested inside the optional
   `@earendil-works/pi-coding-agent` peer/dev dependency tree (resolved
   0.80.10; vulnerable range 0.75.4–0.83.0):
   - `undici` 8.x (high) — direct dependency of pi-coding-agent; patched in
     pi ≥0.84.0 (undici 8.9.0).
   - `brace-expansion` 5.0.6 (high) ← `minimatch` 10.2.5 ← pi-coding-agent.
   - `protobufjs` 7.6.4 (moderate) ← `@google/genai` 1.52.0 ←
     `pi-ai` 0.80.10.
4. **Remediation**: `npm install -D @earendil-works/pi-coding-agent@0.87.1`
   (earliest safe fix per `npm audit`; 0.80→0.87 is a breaking 0.x jump).
   Result: `npm audit` → **0 vulnerabilities**. This is the local equivalent
   of a Dependabot scan (same GHSA data); Dependabot itself is GitHub-side.
5. **Local pre-integration audit gate wired into the existing gate
   infrastructure** (no new hook infra; the `px integrate` preIntegration
   list and the standalone `verify-local.sh integrate` pipeline are the
   existing fail-closed merge-gate mechanisms, ADR 0041):
   - `workflow.config.json` `adapters.gates.preIntegration`: new
     `dependency-audit` entry, command `npm audit --audit-level=high`, order
     2 (runs after `build`, before the expensive suites); later entries
     renumbered, relative order unchanged. A non-zero exit aborts the
     squash-merge, per the mandatory-gate contract.
   - `config/integration-pipelines.json`: same command as `dependency-audit`,
     order 1, `always: true` (dependency drift is not a changed-file area,
     so the gate must not depend on area matching).
   - Threshold matches ADR 0061: High/Critical block, moderate/low are
     reported but do not block.
6. **Verification on the remediated tree**:
   - `npm run typecheck` → PASS.
   - `npm test` → 2958 tests / 2958 pass / 0 fail (includes the updated
     `test/repository-gates.test.ts` gate-list assertion, now
     `['build', 'dependency-audit', 'verification', 'integration-suite',
     'quality-gate', 'workflow', 'agent-smoke']`).
   - `./scripts/verify-local.sh docs` → PASS.
   - `./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED.
   - Positive path: `npm audit --audit-level=high` on the mission tree →
     `found 0 vulnerabilities`, exit 0.
   - Negative path: throwaway temp directory with `yayson@4.2.0` (critical,
     GHSA-325j-mg25-8q58, same advisory as the CP-3 live proof) →
     `npm audit --audit-level=high` exit 1, i.e. the gate aborts integration.

## ADR 0061 edit accompanying this checkpoint

The ADR context previously read as if the gate's differential design were an
escape hatch for unremediated mission debt. Corrected to high level only:
the repository carries known vulnerability debt, advisories publish against
already-used versions without lockfile changes, and a blocking baseline-wide
`npm audit` gate would fail candidates for that drift. No mission progress,
audit counts, or version evidence appear in the ADR; this checkpoint is the
evidence of record.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| `npm audit` clean on the mission tree | 0 vulnerabilities after steps 2 and 4 above | PASS |
| Remediation does not break the package | typecheck PASS; 2958/2958 unit tests pass; static-analysis ALL STAGES PASSED | PASS |
| ADR 0061 contains no mission progress or audit evidence | `docs/adr/0061-...md` context is high-level; counts and versions live in this checkpoint | PASS |
| Mission tree with High/Critical audit finding cannot integrate | `dependency-audit` gate (`npm audit --audit-level=high`) in `workflow.config.json` preIntegration and `config/integration-pipelines.json` (`always: true`); negative path proven (temp dir, yayson@4.2.0, exit 1); positive path on mission tree (exit 0); non-zero gate exit aborts the squash-merge per the mandatory-gate contract | PASS |

## Open items

- `package.json` `peerDependencies` still declares
  `@earendil-works/pi-coding-agent: ^0.80.6` (0.x caret = `<0.81.0`) while
  `devDependencies` is now `^0.87.1`. Inconsistent support claim; bumping the
  peer range is a support-surface decision (ADR 0050 territory), not made
  here.
- pi 0.80→0.87 is breaking-by-semver. Unit and typecheck lanes are green in
  this worktree; `npm run test:agent-e2e` has not been run against the new
  pi release.
