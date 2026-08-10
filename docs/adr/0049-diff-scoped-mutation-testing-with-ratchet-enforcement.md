# ADR 0049: Diff-scoped mutation testing with ratchet enforcement

Status: Accepted
Date: 2026-07-02

Related: ADR 0041 (integration pipeline gates), task-1269 (mutation testing mission), task-1353 (static-analysis stage), task-1354 (regression-test-first)

## Context

`src/adapters/verification/coverage-gate.ts` enforces 90% **line** coverage on
`src/**/*.ts`, and is currently the only automated test-quality
gate in parallix. Line coverage answers "did any test execute this line?",
not "does any test notice if this line's behavior breaks?". Those are
different questions, and the gap between them matters more than it used to:

- arxiv 2510.09907 and earezki.com ("Tests Are Everything in Agentic AI")
  both report that AI-generated test suites reach ~20% **mutation** score
  even while achieving high line coverage — i.e. roughly 80% of injected
  bugs survive despite the tests "passing." A test that calls a function and
  asserts nothing about its output (or asserts something trivially true,
  like `typeof fn === 'function'`) fully satisfies a line-coverage gate
  while validating nothing.
- TASK-1354 (regression-test-first) requires each mission to add a
  regression test for the bug it fixes. Line coverage cannot tell the
  difference between a regression test that actually pins the fixed
  behavior and a shallow one that merely calls the code path. Mutation score
  can: a shallow test lets Stryker's synthetic mutants survive.
- High-velocity AI-driven development amplifies this specific failure mode,
  because an agent under time pressure has every incentive to write the
  minimal test that turns the coverage gate green, and no signal currently
  tells it that test validated nothing.

Mutation score is the direct complement, not a replacement, for line
coverage: line coverage is necessary (untested code can't be assessed at
all) but not sufficient (executed code isn't necessarily *verified*).
Task-1269 keeps the existing 90% line-coverage gate unchanged and adds
mutation score as a second, orthogonal signal.

**Scope limitation:** Mutation testing via `verify-local.sh mutation-gate` is
**parallix-internal-only**. It exercises StrykerJS against `src/` source files
and their test files within the parallix development checkout. It does not and
cannot run when parallix is used to develop a different repository — the gate
targets parallix's own test suite and source tree. This is not a feature
delivered to parallix users; it is a development-quality gate for the parallix
project itself. It runs as part of parallix's own integration pipeline
(`config/integration-pipelines.json`) but cannot meaningfully execute on an
arbitrary user repository.

## Options Evaluated

| Option | Scope | Framework | Ratchet | Fit |
|--------|-------|-----------|---------|-----|
| **A. Full-repo mutation testing on every gate** | All `src/` files | StrykerJS + `node --test` | No (absolute floor) | Low — thousands of mutants, far outside runtime budget |
| **B. Diff-scoped mutation testing with ratchet** | Changed files + direct callees | StrykerJS + `node --test` | Yes (per-file baseline) | High — bounded target set, additive enforcement |
| **C. No mutation testing** | — | — | — | Low — line coverage alone is insufficient for AI-generated tests |

### Option A: Full-repo mutation testing

Run StrykerJS against the entire `src/` tree on every gate invocation.

**Pros:**
- Maximum mutation coverage
- No scoping logic needed

**Cons:**
- Thousands of mutants across ~120 `src/` files
- Runtime far exceeds the 60s pre-integrate budget (TASK-1133)
- Forces a big-bang baseline backfill before any mission could land
- Conflicts with the mission's own Out-of-Scope declaration ("Full-repo mutation testing (too slow)")

### Option B: Diff-scoped mutation testing with ratchet (chosen)

Compute the mutation target set as changed files between the mission branch
and its base branch, plus their direct (depth-1) local callees. Enforce a
per-file ratchet against `config/mutation-baseline.json`.

**Pros:**
- Bounded target set (typically 1-10 files, ~27s on small diffs)
- Additive enforcement: no mission is asked to fix mutation debt it didn't create
- Reuses `coverage-gate.ts` shape (drop-in sibling gate)
- Catches the "AI-generated shallow test" failure mode line coverage cannot see

**Cons:**
- Regex-based callee resolution can miss dynamic requires and re-exports
- Conservative failure mode is under-scoping, not false rejection
- A file's ratchet is dormant until its second touch (incremental baseline seeding)

### Option C: No mutation testing

Keep the existing 90% line-coverage gate as the sole automated quality signal.

**Pros:**
- No new tooling, no new dependencies, no new runtime cost
- Simple, well-understood

**Cons:**
- Does not catch the "shallow reproduction test" failure mode
- AI agents have no signal that a test validated nothing
- Confirmed by research: ~80% of injected bugs survive with high line coverage

## Decision

**Choose Option B: Diff-scoped mutation testing with ratchet enforcement.**

**Rationale:**

- **Bug-reduction necessity:** Line coverage alone is demonstrably insufficient
  for AI-generated test suites. Mutation score is the direct complement, not
  a replacement. TASK-1353 (static-analysis stage) and TASK-1354
  (regression-test-first) already landed; mutation scoring is the next layer
  to prevent shallow reproduction tests from masking real defects.
- **Runtime feasibility:** Diff-scoping keeps the target set bounded. Measured
  ~27s for 2 files with mutant-heavy test files, well under the 60s pre-integrate
  budget. Hub-file diffs (e.g. `handoff.ts`) can push to ~75s — documented as
  a known limitation.
- **Ratchet over absolute floor:** Per-file ratchet against
  `config/mutation-baseline.json` avoids forcing a full-repo backfill.
  Incremental baseline seeding means a file's ratchet activates on its second
  touch, keeping enforcement strictly diff-local.
- **Lifecycle placement:** Pre-integrate (not per-checkpoint). Per-checkpoint
  gates have a sub-30s budget (TASK-1133); a Stryker run on even a minimal
  diff consumes most of that. Pre-integrate gates get a relaxed 60s budget,
  and running mutation testing once per mission aligns with ratchet semantics
  ("did this mission's final diff regress the score").

### Design decisions

**1. Diff-scoped, not full-repo.** The mutation target set is: files changed
between the mission branch and its base branch
(`src/adapters/git/mutation-scoper.ts:getChangedFiles`), plus their **direct** (depth-1)
local callees (`resolveCallees`). Full transitive BFS was found to over-scope
on hub files (e.g. a changed `handoff.ts` pulling in `agents/*`, `review/*`,
`tools/*` into the target set, ballooning from ~15 to ~34 files and ~170s
predicted runtime). Direct-callees-only keeps the target set bounded while
still covering the immediate callers that would propagate a broken change.

Callee resolution is a lightweight regex scan of `require()`/`import ... from`
specifiers, **not** a TypeScript compiler-services pass. The tradeoff: dynamic
`require(x)`, bare package imports, and re-exports through indirection the
regex can't parse are invisible to the scoper. In practice this means the
scoper can under-scope (miss a real callee reached only dynamically) but not
over-scope in a way that breaks anything — a missed callee just means that
file's baseline isn't updated this run, which self-corrects the next time a
mission touches it directly.

Git tracks `.ts` sources under `src/`. The mutation scoper operates on these
`.ts` files directly through `tsx` — no separate compilation step is needed
for the mutation target set.

**2026-07-18 correction (ADR 0044 T4/T5):** `npm run build` emits the ESM
bundle to `build/px.mjs`; the `build/` directory is gitignored. Source files
live in `src/` and are executed directly through `tsx` for testing and
mutation runs.

**2. StrykerJS via the `command` test runner.** `@stryker-mutator/core` has no
dedicated plugin for Node's built-in `--test` runner (confirmed: no
`@stryker-mutator/node-test-runner` package exists on npm). Stryker's built-in
**`command` test runner** — which just runs an arbitrary shell command and
checks its exit code — works with `node --test` out of the box, with
`coverageAnalysis: "off"` (the `command` runner has no per-test coverage hook,
so every mutant reruns the full matched test command). This was verified
end-to-end in CP-1 (`missions/task-1269/CP-1.md`): a strong test scored 100%,
a deliberately shallow test scored 33% with the two surviving mutants printed
directly.

`mutation-gate.ts` invokes `node_modules/.bin/stryker` directly rather than
via `npx stryker` — during POC work, `npx stryker` was observed to sometimes
resolve the unrelated, unmaintained `stryker@1.x` npm package from npx's
global cache instead of the locally installed `@stryker-mutator/core`, because
both publish a `stryker` bin name. Invoking the local binary path removes that
ambiguity entirely.

**Known gotcha (found while writing the CP-5 regression test):** Stryker's
`command` runner spawns `node --test <file>` per mutant, inheriting the parent
process's environment. If `mutation-gate` itself runs from inside an outer
`node --test` process (as its own regression test does, and as it will under
`scripts/verify-local.sh integrate`), `NODE_TEST_CONTEXT` leaks into the nested
invocation and Node treats it as a subtest of the outer run — the outer runner
swallows the nested exit code, so every mutant reports "Survived" regardless
of whether the mutation actually broke anything. `coverage-gate.ts` already
strips `NODE_TEST_CONTEXT` and `NODE_OPTIONS` from its own nested `node --test`
child for the identical reason; `mutation-gate.ts`'s `runStryker()` does the
same. Anyone adding another nested-test-runner integration to this repo should
strip these two vars as a matter of course.

To keep runs fast, `findTestFiles` matches `test/<basename>.test.ts` by naming
convention for each target file and only falls back to the full
`test/*.test.ts` suite (~120 files) when no exact match exists — running the
matched-only suite against 2 real repo files completed in ~27s, well under the
60s/10-file budget from the mission's success criteria.

**3. Ratchet, not absolute floor.** `config/mutation-baseline.json` stores a
per-file mutation score:

```json
{ "filePaths": { "<path>": { "score": <number>, "timestamp": "<ISO date>" } } }
```

A gate run rejects (exit 1) only if a target file's new score is **lower**
than its recorded baseline score. `--threshold <pct>` is available as an
*additional* absolute floor, but the default is no threshold — ratchet-only,
matching the backlog task's explicit design goal: "a mission may not LOWER
the mutation score on the files it touches," not "every file must clear 80%."
This avoids forcing a big-bang backfill across the whole `src/` tree before
any mission could land, and keeps enforcement strictly diff-local.

**Baseline initialization is incremental, not eager.** The mission's CP-4
checkpoint text describes "initializ[ing] `config/mutation-baseline.json`
with current scores for all `src/` files" on first run — but that would
require an eager full-repo mutation pass, which directly conflicts with the
mission's own Out-of-Scope declaration ("Full-repo mutation testing (too
slow; explicitly scoped to mission diff)"). Where a checkpoint's literal
phrasing conflicts with the mission's Scope/Out-of-Scope sections, the latter
takes precedence. The implementation instead seeds each file's baseline entry
the first time that file appears in *any* mission's diff scope: a file with no
prior entry passes the ratchet automatically (there's nothing to regress
against) and its score is recorded then. Practical consequence: a file's
ratchet doesn't start enforcing until its **second** touch by any mission.
This is consistent with the mission's diff-scoped philosophy throughout, and
avoids ever running mutation testing outside a real mission diff.

**Concurrency:** `config/mutation-baseline.json` is a single JSON file with no
locking. Per the mission's stated assumption, this is acceptable for sequential
missions (the repo's current single-writer model); concurrent missions racing
to update the same file's baseline entry could silently overwrite each other's
result. If parallel missions become common, the fix is a single-writer baseline
service or per-mission baseline shards merged at integrate time — out of scope
here.

## Data and Evidence

### 1. POC verification (CP-1)

POC performed in isolated scratch dir (`/tmp/stryker-poc`, not committed):

- `@stryker-mutator/core@9.6.1` installed cleanly on Node 20+ (163 packages, ~6s)
- **Passing case** (strong test asserting `add(2,3) === 5`): mutation score 100.00 (3/3 killed)
- **Failing/surviving case** (weakened test asserting only `typeof add === 'function'`): mutation score 33.33 (1 killed / 2 survived), mutants printed: `BlockStatement`, `ArithmeticOperator`
- Stryker's `command` test runner works with `node --test` out of the box, with `coverageAnalysis: "off"`
- Report format usable for ratchet scoring: `reports/mutation/mutation.json` → `files.<path>.mutants[].status`

### 2. Runtime measurements

- 2 real repo files with mutant-heavy test files: ~27s (well under 60s budget)
- Hub-file diff (changed `handoff.ts` pulling in 12+ direct callees): ~75s predicted (over budget, documented limitation)
- Typical smaller diffs (1-2 non-hub files): well under 60s

### 3. Regression test (CP-5)

`test/mutation-gate-ratchet.test.ts` — strong test scores 100 and seeds the
baseline, then a shallow/weak test (the exact "AI-generated shallow test"
pattern the mission's Why Now section cites) regresses the score and the
ratchet rejects it with exit 1.

### 4. Static analysis gate compliance

`./scripts/verify-local.sh static-analysis` → ALL STAGES PASSED (ESLint clean,
tsc clean, test-hygiene clean)

### 5. Full test suite

`FORCE_COLOR=0 node --import tsx --test test/mutation-gate.test.ts test/mutation-scoper.test.ts test/mutation-gate-ratchet.test.ts` → 18 pass, 0 fail

## Consequences

### Positive

- Catches the specific "AI-generated shallow test" failure mode line coverage
  cannot see, directly demonstrated by the CP-5 regression test (100% → 1 →
  weakened test → ratchet rejects with exit 1).
- Diff-scoped + ratchet keeps the gate local and additive: no mission is ever
  asked to fix mutation debt it didn't create.
- Reuses the existing `coverage-gate.ts` shape (testable `run(args, options)`,
  `--dry-run`, `exitFn` injection) so it's a drop-in sibling gate, not a new
  pattern to learn.
- Integrated into parallix's own integration pipeline
  (`config/integration-pipelines.json`, order 40 between `static-analysis` at
  order 1 and `workflow` at order 50).

### Negative / accepted limitations

- Regex-based callee resolution can miss dynamic requires and re-exports
  (documented above); conservative failure mode is under-scoping, not false
  rejection.
- A file's ratchet is dormant until its second touch (incremental baseline
  seeding).
- No baseline-write concurrency control; assumes sequential missions.
- `coverageAnalysis: "off"` means every mutant reruns the whole matched test
  command rather than only the tests that actually cover that code path —
  slower per-mutant than Stryker's native `mocha`/`jest`/`vitest` plugins,
  but currently the only viable integration with Node's built-in test runner.
- **Hub-file runtime blowup:** While direct-callees-only keeps the target set
  bounded, a single changed hub file (e.g. `handoff.ts` importing from
  `tools/`, `review/`, `core/`) can still pull in 12+ direct callees, pushing
  predicted runtime to ~75s for that specific diff — over the 60s budget. This
  was observed when `src/adapters/cli/commands/handoff.ts` was modified after CP-8 was
  written (the fix for the gate-command parser). Typical smaller diffs
  (1-2 non-hub files) remain well under 60s. The ADR recommends avoiding
  modifications to hub-adjacent files late in a mission without re-verifying
  the runtime budget.
- **`stryker.conf.json` deviation:** The mission Scope section lists producing
  a minimal checked-in `stryker.conf.json`, but the implementation generates
  the config dynamically per-run (`buildStrykerConfig` in `mutation-gate.ts`)
  to accommodate varying target/test subsets. A minimal reference template
  exists at the repo root (`stryker.conf.json`) for manual runs. The dynamic
  approach was chosen because a static `mutate` array would be stale
  immediately after any mission lands.
- **Not wired into `gateMatchesChangedAreas`:** The `mutation` gate in
  `config/integration-pipelines.json` (order 40) is schema-valid and
  order-correct but does not auto-fire via `./scripts/verify-local.sh integrate`'s
  changed-area matcher because `"mutation"` is not a recognized area. The gate
  is fully runnable standalone (`./scripts/verify-local.sh mutation-gate`).
  Wiring it into automatic dispatch would require modifying
  `src/adapters/cli/commands/integrate.ts`, which was forbidden by this mission's Restricted
  Areas.

## Deliverables

1. **Diff scoper:** `src/adapters/git/mutation-scoper.ts` — computes changed files + direct callees
2. **Gate CLI:** `src/adapters/verification/mutation-gate.ts` — StrykerJS runner with `--dry-run`, ratchet enforcement, baseline I/O
3. **Unit tests:** `test/mutation-scoper.test.ts`, `test/mutation-gate.test.ts`
4. **Regression test:** `test/mutation-gate-ratchet.test.ts` — strong test seeds baseline, weak test regresses score, ratchet rejects (exit 1)
5. **Verification script:** `scripts/verify-local.sh` — added `mutation-gate` subcommand (`gate_mutation()`)
6. **Integration pipeline:** `config/integration-pipelines.json` — `mutation` gate at order 40
7. **Dev dependency:** `package.json` — `@stryker-mutator/core`
8. **Reference config:** `stryker.conf.json` — minimal template for manual Stryker runs
9. **ADR:** This document, added to `docs/adr/index.md`

## See Also

- ADR 0041: Integration-time pipeline gates
- ADR 0047: NEL budget (change-size estimation)
- `src/adapters/verification/coverage-gate.ts`: Complementary 90% line-coverage gate (unchanged)
- `src/adapters/git/mutation-scoper.ts`: Diff-scoped callee resolver
- `src/adapters/verification/mutation-gate.ts`: Gate CLI implementation
- `test/mutation-gate-ratchet.test.ts`: Regression test (CP-5)
- `missions/task-1269/MISSION.md`: Mission specification
- `missions/task-1269/CP-1.md`: POC verification
- arxiv 2510.09907; earezki.com, "Tests Are Everything in Agentic AI"

## Reconciliation addendum (2026-07-27, task-2288)

The original decision for diff-scoped mutation testing with ratchet enforcement remains in effect. The mutation scoper now targets TypeScript files directly in the canonical `src/` layers, and the gate executes through `tsx`. The mapping and scope logic live in `src/adapters/git/mutation-scoper.ts`. The diff-scoped + ratchet design, StrykerJS via the `command` runner, and all operational consequences are unchanged.
