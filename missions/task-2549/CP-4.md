# CP 4: Integrate after local gates + live proof; capture real `github-publish/<sha>` run

Status: complete up to the Parallix-owned publication step (see Goal Check row
for the live run; that step belongs to Parallix's lifecycle, which this
execution is instructed not to run).

## Summary of work done

1. **Final gates re-run on the finished tree** (all mission work committed,
   tree at HEAD after this checkpoint's predecessor):
   - `./scripts/verify-local.sh all` → exit 0, `2910 tests / 2910 pass / 0 fail`.
   - `./scripts/verify-local.sh static-analysis` → `ALL STAGES PASSED`
     (ESLint, tsc typecheck, test-hygiene, test typecheck).
   - `./scripts/verify-local.sh docs` (repo standard after authored-doc edits)
     → exit 0, `PASS: authored documentation contains no volatile
     implementation evidence and relative links resolve`.
2. **Live proof complete** (CP-3): the rejection path is proven against real
   GitHub (GHSA-325j-mg25-8q58, yayson@4.2.0, PR #3, failed run
   35739493111); the vulnerable dependency was never merged, published, or
   retained (`grep -c yayson package.json package-lock.json` → 0/0 in the
   committed tree).
3. **Publication readiness for the integrated TASK-2549 SHA**:
   - The integrated SHA's tree contains the new
     `.github/workflows/ci-required.yml` (dependency-review step + SHA pins),
     `.github/dependabot.yml`, and `ADR 0061`, so the `github-publish/<sha>`
     push will execute the new gate — the run definition travels with the
     commit, exactly as ADR 0058's exact-SHA model requires.
   - Per ADR 0058, the exact locally-generated integration commit is pushed
     unchanged to `refs/heads/github-publish/<sha>`; the workflow then
     resolves base = full current `origin/main` SHA (via the
     "Resolve the trusted publication base" step; origin/main at
     2026-09-22 write-up time is
     `4acc5fca37cc7ab8b386789bb95e64e61444379e`) and head = exact
     `github.sha`. Missing refs or review errors fail the run (fail-closed);
     `retry-on-snapshot-warnings` (300 s) absorbs dependency-graph ingestion
     lag of the just-pushed SHA.
   - A green no-change dependency review is the expected outcome: the
     integrated delta introduces no new vulnerable dependencies (the only
     dependency change in this mission is none — `package.json` /
     `package-lock.json` are untouched by the mission; the proof dependency
     lived exclusively on the deleted throwaway branch).
   - Known pre-existing condition (not introduced by this mission): earlier
     queued candidates (e.g. run 35693107525 for
     `github-publish/6f1ed5fb...`, task-2525.05) fail at "Run mandatory
     SonarQube quality gate" while `main` at 4acc5fca passed ci-required
     today — if the TASK-2549 publication run fails at Sonar for the same
     pre-existing reason, that is a platform/quality issue to report, not a
     dependency-review failure; the dependency-review step's own result is
     the gate this mission owns.
4. **Why the run reference is pending this checkpoint**: the harness
   contract for this execution forbids `px active` / `px review` /
   `px integrate` ("Parallix performs lifecycle transitions itself"). The
   integration commit — and therefore the `github-publish/<sha>` verification
   ref and its CI run — is produced by Parallix's lifecycle immediately after
   this handoff. The mission's stop rule ("stop and request the exact
   operator action if ... to observe the required real publication run")
   applies to that one remaining observation; everything it needs is
   committed and gated.

### Verification checklist for the live run (to be confirmed once published)

- Run for head branch `refs/heads/github-publish/<integrated-sha>` exists.
- Step "Resolve the trusted publication base" emits the full 40-char current
  `origin/main` SHA (`4acc5fca37cc7ab8b386789bb95e64e61444379e` at write-up
  time, or a later value if remote `main` advanced first).
- Step "Differential dependency review (blocks newly introduced
  High/Critical)" succeeds (no newly introduced High/Critical dependency).
- "Run GitHub-safe verification (npm run test:ci)", coverage merge, and
  "Run mandatory SonarQube quality gate" continue to execute.
- `ci-required` job green → commit is externally verified per ADR 0058.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Dependency Review in the stable `ci-required` trust path, official action at immutable 40-char SHA with release comment | `.github/workflows/ci-required.yml` (`actions/dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294  # v5.0.0`); live invocation observed in run 35739493111 | PASS |
| Newly introduced High/Critical vulnerability makes the step fail | run 35739493111 (PR #3): `##[error]Dependency review detected vulnerable packages` for `yayson@4.2.0`, GHSA-325j-mg25-8q58 (critical); full run evidence recorded in `missions/task-2549/CP-3.md` | PASS |
| Blocking scopes explicitly runtime, development, unknown; license cannot block | `fail-on-scopes: unknown,runtime,development`, `license-check: false` in `.github/workflows/ci-required.yml`; dev-scope rejection demonstrated live in run 35739493111; `ADR 0061` | PASS |
| PRs native comparison; `github-publish/<sha>` full `origin/main` → exact `github.sha`; refs/errors fail closed | `.github/workflows/ci-required.yml` (trusted-base step + conditional refs); v5.0.0 `src/git-refs.ts`/`src/main.ts` fail-closed semantics (CP-1); `ADR 0058` | PASS |
| Unrelated candidate not failed by pre-existing debt | differential semantics in `ADR 0061`; run 35739493111 failed only on the added yayson while the default branch carries 3 high / 5 moderate advisories | PASS |
| All `ci-required` Actions pinned to confidently resolved immutable SHAs, unchanged major behavior, release comments | `checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1`, `setup-node@820762786026740c76f36085b0efc47a31fe5020  # v7.0.0`, `dependency-review-action@a1d282b36b6f3519aa1f3fc636f609c47dddb294  # v5.0.0` in `.github/workflows/ci-required.yml`; resolution evidence in `missions/task-2549/CP-1.md` | PASS |
| `.github/dependabot.yml` weekly, exactly npm + github-actions, minimal | `.github/dependabot.yml`; Dependabot already produced live security-update PRs `oxtan-maker/parallix#1`, `#2` after settings enablement | PASS |
| Dependency graph, Dependabot alerts, Dependabot security updates enabled | `GET .../vulnerability-alerts` → 204; `GET .../automated-security-fixes` → `{"enabled": true, "paused": false}`; `GET .../dependency-graph/compare/...` → HTTP 200, all recorded in `missions/task-2549/CP-3.md` | PASS |
| Disposable live negative proof + cleanup | GHSA-325j-mg25-8q58, yayson@4.2.0, PR #3, failed run 35739493111, PR closed + branch deleted, `grep -c yayson package.json package-lock.json` → 0/0 on the committed tree, recorded in `missions/task-2549/CP-3.md` | PASS |
| Mission-declared gates pass on the final tree | `./scripts/verify-local.sh all` (exit 0, 2910/2910), `./scripts/verify-local.sh static-analysis` (all stages passed), plus `./scripts/verify-local.sh docs` (exit 0) | PASS |
| Integrated TASK-2549 SHA completes its real `github-publish/<sha>` run with green Dependency Review + CI/coverage/Sonar | Pending Parallix lifecycle: integration commit is created by `px integrate`, which this execution may not run (harness contract); the run is triggered by Parallix's publication of that exact SHA to `refs/heads/github-publish/<sha>` per `ADR 0058`; verification checklist recorded above | PENDING (external: Parallix lifecycle step) |

Next action: Parallix lifecycle (review → integrate → publish `refs/heads/github-publish/<integrated-sha>`); once the run exists, confirm it against the verification checklist above — expected: trusted-base step emits full `origin/main` SHA (≥ `4acc5fca37cc7ab8b386789bb95e64e61444379e`), Dependency Review green (no new vulnerable dependencies in this mission's delta), test/coverage/Sonar continue, `ci-required` green; record the run URL as the final Goal Check evidence.
