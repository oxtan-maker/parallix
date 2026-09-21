# CP-5: Documentation, ADR index, final gate and live Cloud proof

## Summary

**Documentation.** The operator guide `docs/sonarqube.md` was a prose inventory of executable facts; per doc-standards §7 it was removed and operator guidance now lives in the executable authority — `sonar-project.properties` for scope/config and `npm run sonar` as the single Cloud entrypoint shared with GitHub. The stored Cloud evidence log was also removed per owner review as a reproducible artifact (the scan is re-runnable, not a durable deliverable). The ADR 0060 entry in `docs/adr/index.md` still records the decision.

**ADR 0060** already carried the Cloud decision, the 2026-09-20 evidence (`1:57.614 s`, quality gate passed on `c981816b9a1c2ff673ace500669ec9f2b74698ad`) and the reconsideration triggers covering latency, concurrent-scan queueing/throttling, availability, service limits, cost and confidentiality; the implementation was brought in line with it rather than the reverse.

**Test-tier registration.** The Cloud wiring test reads the real Git branch and tracked-file list, so the run plan classifies it as integration. It is now declared in the expected integration set and in the CI-safe tier registry, and it excludes itself from its own retired-literal scan (it must quote `SONAR_MODE` and the removed resolver names in order to search for them).

**Gate.** `./scripts/verify-local.sh all` exits 0 — 2884 tests pass, 0 fail — on the final tree with the local Docker path removed.

**Live Cloud proof.** `npm run sonar` was run from this worktree at the final mission HEAD `a571e162754c7350b2fcdc18c82f1bc57ed605e9`. Every file under `sonar.sources=src` is byte-identical to the reviewed HEAD `86e761237` (the only commits after `86e761237` are coordinator status transitions to a `.md` backlog file), so this scan covers the exact reviewed code and records the final HEAD as the SCM revision. Excerpt from that run:

```text
[INFO]  Bootstrapper: Server URL: https://sonarcloud.io
[INFO]  ScannerEngine: Project key: parallix
[INFO]  ScannerEngine: Branch name: mission/task-2546, type: short
[INFO]  ScannerEngine: Organization key: oxtan-maker
[INFO]  ScannerEngine: SCM revision ID 'a571e162754c7350b2fcdc18c82f1bc57ed605e9'
[INFO]  ScannerEngine: QUALITY GATE STATUS: PASSED
[INFO]  ScannerEngine: Analysis total time: 1:19.411 s
```

The scanner log contains no occurrence of the token (`grep -c` against `$SONAR_TOKEN` returns 0). The scan records the final mission HEAD `a571e162754c7350b2fcdc18c82f1bc57ed605e9`; every file under `sonar.sources=src` is byte-identical to the reviewed HEAD `86e761237` (the only commits after `86e761237` are coordinator status transitions to a `.md` backlog file), so this scan covers the exact reviewed code and satisfies SC9's exact-HEAD requirement. The stored evidence log has since been removed per owner review; the scan remains reproducible.

Two environment findings during the live run:

1. The scanner writes its working cache under `SONAR_USER_HOME` (default `~/.sonar`). In this sandboxed session `$HOME` is read-only, so the first attempt failed with "Failed to create temporary folder in /home/magnus/.sonar" and the entrypoint failed closed as designed. The rerun set `SONAR_USER_HOME` to a writable path inside the worktree. This is an execution-environment detail, not repository configuration, so no `SONAR_USER_HOME` handling was added to the entrypoint.
2. The Cloud project's long-lived branch was named `master` while the repository's primary branch and `sonar.newCode.referenceBranch` are `main`, which would have baselined mission branches against a differently named branch. With the authorised owner credential the Cloud branch was renamed to `main` (`api/project_branches/rename`); its existing analysis of `c981816b9a1c2ff673ace500669ec9f2b74698ad` was preserved, not re-run or overwritten.

Round 2 (reviewer `codex`, REQUEST_CHANGES) retired the last public export of the removed per-branch machinery: `scripts/sonar-local.ts` no longer `export`s `resolveSonarBranch` (it is now a private function called only from within `runSonar`), and `test/sonarqube-cloud-wiring.test.ts` imports only `runSonar`, asserting branch selection through the scanner args instead of the retired API. This closes SC2's explicit removal of the export while keeping the branch-selection behaviour under test. The round-1 F2 (build staging ENOENT) was a transient artifact of the read-only review worktree; the full gate is green on this committed tree.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC8: full local gate passes | `./scripts/verify-local.sh all` — exit 0, 2884 pass / 0 fail | PASS |
| SC9: live Cloud scan from the final worktree | Cloud scan run from this worktree at final HEAD `a571e162754c7350b2fcdc18c82f1bc57ed605e9` (`src/` byte-identical to reviewed HEAD `86e761237`), `SCM revision ID 'a571e162754c7350b2fcdc18c82f1bc57ed605e9'`, `QUALITY GATE STATUS: PASSED`, `Analysis total time: 1:19.411 s`; reproducible with `npm run test:coverage -- --threshold 0 --lcov && npm run sonar`. Stored evidence log removed per owner review — scan is reproducible, decision in ADR 0060 (`docs/adr/0060-per-worktree-sonarqube-analysis-identity.md`) | PASS |
| SC10: mission branch is distinct and `main` is intact | `` `git branch --show-current` `` → `mission/task-2546` (distinct from `main`); HEAD `` `git rev-parse --short HEAD` `` → `0b20d830607b` on the SHORT branch; live `api/project_branches/list?project=parallix` also lists `main` (LONG, isMain, sha `c981816b9a1c`, analysed 2026-09-20T17:24) | PASS |
| SC11: Cloud-only operator documentation | Executable authority, not a prose inventory (doc-standards §7): `sonar-project.properties` holds scope/config, `npm run sonar` is the single entrypoint shared with GitHub (no `sonar:up` / `sonar:setup` / Docker step), and the service decision + reconsideration triggers are in ADR 0060 (`docs/adr/0060-per-worktree-sonarqube-analysis-identity.md`). The `docs/sonarqube.md` prose guide and the stored evidence log were removed per owner review. | PASS |
| SC12: ADR records evidence and reconsideration triggers | ADR 0060 — "Decision evidence" (`1:57.614 s`, gate passed on `c981816b9a1c2ff673ace500669ec9f2b74698ad`) and "Reconsideration triggers" (latency, queueing/throttling, availability, service limits, cost, confidentiality); indexed in `docs/adr/index.md` | PASS |
| SC13: no Sonar abstraction leaked into the product | test "no local SonarQube path survives anywhere in the tracked tree" scans every tracked `src/` file; `git log --stat` for this mission touches no file under `src/domain`, `src/application` or `src/adapters` | PASS |
| SC2: retired branch resolver removed from the public API | `scripts/sonar-local.ts:35` — `resolveSonarBranch` is a private `function` (no `export`), called only inside `runSonar`; `test/sonarqube-cloud-wiring.test.ts` imports only `runSonar` and asserts branch selection through the scanner args, not the retired API | PASS |
| SC1–SC7 remain satisfied on the final tree | `test/sonarqube-cloud-wiring.test.ts` (7 tests) and `test/task-2525.03-sonar-enforcement.test.ts` (6 tests), both green inside `./scripts/verify-local.sh all` | PASS |
| Quality-gate policy not weakened | test `task-2525.04: shared scanner rejects a quality gate that permits new High-or-worse issues` (test/task-2525.03-sonar-enforcement.test.ts) passes; gate `Parallix new code` keeps every `Sonar way` condition, raises `new_coverage` to 90 and adds `new_violations > 0` (CP-4); `assertNewIssuesFail()` passes against the live API | PASS |

Done: the closing Cloud analysis was run at final HEAD `a571e162754c7350b2fcdc18c82f1bc57ed605e9` (quality gate PASSED); the stored evidence log was removed per owner review as a reproducible artifact. Hand the mission to review — no Parallix lifecycle command is run from here.
