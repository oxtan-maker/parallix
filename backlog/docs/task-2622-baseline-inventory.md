# TASK-2622.01 — Pinned preIntegration baseline inventory (HISTORICAL ARTIFACT)

> Status: **baseline / historical**. This file records the gate graph, toolchain,
> and selected populations captured on a clean revision BEFORE any test move or
> delete. It is a comparison contract, NOT a live selection authority. Do not
> edit it to reflect a later refactor; capture a new dated artifact instead.

## 1. Pinned clean revision

- Commit: `b3459b62757740a109bc9d1a72b5ed981bda3909`
- Branch: `mission/task-2622.01`
- Working tree clean at capture (`git status --short` empty; 0 uncommitted files).

## 2. Toolchain / Node versions (captured)

- Node: `v24.21.0`
- npm: `11.19.0`
- Nx (global, informational): `v23.2.1` (local: not installed)
- `select_supported_node` in `scripts/verify-local.sh` requires Node major >= 20.

## 3. Exact preIntegration commands (from `workflow.config.json` adapters.gates.preIntegration)

Authority source: `workflow.config.json` → `product.adapters.gates.preIntegration` (ordered):

| key | command | order |
|---|---|---|
| build | `npm run build` | 1 |
| dependency-audit | `npm audit --audit-level=high` | 2 |
| verification | `./scripts/verify-local.sh static-analysis` | 3 |
| unit | `PARALLIX_FAST_UNIT=1 PARALLIX_TEST_COVERAGE=1 npm test -- --unit-test-headroom` | 4 |
| integration-ci | `PARALLIX_TEST_COVERAGE=1 npm run test:integration:ci:prebuilt` | 5 |
| integration-local | `npm run test:integration:local:prebuilt` | 6 |
| coverage-merge | `rm -f coverage/lcov.info && npm run coverage:merge && test -s coverage/lcov.info` | 7 |
| workflow | `node --test --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e-mission-lifecycle.test.ts` | 8 |
| agent-smoke | `node --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e-real-agent-smoke.test.ts` | 9 |
| quality-gate | `npm run sonar` | 10 |

Declared repo gate: `./scripts/verify-local.sh all` (static-analysis + build + unit).

## 4. Selected populations (reconciled against runtime discovery)

- Root-level `*.test.ts` + `test/adapters/**/*.test.ts`, excluding the two
  integration-only files `test/e2e-mission-lifecycle.test.ts` and
  `test/e2e-real-agent-smoke.test.ts` (selected by the tier-selection authority
  in `test/lib/test-tier-selection.ts`, not by glob).
- Test files discovered: **610**
- Task-named test files (`test/task-*.test.ts`): **341**
- Fixtures (`test/fixtures/**`): **31**
- Parameterized `.each`/`.param` suites: 0 explicit `test.each`/`test.param`
  call sites (parameterization expressed via helper-driven loops, not the
  `node:test` `.each` API).

## 5. Coverage emission seams (for LCOV comparison)

- Unit coverage → `coverage/.lcov-unit.info` (V8 native, `PARALLIX_TEST_COVERAGE=1`).
- Integration-ci coverage → `coverage/.lcov-integration-ci.info`.
- Merge → `npm run coverage:merge` = `tsx scripts/coverage-merge.ts coverage/lcov.info coverage/.lcov-unit.info coverage/.lcov-integration-ci.info`.
- Attribution probe: `tools/nx-evaluation/coverage-attribution-probe.json`
  (revision `dcb15e434`, Node 26.10.0).

## 6. Historical outcomes captured (this revision)

- Unit (fast partition, coverage on): passed; 2091 tests / 2091 pass / 0 fail across 43 suites. CPU 441.1s (user 339.72s + system 101.38s), wall 146.99s. Command: `PARALLIX_FAST_UNIT=1 PARALLIX_TEST_COVERAGE=1 npm test -- --unit-test-headroom`.
- Integration-local (prebuilt): 58 tests / 58 pass / 0 fail / exit 0. CPU 84.15s (user 55.28s + system 28.87s), wall 51.66s. Command: `npm run test:integration:local:prebuilt`.
- Integration-ci (prebuilt): 2529 tests / 2492 pass / 11 fail / 26 skip / exit 1. CPU 479.2s (user 336.76s + system 142.43s), wall 224.58s. Command: `PARALLIX_TEST_COVERAGE=1 npm run test:integration:ci:prebuilt`. The 11 fails are environment/tooling dependent (agent CLIs codex/opencode absent from PATH, `require is not defined in ES module scope` under tsx/ESM, `px verify-env` cwd dependency, real npm pack/install) — NOT logic regressions on this revision. (An earlier ENOSPC run at 2491/2443/22 fail was a shared-/tmp tmpfs exhaustion artifact; the authoritative run above was rerun with `TMPDIR` on a large filesystem.)
- coverage-merge (`npm run coverage:merge`): wrote `coverage/lcov.info` 482604 bytes from 2 fragments (unit + integration-ci).
- Workflow E2E (`node --test --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e-mission-lifecycle.test.ts`): 10 tests / 10 pass / 0 fail. CPU 55.5s, wall 143.27s.
- Agent-smoke (`node --import tsx --import ./test/bootstrap-e2e-parallix-home.ts test/e2e-real-agent-smoke.test.ts`): exit 0.
- Host load at capture: 16-core, load avg 9.11/19.65/20.86, mpstat %usr 47.04 %idle 36.66.
- `coverage/.lcov-unit.info` captured: 464578 bytes; `coverage/.lcov-integration-ci.info`: 1784256 bytes.
