# ADR 0061: Differential dependency security gate and Dependabot maintenance

- Status: **Accepted**
- Date: 2026-09-22
- Task: TASK-2549
- Related: ADR 0046 (npm publish process and security), ADR 0057 (verification tiers and trust model), ADR 0058 (`github-publish` mode), ADR 0060 (SonarQube analysis)

## Context

Parallix verifies source security with CodeQL and audits the npm package at
release time, but the publication path had no blocking boundary against
*newly introduced* vulnerable dependencies, and the repository carried no
Dependabot configuration, so maintenance of direct npm packages and GitHub
Actions was manual.

The repository carries known vulnerability debt, and a clean baseline is not
permanent: advisories are published against versions already in use, with no
candidate having changed the lockfile. A baseline-wide blocking `npm audit`
gate would fail every candidate for pre-existing or newly published
vulnerabilities, and it would still not answer the question the publication
trust boundary actually needs: *does this candidate make the known
vulnerability posture worse?* The gate must be differential; remediation of
base drift belongs to Dependabot security updates, not to candidate-blocking.

## Options considered

| Option | New vulnerable dependency blocks at candidate time | Unrelated candidates failed by pre-existing debt | Owns comparison and advisory data itself | Decision |
|---|---|---|---|---|
| Baseline-wide `npm audit` gate in CI | Only after the debt is remediated | Yes — every candidate fails until the base is clean | Partially — npm advisory data differs from GitHub's dependency graph | Rejected |
| GitHub Dependency Review step in `ci-required` | Yes — differential by construction | No — only dependencies the candidate adds are evaluated | No — GitHub owns the dependency graph, advisories, and comparison | **Accepted** |
| Custom local lockfile diff plus advisory check | Yes | No | Yes — comparison, ingestion lag, and advisory data all re-implemented | Rejected |
| Dependabot alerts and release-time audit only | No — alerts are post-hoc and the audit runs at publication, not on candidates | No | No | Insufficient alone |

## Decision

- **Differential gate in `ci-required`.** The official Dependency Review
  action runs in the required check and fails a candidate that *adds* a
  dependency with a High or Critical advisory. Moderate and low
  vulnerabilities are reported but do not block. Dependencies in `runtime`,
  `development`, and `unknown` scopes are evaluated: Parallix builds and
  bundles tooling from its development dependency graph, so development
  dependencies can reach the distributed artifact, and `unknown` is
  fail-closed so an unclassified dependency cannot silently bypass the gate.
  License policy is out of scope; the gate must not gain a blocking license
  criterion by default drift.

- **Publication candidates compare against remote `main`.**
  `github-publish/<sha>` candidates (ADR 0058) are plain push events with no
  native PR comparison. The workflow resolves the current full `origin/main`
  SHA and compares it against the exact candidate SHA — the cumulative delta
  the candidate would add to remote `main`, including locally integrated
  commits queued behind it. Reviewing only the single pushed commit is
  rejected: a vulnerable dependency introduced by a queued commit would pass
  the single-commit review yet ship with the candidate. A missing or
  unresolvable base or head ref fails the step; infrastructure errors are
  never reclassified as "no dependency changes".

- **Security-pipeline actions pinned to immutable release SHAs.** Every
  action used by `ci-required` is pinned to the full commit SHA of the
  release in use, with the release version recorded in a comment; Dependabot
  proposes updates to the pins as reviewable PRs. This is a pinning
  operation, not an upgrade: intended major behavior is unchanged.

- **Minimal Dependabot configuration.** Weekly updates for exactly two
  ecosystems, `npm` and `github-actions`, with no automerge, no ignores, and
  no grouping or cooldowns. The committed configuration only schedules
  version updates; the dependency graph, Dependabot alerts, and Dependabot
  security updates are separate GitHub repository settings and remain
  enabled.

- **Local pre-integration audit gate.** The repository's existing
  pre-integration gate list (ADR 0041) gains an audit gate at the merge
  boundary: a mission whose own tree carries a High or Critical audit
  finding cannot be integrated. This is baseline enforcement at a different
  boundary — the local merge into the primary branch — not a candidate check,
  so it never fails candidates for upstream advisory publication, and it
  holds the same severity threshold as the candidate gate.

**Two planes, five responsibilities.** The controls split by where they are
enforced, and none replaces another:

- *GitHub plane (external):* Differential Dependency Review blocks newly
  introduced vulnerable dependencies at candidate time; Dependabot alerts and
  security updates expose and remediate vulnerabilities already present on
  the default branch; Dependabot version updates keep direct dependencies and
  actions current.
- *Local plane (operator-owned):* the pre-integration audit gate blocks a
  mission's own integration while the mission tree itself carries a High or
  Critical finding, so new debt cannot enter the primary branch through the
  mission path; CodeQL remains the source-code SAST gate.

Pre-existing debt is remediated through Dependabot PRs or an explicitly
scoped mission — never by force-upgrading or suppressing advisories to make
the gate green.

## Consequences

- A candidate that introduces a High or Critical vulnerable dependency in an
  evaluated scope fails `ci-required` early, before test, coverage, or Sonar
  work consumes runner time.
- A mission whose own tree carries a High or Critical `npm audit` finding
  cannot be integrated; the integration boundary enforces the same severity
  threshold as the candidate gate.
- Unrelated candidates are not failed by pre-existing dependency debt; only
  *added* vulnerable dependencies block.
- Pre-existing debt stays visible through Dependabot alerts and security
  updates on the default branch.
- Security-pipeline actions no longer move implicitly under tag references;
  their updates are reviewable Dependabot PRs.
- The gate relies on GitHub dependency-graph ingestion for just-pushed
  publication SHAs; ingestion lag is absorbed by the action's snapshot retry
  rather than by skipping the review.

## Reconsideration triggers

- Evidence that moderate vulnerabilities routinely reach the distributed
  artifact through development-scope tooling → raise the blocking severity to
  moderate.
- The default branch accumulates unremediated High or Critical debt that
  Dependabot security updates do not clear in a timely way → revisit extending
  the blocking audit to a hosted baseline gate; while the baseline stays
  clean, differential review remains the only candidate gate that does not
  fail candidates for upstream advisory publication.
- Dependabot PR volume becomes a maintenance burden → add grouping, cooldowns,
  or per-ecosystem schedules from observed PR history.
- License governance is adopted as a Parallix policy → add an explicit
  license policy to the gate as its own decision.
- The dependency review action changes ref-input or scope semantics in a
  major release → re-verify the pinned invocation against this ADR before
  merging its Dependabot update.
