# CP-3: Migration and publication proof (task-2223)

## Summary of work done

Extended the 2026-07-11 ADR 0044 update with the verification, publication, and
migration sections, and created the backlog task documents that capture each
migration phase:

1. **Target verification contract**
   (`docs/adr/0044-workflow-distribution-model.md:246`) — four reproducible
   checks replace the mtime guard: V1 clean-checkout build proof
   (`npm ci && npm run build && npm test` from a pristine checkout, with
   `prepack` rebuilding so a stale artifact cannot ship), V2
   reproducible-output check (two clean builds emit identical `dist/` file
   lists), V3 package-content audit (`npm pack --dry-run` vs the §8 table),
   V4 tarball-install smoke (generalizing
   `test/task-1424-post-integrate-publish-reinstall.test.js` and
   `test/package-persistent-data.test.js`). The **temporary migration guard**
   (`docs/adr/0044-workflow-distribution-model.md:271`) keeps the existing
   mtime guard (`lib/core/build-freshness.ts:32-51`) alive through T1–T4 with
   its purpose stated, and names its **removal gate**: T5 may delete it only
   after V1–V4 are wired and passing; earlier deletion is a stop-the-phase
   condition.
2. **Publication proof**
   (`docs/adr/0044-workflow-distribution-model.md:281`) — named steps P1–P10:
   clean checkout, `npm ci`, `npm run build`, `npm test`,
   `npm pack --dry-run` + audit, `npm pack`, temp-prefix install
   (`npm install -g --prefix "$(mktemp -d)" ./magnusekdahl-parallix-*.tgz`),
   `px --version` identity smoke, representative read-only commands
   (`px status`, `px stats`), publish. The artifact inclusion/exclusion table
   (`docs/adr/0044-workflow-distribution-model.md:305`) covers `dist/` JS and
   maps (in), declarations (out, not emitted), all TypeScript sources (out —
   noting today's asymmetry at `package.json:45`), tests (out), dev config
   (out), assets (in), manifest/README/LICENSE/CHANGELOG (in), and operator
   state (out).
3. **Phased migration backlog**
   (`docs/adr/0044-workflow-distribution-model.md:319`) — six ordered,
   review-sized phases, each row carrying dependencies, scope, compatibility
   shim, gates with acceptance evidence (recognized commands:
   `./scripts/verify-local.sh static-analysis`, `npm test`,
   `node test/e2e-mission-lifecycle.test.js`,
   `./scripts/verify-local.sh mutation-gate --dry-run`,
   `npm pack --dry-run`), documentation duty, and a rollback point. Explicit
   deletion timing: `lib/commands/repair-handoff.js` in T4; `build:cjs`, the
   mtime guard, and `PARALLIX_SKIP_BUILD_CHECK` in T5; nothing in T1–T3.
4. **Compatibility and semver impact**
   (`docs/adr/0044-workflow-distribution-model.md:342`) — CLI unchanged;
   package-name resolution unchanged; deep subpath requires declared
   non-public and break at T3 with a stop-and-reassess clause if a real
   consumer surfaces; T3/T5 are MINOR-class, the rest PATCH-class, nothing
   MAJOR.
5. **Backlog task documents created** (recorded at
   `docs/adr/0044-workflow-distribution-model.md:339`):
   - `backlog/tasks/task-2224 - TS-migration-phase-T1-test-typecheck-project-tsconfig.test.json-checked-JavaScript.md`
   - `backlog/tasks/task-2225 - TS-migration-phase-T2-packageRoot-asset-resolution-hardening.md`
   - `backlog/tasks/task-2226 - TS-migration-phase-T3-npm-package-flips-to-dist-layout.md` (depends: task-2225)
   - `backlog/tasks/task-2227 - TS-migration-phase-T4-repo-runtime-tests-and-gates-move-to-dist.md` (depends: task-2226)
   - `backlog/tasks/task-2228 - TS-migration-phase-T5-retire-build-cjs-and-mtime-freshness-guard-wire-clean-build-verification.md` (depends: task-2227)
   - `backlog/tasks/task-2229 - TS-migration-phase-T6-optional-TypeScript-test-authoring.md` (depends: task-2224, task-2227; optional/low)

No runtime, test, package, or configuration files were touched; the diff
remains ADR + checkpoint + backlog documents only.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: dated ADR 0044 update + index entry | Update at `docs/adr/0044-workflow-distribution-model.md:7`; index refresh in CP-4 | PARTIAL (index in CP-4) |
| SC2: current-state diagram + evidence table | `docs/adr/0044-workflow-distribution-model.md:18-67` | PASS (CP-2) |
| SC3: measurable end-state targets | `docs/adr/0044-workflow-distribution-model.md:69-78` | PASS (CP-2) |
| SC4: scored matrix, winner, dual-package rejected | `docs/adr/0044-workflow-distribution-model.md:80-122` | PASS (CP-2) |
| SC5: closed end-state contract | `docs/adr/0044-workflow-distribution-model.md:124-185` | PASS (CP-2) |
| SC6: test contract | `docs/adr/0044-workflow-distribution-model.md:187-215` | PASS (CP-2) |
| SC7: asset resolution without CWD | `docs/adr/0044-workflow-distribution-model.md:217-244` | PASS (CP-2) |
| SC8: mtime replacement + temporary guard with removal gate | `docs/adr/0044-workflow-distribution-model.md:246-279` (V1–V4; guard purpose + T5 removal gate); current guard at `lib/core/build-freshness.ts:32-51` | PASS |
| SC9: publication proof steps + inclusion/exclusion table | `docs/adr/0044-workflow-distribution-model.md:281-317` (P1–P10 incl. `npm pack --dry-run`, temp install, `px --version`; table rows for TS sources, tests, operator state, declarations, maps, assets); base tests `test/task-1424-post-integrate-publish-reinstall.test.js`, `test/package-persistent-data.test.js` | PASS |
| SC10: ordered phases with dependencies, shims, deletion timing, gates, docs duties, evidence, rollback | `docs/adr/0044-workflow-distribution-model.md:319-340` (T1–T6 table + deletion-timing paragraph + backlog task IDs); no phase implemented in this mission | PASS |
| SC11: ADR/README/freshness reconciliation | Reconciliation section lands in CP-4; conflict map in CP-1 §2 (ADR 0037, ADR 0046, ADR 0049, `README.md:194-206`, `docs/authority-reference.md:313-360`) | PENDING (CP-4) |
| SC12: dated official-source citations | Inline citations present (§3/§7 of the update); consolidated references section lands in CP-4 | PARTIAL (CP-4) |
| SC13: diff limited to permitted documents | `git diff --name-only main`: `docs/adr/0044-workflow-distribution-model.md`, `missions/task-2223/CP-*.md`, `backlog/tasks/task-222[4-9]*.md` only | PASS (so far) |
| SC14: docs gate + link checks recorded | Runs and results recorded in CP-4; command `./scripts/verify-local.sh docs` (`scripts/verify-local.sh:192-210`) | PENDING (CP-4) |

Next action: Execute CP-4 — add the reconciliation section (ADRs 0037/0046/0049, ADR 0044's earlier stance, README development guidance, build-freshness documentation: aligned / superseded-in-a-named-respect / deferred-to-phase) and the consolidated ecosystem-references section with access dates to the ADR update, refresh the `docs/adr/index.md` entry for ADR 0044, run `./scripts/verify-local.sh docs` plus the README relative-link consistency check, verify `git diff --name-only` stays within the permitted set, and write the final SC1–SC14 Goal Check.
