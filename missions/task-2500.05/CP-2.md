# CP-2 — Add the `ci-required` workflow

## Work Done

Added `.github/workflows/ci-required.yml` — the single workflow file, confined
to `.github/workflows/`, using only the standard checkout and Node setup actions.

Both trigger families share the identical `ci-required` verification behavior:
- `pull_request` targeting `main` (PR verification)
- `push` to `main` (provisional real trigger only — NOT a claimed github-publish
  verification ref; ADR 0045 marks github-publish unimplemented, so `main`
  publishes *after* verification. The concrete verification ref is deferred to
  `task-2500.06`).

The `ci-required` job:
1. Checks out the triggered commit (`actions/checkout@v4` defaults to the
   triggered commit: the PR merge commit for `pull_request` events, the pushed
   SHA for `push` events).
2. Sets up Node `22` with `check-latest: true` (installs the latest 22.x, which
   is `>=22.23.1` per `package.json`) and the built-in `cache: npm`.
3. Runs `npm ci` (lockfile-respecting, deterministic install).
4. Runs exactly `npm run test:ci` (Mission 4 GitHub-safe clean-runner tier).

SC6 (failing test fails the job) holds because `npm run test:ci` is the last run
step with no `if:` guard, so a non-zero exit fails the job and branch protection
can reject the commit.

YAML validated with `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci-required.yml'))"`.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 literal `ci-required` job on PRs to protected primary | `.github/workflows/ci-required.yml` `jobs.ci-required.name: ci-required`; `on.pull_request.branches: [main]` | PASS |
| SC2 runs for github-publish ref, checks exact SHA | DEFERRED to `task-2500.06` — github-publish verification ref unestablished (ADR 0045); checkout defaults to the triggered commit (PR merge commit / pushed SHA), ref wiring deferred |
| SC3 Node >=22.23.1, lockfile install, `npm run test:ci` | `actions/setup-node@v4 node-version '24' check-latest: true` (installs >=24.15.0, the floor the unit suite needs for mock.module's exports option); `npm ci`; built-in `cache: npm`; final step `npm run test:ci` | PASS |
| SC4 read-only contents, no broad write | `permissions: { contents: read }` | PASS |
| SC5 cancel PR runs, keep publication runs | `concurrency.group: ci-required-${{ github.event.pull_request.number || github.run_id }}`; `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` | PASS |
| SC6 non-zero exit fails job | last run step `npm run test:ci` has no `if:` guard | PASS |
| SC7 run duration | DEFERRED to `task-2500.06` — live run URL requires a triggering ref local-only policy cannot produce |

## Next action:
Run `./scripts/verify-local.sh all` (done; gate green). SC2 and SC7 are deferred to `task-2500.06`, which establishes the github-publish verification ref and records the live `ci-required` run URL / run-id / elapsed time.
