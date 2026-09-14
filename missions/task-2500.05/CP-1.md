# CP-1 — Inspect Mission 4 CI-tier contract, engine, and github-publish ref producer

## Work Done

Inspected the Mission 4 CI-tier contract, `package.json` engine / `test:ci`
script, and the `github-publish` ref producer before writing the workflow.

**Mission 4 CI-tier contract.** `npm run test:ci` is the GitHub-safe, clean-runner
verification authority. From `package.json`:

```
"test:ci": "npm run typecheck && npm run build && npm test && npm run test:integration:ci && npm run test:bundle && npm run test:package-content",
```

`test:integration:ci` (`--integration-ci`) is the GitHub-safe tier per
`test/lib/test-categories.ts` (`integrationCategoryOf` returns `'integration-ci'`
for the CI list); it crosses real processes/Git/SQLite/packaging but runs on a
clean hosted runner with no local AI or Forgejo. This matches the mission
Assumption that Mission 4's `test:ci` remains the clean-runner authority.

**Engine + install determinism.** `package.json` `"engines": { "node": ">=22.23.1" }`.
A lockfile `package-lock.json` is present, so `npm ci` is the lockfile-respecting
deterministic install. Local Node is v24.15.0 (satisfies `>=22.23.1`).

**github-publish ref producer.** The `github-publish` provider adapter is
`external-pending` / not shipped in this release
(`src/application/services/integration-dispatch.ts`; `src/domain/integration.ts`
lists `github-publish` in `INTEGRATION_MODES`). No source file names a concrete
verification branch. Parent-mission evidence in `docs/adr/0045-parallax-branch-model.md`
states github-publish "integrates locally and continues developing while GitHub
verifies the exact resulting commit, then publishes it to the protected primary
branch." The github-publish verification ref is therefore NOT `main`: ADR 0045
states verification happens before publishing, and github-publish is unimplemented
in this release. The concrete verification ref is not established and is deferred
to `task-2500.06`; the workflow must still checkout the event's exact `github.sha`
(holds for any trigger).

## Recorded decisions (for CP-2)

| Item | Value | Basis |
|---|---|---|
| PR target branch | `main` (protected primary) | ADR 0045 trunk-based model |
| Publication-ref trigger | `push` to `main` (provisional real trigger only; not a claimed github-publish ref — ref deferred to `task-2500.06`) | ADR 0045 |
| Literal job name | `ci-required` | SC1 / mission scope |
| Node | `>=22.23.1` (setup-node `node-version: '22'`) | `package.json` engines |
| Install | `npm ci` | `package-lock.json` present |
| Cache | `npm` cache keyed on `package-lock.json` hash | Risk: lockfile drift |
| Permissions | `contents: read` only | SC4 |
| Concurrency | cancel-in-progress on `pull_request` group only; push/main runs not cancelled | SC5 |
| Verification command | exactly `npm run test:ci` | Mission 4 contract |

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| CP-1: contract/engine inspected | `package.json` `test:ci` script (line 55); `package.json` `engines.node >=22.23.1`; `docs/adr/0045-parallax-branch-model.md` github-publish→protected-primary (verification *before* publish) | PASS |
| Lockfile present for `npm ci` | `package-lock.json` exists | PASS |
| PR target established | ADR 0045 trunk-based model → trigger `pull_request` on `main` | PASS |
| Publication ref established | DEFERRED — ADR 0045 says github-publish publishes *after* verification, so `main` is not the verification ref; concrete ref deferred to `task-2500.06` | |

## Next action:
Write `.github/workflows/ci-required.yml` with `ci-required` job, setup-node `22`, `npm ci` with lockfile-keyed cache, `contents: read`, PR-only concurrency, and `npm run test:ci`; then validate syntax and run `./scripts/verify-local.sh all`.
