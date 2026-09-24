# CP 2: Implement workflow/configuration changes and focused validation

Status: complete

## Summary of work done

Implemented the CP-1 plan:

1. `.github/workflows/ci-required.yml`
   - New step "Resolve the trusted publication base (full origin/main SHA)"
     (`id: trusted-base`, push events only): `git rev-parse origin/main`,
     fails the step unless it resolves to an exact 40-char SHA, emits
     `sha=...` to `GITHUB_OUTPUT`.
   - New step "Differential dependency review (blocks newly introduced
     High/Critical)" using
     `actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294`
     (v5.0.0, immutable SHA + release comment), with
     `fail-on-severity: high`, `fail-on-scopes: unknown,runtime,development`,
     `license-check: false`, `vulnerability-check: true`,
     `base-ref: ${{ github.event_name == 'push' && steps.trusted-base.outputs.sha || '' }}`,
     `head-ref: ${{ github.event_name == 'push' && github.sha || '' }}`,
     `retry-on-snapshot-warnings: true`,
     `retry-on-snapshot-warnings-timeout: 300`. Placed after "Provide the
     primary worktree", before "Set up Node" — early, before expensive
     verification.
   - Pinned all four existing Action uses to immutable release SHAs with
     release comments: `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1`
     (v7.0.1, both jobs) and
     `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020`
     (v7.0.0, both jobs). These are exactly the commits the `@v7` major tags
     resolved to at implementation time, so pinning changed no behavior.
   - Header comment corrected: the `push` trigger is now documented as the
     ADR 0058 `github-publish/<sha>` verification ref (the old comment
     predated ADR 0058 and said the ref was unestablished).
2. `.github/dependabot.yml` (new): `version: 2`, weekly root updates for
   exactly `npm` and `github-actions`; no automerge, ignores, groups,
   cooldowns, or registries.
3. `docs/adr/0061-differential-dependency-security-and-dependabot-maintenance.md`
   (new) + `docs/adr/index.md` entry: records the three-way responsibility
   split (Dependency Review / Dependabot / CodeQL), the High/Critical
   threshold, explicit scopes, license out-of-scope, fail-closed publication
   ref semantics, and the pinning rule.

### Focused validation (CP 2 criteria)

- Native PR behavior remains native: on `pull_request` both `base-ref` and
  `head-ref` expressions evaluate to `''`, which the action's
  `getOptionalInput` maps to undefined; `src/git-refs.ts` then falls back to
  the event's `pull_request.base.sha` → `pull_request.head.sha`. No local
  diff re-implementation.
- Custom publication refs are full unambiguous SHAs: base comes from
  `git rev-parse origin/main` after `fetch-depth: 0` checkout (40-char guard
  in the step); head is `github.sha`, the exact full pushed SHA.
- Review errors are not ignored: verified at the pinned v5.0.0 source —
  missing base/head → thrown error → `core.setFailed`; comparison API
  404/403/other → `core.setFailed`. No `continue-on-error`, no `warn-only`,
  no `ignore` list.
- Scope/severity/license policy explicit: `fail-on-severity: high`,
  `fail-on-scopes: unknown,runtime,development` (action default is
  `runtime` only — see CP-1), `license-check: false` (action default is
  `true`).
- No unrelated workflow behavior changed: the diff touches only the header
  comment, the four `uses:` references, and the two new steps. Trigger,
  concurrency, permissions (`contents: read`), checkout semantics, Node
  setup, `npm ci`, `npm run test:ci`, Sonar steps, and the `release` job are
  untouched; existing workflow-asserting tests
  (`test/task-2509-release-workflow.test.ts`,
  `test/sonarqube-cloud-wiring.test.ts`,
  `test/task-2525.03-sonar-enforcement.test.ts`) pass in the gate runs below.
- Both YAML files parse cleanly (js-yaml load of
  `.github/workflows/ci-required.yml` and `.github/dependabot.yml`).
- `graphify update .` re-ran after the change; `graphify-out/` is
  git-ignored, so no graph artifacts are committed.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Dependency Review invokes official action via 40-char immutable SHA with release comment | `actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294  # v5.0.0` in `.github/workflows/ci-required.yml` | PASS |
| Blocking scopes explicitly cover runtime, development, unknown; license checking cannot block | `fail-on-scopes: unknown,runtime,development`, `license-check: false` in `.github/workflows/ci-required.yml`; policy rationale in `ADR 0061` | PASS |
| PRs use native PR comparison; `github-publish/<sha>` compares full `origin/main` SHA to exact `github.sha`; refs/errors fail closed | "Resolve the trusted publication base" + "Differential dependency review" steps in `.github/workflows/ci-required.yml`; v5.0.0 `src/git-refs.ts`/`src/main.ts` fail-closed semantics recorded in `missions/task-2549/CP-1.md`; `ADR 0058` | PASS |
| Unrelated candidates not failed by pre-existing debt | differential `fail-on-severity`/added-changes-only semantics documented in `ADR 0061` (verified against action `src/filter.ts` in CP-1); live no-change confirmation pending CP-4 publication run | PARTIAL |
| Every `ci-required` Action pinned to confidently resolved immutable SHA with release comment, unchanged major behavior | `actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1`, `actions/setup-node@820762786026740c76f36085b0efc47a31fe5020  # v7.0.0`, `actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294  # v5.0.0` in `.github/workflows/ci-required.yml`; tag/SHA resolution evidence in `missions/task-2549/CP-1.md` | PASS |
| `.github/dependabot.yml` weekly, exactly npm + github-actions, no automerge/ignores/registries | `.github/dependabot.yml` | PASS |
| Workflow/config syntax validation + existing gates green | `./scripts/verify-local.sh all` (exit 0; 2910 tests, 0 fail), `./scripts/verify-local.sh static-analysis` (all stages passed) | PASS |
| Decision recorded | `ADR 0061` (`docs/adr/0061-differential-dependency-security-and-dependabot-maintenance.md`), `docs/adr/index.md` | PASS |

Next action: CP-3 — with the authenticated `oxtan-maker` gh session, enable
Dependency graph, Dependabot alerts, and Dependabot security updates via
`PUT /repos/oxtan-maker/parallix/dependency-graph`,
`.../vulnerability-alerts`, and `.../automated-security-fixes`, then create
the disposable vulnerable-dependency branch/PR live negative proof.
