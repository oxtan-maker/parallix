# CP 1: Inspect `ci-required` + ADR 0058, record ref-handling, pins, and dependabot plan

Status: complete

## Summary of work done

Inspected the existing `ci-required` workflow, ADR 0058 publication flow, the
official `actions/dependency-review-action` v5.0.0 source (action.yml,
`src/schemas.ts`, `src/config.ts`, `src/git-refs.ts`, `src/main.ts`,
`src/dependency-graph.ts`) at its immutable release commit, the current GitHub
repository security settings, and the latest stable releases of every Action
used by the security-critical workflow. No edits made in this checkpoint.

### Existing `ci-required` workflow (`.github/workflows/ci-required.yml`)

Triggers: `pull_request` targeting `main`, and `push` to `github-publish/**`.
Job `ci-required` (literal name for branch protection) runs, in order:
`actions/checkout@v7` (`fetch-depth: 0`), a `git worktree add -b main ...
origin/main` step (proves `origin/main` resolves on push runs),
`actions/setup-node@v7` (Node 24, `check-latest`, npm cache), `npm ci`,
`npm run test:ci` (typecheck + build + unit + integration-ci + bundle +
package-content), SonarQube coverage merge + `npm run sonar` (trusted runs
only), and a summary step. A `release` job (needs `ci-required`, `push` to
`refs/heads/main` only) re-checks out `actions/checkout@v7`,
`actions/setup-node@v7`, and publishes to npm via Trusted Publishing.
Top-level `permissions: contents: read`.

### ADR 0058 publication flow

`docs/adr/0058-github-publish-mode.md`: the exact locally-generated
integration commit is pushed unchanged to
`refs/heads/github-publish/<sha>`; `origin/main` advances only through the
contiguous run of externally verified commits via fast-forward. Verification
of a publication candidate therefore runs on a plain `push` event whose
`github.sha` is the exact candidate SHA, with the trusted base being current
remote `main`.

### Dependency Review action semantics (pinned commit, verified from source)

`actions/dependency-review-action` v5.0.0 (release 2026-05-08, node24
runtime). Inputs read by `src/config.ts`: `fail-on-severity`,
`fail-on-scopes` (comma-separated list of `unknown`/`runtime`/`development`),
`base-ref`, `head-ref`, `license-check`, `vulnerability-check`,
`retry-on-snapshot-warnings`, `retry-on-snapshot-warnings-timeout`.

Verified non-obvious defaults (`src/schemas.ts`):

- `fail_on_scopes` defaults to `['runtime']` only — the action's default is
  narrower than this mission's policy, so all three scopes must be set
  explicitly.
- `license_check` defaults to `true` — must be explicitly disabled so license
  checking cannot become a blocking policy.
- Only `added` changes with a vulnerability at or above
  `fail-on-severity` fail the run (`src/filter.ts` `filterChangesBySeverity`);
  the comparison is differential by construction (base...head dependency-graph
  diff via `GET /repos/{owner}/{repo}/dependency-graph/compare/{basehead}`).

Fail-closed behavior (`src/git-refs.ts`, `src/main.ts`):

- `pull_request` event with no `base-ref`/`head-ref` → native comparison from
  `pull_request.base.sha` → `pull_request.head.sha`.
- Any event with missing base or head → thrown error → `core.setFailed`.
  Note: passing only one of `base-ref`/`head-ref` also throws, so both must be
  supplied together or both omitted.
- Comparison API 404/403 or any other error → `core.setFailed` (run fails).
  A 403 is the "Dependency graph not enabled" path.
- Snapshot ingestion lag (freshly pushed commit) surfaces as
  `snapshot_warnings`; with `retry-on-snapshot-warnings: true` the action
  re-polls every 10 s until `retry-on-snapshot-warnings-timeout` (s).

### Resolved immutable Action SHAs (official GitHub sources, 2026-09-22)

| Action | Current tag in workflow | Resolved release | Immutable SHA |
|---|---|---|---|
| `actions/checkout` | `@v7` | v7.0.1 (highest v7.x tag; 2026-07-20) | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | `@v7` | v7.0.0 (only v7.x tag; 2026-07-14) | `820762786026740c76f36085b0efc47a31fe5020` |
| `actions/dependency-review-action` | (new) | v5.0.0 (latest non-prerelease; 2026-05-08) | `a1d282b36b6f3519aa1f3fc636f609c47dddb294` |

`@v7` major tags currently resolve to exactly these SHAs, so pinning is a
no-behavior-change operation. All four existing `uses:` sites (both jobs) and
the new dependency-review step get SHA + release comment.

### Repository security settings (current state, API-verified)

- Dependency graph: `GET /repos/oxtan-maker/parallix/dependency-graph` → 404 (disabled)
- Dependabot alerts: `GET /repos/oxtan-maker/parallix/vulnerability-alerts` → 404 (disabled)
- Dependabot security updates: `GET /repos/oxtan-maker/parallix/automated-security-fixes` → `{"enabled": false, "paused": false}`

All three must be enabled (CP 3) via `PUT` on the same endpoints. The
authenticated `gh` account `oxtan-maker` (owner) has `repo` scope —
administration is available; no operator boundary expected, but CP 3 stops and
reports if a `PUT` is denied.

## Recorded plan (execution authority for CP 2+)

### Ref-handling plan

Placement: new steps after "Provide the primary worktree", before "Set up
Node" (repo/ref state available, before expensive verification).

1. New step (push events only) resolves the trusted base:

   ```yaml
   - name: Resolve the trusted publication base (full origin/main SHA)
     id: trusted-base
     if: github.event_name == 'push'
     run: |
       base_sha=$(git rev-parse origin/main)
       # fail closed unless origin/main resolved to an exact 40-char SHA
       [ "${#base_sha}" -eq 40 ] || { echo "origin/main did not resolve to a full SHA: $base_sha" >&2; exit 1; }
       echo "sha=$base_sha" >> "$GITHUB_OUTPUT"
   ```

2. New differential dependency review step (both event types):

   ```yaml
   - name: Differential dependency review (blocks newly introduced High/Critical)
     uses: actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294  # v5.0.0
     with:
       fail-on-severity: high
       fail-on-scopes: unknown,runtime,development
       license-check: false
       vulnerability-check: true
       base-ref: ${{ github.event_name == 'push' && steps.trusted-base.outputs.sha || '' }}
       head-ref: ${{ github.event_name == 'push' && github.sha || '' }}
       retry-on-snapshot-warnings: true
       retry-on-snapshot-warnings-timeout: 300
   ```

   - `pull_request`: both refs resolve to `''` → action falls back to its
     native PR comparison (`pull_request.base.sha` → `pull_request.head.sha`,
     the merge commit). Native behavior preserved.
   - `push` (`github-publish/<sha>`): base = full current `origin/main` SHA
     (resolved after `fetch-depth: 0` checkout), head = exact `github.sha`.
     Unresolvable/missing base or action error → step fails (fail-closed).
   - `fail-on-scopes: unknown,runtime,development` covers every scope
     explicitly; `license-check: false` keeps license checking out of the
     blocking policy.
   - `retry-on-snapshot-warnings` absorbs dependency-graph ingestion lag for a
     just-pushed publication SHA instead of skipping.

### Intended minimal `.github/dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

No automerge, no ignores, no groups, no cooldowns, no registries, no extra
ecosystems.

### Documentation

New ADR `docs/adr/0061-differential-dependency-security-and-dependabot-maintenance.md`
recording the three-way responsibility split (Dependency Review = differential
new-vulnerability gate; Dependabot alerts/security updates = existing-debt
exposure and remediation; Dependabot version updates = direct-dependency
maintenance; CodeQL = source SAST, unchanged), the High/Critical threshold,
the explicit `unknown`/`runtime`/`development` scopes, the license
out-of-scope decision, the fail-closed publication ref semantics, and the
SHA-pinning rule. `docs/adr/index.md` gains the entry.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CP 1 plan recorded before editing: PR + `github-publish/<sha>` ref handling, pins, dependabot content | this document (`missions/task-2549/CP-1.md`), `.github/workflows/ci-required.yml`, `docs/adr/0058-github-publish-mode.md` | PASS |
| Publication comparison policy basis understood | `ADR 0058` (`docs/adr/0058-github-publish-mode.md`) | PASS |
| Action versions to pin identified from official sources | release evidence recorded above; tags `v7.0.1`, `v7.0.0`, `v5.0.0` of `actions/checkout`, `actions/setup-node`, `actions/dependency-review-action` | PASS |
| Repository security settings baseline captured | `GET /repos/oxtan-maker/parallix/dependency-graph`, `.../vulnerability-alerts`, `.../automated-security-fixes` responses recorded above | PASS |

Next action: implement CP 2 — add the two workflow steps with the pinned
dependency-review action to `.github/workflows/ci-required.yml`, pin the four
existing `@v7` uses to resolved SHAs, add `.github/dependabot.yml`, add ADR
0061 + index entry, then run `./scripts/verify-local.sh all` and
`./scripts/verify-local.sh static-analysis`.
