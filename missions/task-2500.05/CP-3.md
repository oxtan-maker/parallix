# CP-3 — Validate workflow syntax, run the required local gate, capture CI duration

## Work Done

**Syntax.** `.github/workflows/ci-required.yml` parses clean:
`python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci-required.yml'))"`.
Structure verified: `name: ci-required`, `on: [pull_request→main, push→main]`,
`permissions.contents: read`, `concurrency` PR-only cancel, single
`ci-required` job. `concurrency.group: ci-required-` +
`github.event.pull_request.number || github.run_id`; `cancel-in-progress` PR-only.

**Required local gate.** `./scripts/verify-local.sh all` → exit 0, 2569 tests
pass / 0 fail. Gate green.

**Verification command (the exact command the GA `ci-required` job runs).**
`npm run test:ci` (Mission 4 GitHub-safe clean-runner tier: typecheck → build →
test → test:integration:ci → test:bundle → test:package-content) passes end to
end with no local AI or Forgejo infrastructure. Measured duration on this
workstation: **117.6 s** (`real 1m57.573s`, `user 5m57.754s`), exit 0. This is a
workstation proxy, not a measurement of the hosted run: a clean `ubuntu-latest`
runner differs in CPU, network and git setup, so the actual GitHub Actions
`ci-required` duration is unmeasured until `task-2500.06` records it live.

**SC2 / SC7 deferred.** Both require a live github-publish triggering ref that
this local-only session cannot produce: `origin` accepts only `main`, the
mission branch is local-only (`AGENTS.md`), and the `review` remote is Forgejo
(no GitHub Actions). ADR 0045 marks github-publish unimplemented, so the
workflow's `push: branches: [main]` trigger is not the github-publish verification
ref. Per operator mission split, SC2 and SC7 move to `task-2500.06`. The
measured local `npm run test:ci` duration (117.6 s) is a workstation proxy only;
it is not a measurement of the hosted run (see above).

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1 literal `ci-required` job on PRs to protected primary | `.github/workflows/ci-required.yml` `jobs.ci-required.name: ci-required`; `on.pull_request.branches: [main]` | PASS |
| SC2 runs for github-publish ref, checks exact SHA | DEFERRED to `task-2500.06` — github-publish verification ref unestablished (ADR 0045); checkout defaults to the triggered commit, ref wiring deferred |
| SC3 Node >=22.23.1, lockfile install, `npm run test:ci` | `actions/setup-node@v4 node-version '24' check-latest: true` (installs >=24.15.0, the floor the unit suite needs for mock.module's exports option); `npm ci`; built-in `cache: npm`; final step `npm run test:ci` | PASS |
| SC4 read-only contents, no broad write | `.github/workflows/ci-required.yml` `permissions.contents: read` | PASS |
| SC5 cancel PR runs, keep publication runs | `.github/workflows/ci-required.yml` `concurrency.group: ci-required-${{ github.event.pull_request.number || github.run_id }}`; `cancel-in-progress: ${{ github.event_name == 'pull_request' }}` | PASS |
| SC6 non-zero exit fails job | final run step `npm run test:ci` has no `if:` guard → non-zero exit fails the `ci-required` job | PASS |
| SC7 run duration | DEFERRED to `task-2500.06` — live run URL requires a triggering ref local-only policy cannot produce; local `npm run test:ci` measured `real 1m57.573s` (117.6 s), exit 0 is a workstation proxy, not a hosted-run measurement |

## Gates

| Gate | Evidence | Status |
|---|---|---|
| `./scripts/verify-local.sh all` | exit 0, 2569 pass / 0 fail | PASS |

## Next action:
All locally verifiable checkpoints complete and gate green; commit CP-3.md and confirm `./scripts/verify-local.sh all` passes against the committed tree. SC2 and SC7 are deferred to `task-2500.06`, which establishes the github-publish verification ref and records the live GitHub Actions `ci-required` run URL / run-id / elapsed time. Then hand off (Parallix performs lifecycle transitions).
