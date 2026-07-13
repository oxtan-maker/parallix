# CP-2: Alternatives and decision (task-2223)

## Summary of work done

Added the dated 2026-07-11 update to `docs/adr/0044-workflow-distribution-model.md`
(new section at `docs/adr/0044-workflow-distribution-model.md:7`) containing:

1. **Current state** (`docs/adr/0044-workflow-distribution-model.md:18`) — the
   two-output-layout architecture diagram and the full evidence inventory table
   from CP-1 (package manifest, files allowlist, the single tsconfig, build
   scripts, ESLint, unit/E2E runners, freshness guard, package-content tests,
   coverage, mutation testing, entry points, tracked generated JS, asset
   resolution, import convention, direct source execution), each row citing a
   repository file or command.
2. **Measurable end-state goals G1–G8**
   (`docs/adr/0044-workflow-distribution-model.md:69`) — one authoritative
   source tree (tracked compiled runtime JS count = 0), clean-build
   reproducibility (`npm ci && npm run build && npm test` from a fresh clone),
   generated output confined to gitignored `dist/`, type coverage extended to
   `test/**/*.js`, `exports`-enforced public API boundary, exact
   `npm pack --dry-run` contents, published source maps, and named local
   feedback commands.
3. **Scored decision matrix**
   (`docs/adr/0044-workflow-distribution-model.md:80`) — NodeNext ESM→`dist/`
   (43), **CommonJS→`dist/` (63, winner)**, dual-package/bundled (30), scored on
   compatibility, toolchain complexity, package correctness, debugging,
   migration cost, and local feedback, with weights justified by the observed
   compatibility mass (148 CommonJS test files, the CommonJS-only `--require`
   preload at `test/run-default-tests.js:14`, `require()` couplings at
   `scripts/verify-local.sh:76` and `package.json:53`, the compiled-JS mutation
   scoper at `lib/commands/mutation-gate.ts:118`). The dual-package hazard is
   named against the Node.js packages documentation and dual output is
   **rejected** — no consumer is evidenced, and discovery of one is recorded as
   a stop-and-reassess condition. ESM is rejected (not left ambiguous), with a
   future flip permitted only through a further dated ADR update.
4. **Accepted end-state contract**
   (`docs/adr/0044-workflow-distribution-model.md:124`) — the authoritative
   tree; explicit `"type": "commonjs"`; ESM `import` syntax with `.js`-extension
   specifiers (labelled an ecosystem requirement under NodeNext, per `px.ts:5`);
   `main`/`bin`/`exports` all pointing into `dist/`; two compiler projects
   (`tsconfig.json` emit, `tsconfig.test.json` check-only); declarations not
   published (labelled repository preference); source maps emitted and shipped
   with `process.setSourceMapsEnabled(true)` at the entries; shebang contract;
   `dist/` clean-output ownership incl. deletion of the one tracked sibling
   `lib/commands/repair-handoff.js` and retirement of the duplicated ignore
   globs (`.gitignore:15-25`, `eslint.config.mjs:9-22`); `tsx`-based
   direct-source development path.
5. **Test contract** (`docs/adr/0044-workflow-distribution-model.md:187`) —
   checked JavaScript via `tsconfig.test.json` (conversion rejected on
   migration cost; TS test authoring deferred to optional phase T6);
   `node:test` retained for unit (`npm test`) and E2E
   (`node test/e2e-mission-lifecycle.test.js`,
   `node test/e2e-real-agent-smoke.test.js`); coverage
   (`npm run test:coverage`) and the ADR 0049 mutation ratchet retained with
   the scoper repointed to `dist/` in phase T4; direct source execution =
   `npx tsx px.ts <command>` wrapped as `npm run dev`.
6. **Asset resolution contract**
   (`docs/adr/0044-workflow-distribution-model.md:217`) — assets stay at the
   package root and are never copied into `dist/`; one `packageRoot()` helper
   (walk up from `__dirname` to the parallix `package.json`) replaces
   depth-coupled arithmetic like `lib/commands/draft.ts:17-18`; CWD-dependent
   asset lookup is explicitly prohibited (`process.cwd()` identifies the target
   repository only).

The `Last updated:` metadata line was refreshed
(`docs/adr/0044-workflow-distribution-model.md:5`); the 2026-06-22 update
(`docs/adr/0044-workflow-distribution-model.md:246`) and all historical
sections below it are byte-for-byte unchanged.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| SC1: dated ADR 0044 update + index entry | Update present at `docs/adr/0044-workflow-distribution-model.md:7`; `docs/adr/index.md` refresh lands in CP-4 | PARTIAL (index in CP-4) |
| SC2: current-state diagram + evidence table covering all named surfaces | `docs/adr/0044-workflow-distribution-model.md:18-67` (diagram + 16-row table citing `package.json:34-49`, `tsconfig.json:19`, `eslint.config.mjs:9-22`, `test/run-default-tests.js:7-20`, `lib/core/build-freshness.ts:32-51`, `lib/commands/mutation-gate.ts:118-121`, `test/package-persistent-data.test.js`, `.gitignore:15-25`, `px.ts:1`, `lib/commands/draft.ts:17-18`) | PASS |
| SC3: measurable end-state targets | `docs/adr/0044-workflow-distribution-model.md:69-78` (G1–G8: source tree, clean build, output separation, test typing, API boundary, artifact contents, source maps, feedback commands) | PASS |
| SC4: scored 3-model matrix, one winner, dual-package rejected | `docs/adr/0044-workflow-distribution-model.md:80-122` (weighted totals 43/63/30; winner B; hazard cited to Node.js packages doc; no-consumer evidence; stop-and-reassess condition) | PASS |
| SC5: end-state contract with no open options | `docs/adr/0044-workflow-distribution-model.md:124-185` (tree, module format, specifier convention, `type`/`main`/`bin`/`exports`, compiler projects, declaration policy, source-map policy, clean-output ownership, dev path — each singular) | PASS |
| SC6: test contract | `docs/adr/0044-workflow-distribution-model.md:187-215` (unit/E2E/coverage/mutation accounted; checked-JS decision; `tsconfig.test.json`; `npx tsx px.ts` dev execution) | PASS |
| SC7: asset resolution without CWD dependence | `docs/adr/0044-workflow-distribution-model.md:217-244` (`packageRoot()` rule for `prompts/`, `templates/`, `config/`, docs, executable scripts; explicit CWD prohibition) | PASS |
| SC8: replacement for mtime freshness | Designed in CP-3; current guard evidenced at `lib/core/build-freshness.ts:32-51` | PENDING (CP-3) |
| SC9: publication proof + inclusion/exclusion table | Designed in CP-3; base evidence `test/task-1424-post-integrate-publish-reinstall.test.js` | PENDING (CP-3) |
| SC10: ordered migration phases with gates and rollback | Phases T1–T6 referenced by §4–§6 of the update; full phase table lands in CP-3 | PENDING (CP-3) |
| SC11: ADR/README/freshness reconciliation | Conflict map complete (CP-1 §2); reconciliation section lands in CP-4; ADR 0037, ADR 0046, ADR 0049 | PENDING (CP-4) |
| SC12: ecosystem claims with dated official sources | Hazard/`exports`/NodeNext claims in the new sections carry access date 2026-07-11; consolidated references section lands in CP-4 | PARTIAL (CP-4) |
| SC13: diff limited to ADR, index, checkpoints, backlog docs | `git diff --name-only main` after CP-2: `docs/adr/0044-workflow-distribution-model.md`, `missions/task-2223/CP-1.md`, `missions/task-2223/CP-2.md` only | PASS (so far) |
| SC14: `./scripts/verify-local.sh docs` + link checks recorded | Runs recorded in CP-4; command per `scripts/verify-local.sh:192-210` | PENDING (CP-4) |

Next action: Draft CP-3 — write the verification contract that replaces mtime freshness (clean-checkout build + `npm pack --dry-run` content audit + tarball-install smoke), the named publication-proof steps with the inclusion/exclusion table, and the ordered migration phases T1–T6 with dependencies, compatibility shims, deletion timing for `lib/commands/repair-handoff.js` and `build:cjs`, CI/integration gates, documentation duties, acceptance evidence, and per-phase rollback points; then create the corresponding backlog task documents.
