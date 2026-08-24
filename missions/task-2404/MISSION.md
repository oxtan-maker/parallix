# Mission: Establish repeatable Parallix runtime performance benchmarks (task-2404)

## Goal
Deliver a small, reproducible Node-based benchmark harness that measures Parallix runtime behavior on controlled fixtures: `px --version` cold start, `px status <slug>`, `px stats`, BoardProjection construction, and BoardProjection scaling from a small to a materially larger mission set. The harness must report robust elapsed-time summaries, environment metadata, and structural work counters where benchmark-only seams can expose them, so later mission trees can be compared without changing benchmark logic.

## Why Now
TASK-2400 through TASK-2402 may change runtime behavior. Establishing a stable baseline before optimization work gives later decisions evidence about latency, startup composition imports, and scaling costs, while keeping this mission free of production-performance changes.

## Refinement Signals
- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: activate as-is
- Main drivers: controlled repository fixtures; child-process timing outside build cost; BoardProjection scale data; benchmark-only counters for Git, SQLite, and task-document reads; stable machine-readable or terminal output.

## Scope
- Add a benchmark harness and controlled representative fixture data that can run against the current tree and later integrated trees without modifying the benchmark’s measurement logic.
- Measure cold `px --version`, `px status <slug>`, `px stats`, one BoardProjection build at a representative mission count, and BoardProjection builds at both a small and a materially larger mission count.
- Build Parallix before timed measurements, use warmups plus repeated samples, and report median and tail elapsed-time values with sufficient machine and runtime metadata to interpret a run.
- Capture available deterministic counters through existing seams or benchmark-only instrumentation: Git subprocesses, `git worktree list` calls, SQLite queries, and task-document filesystem reads for the relevant benchmark paths.
- Include a focused startup measurement that distinguishes the CLI composition-root/module-import contribution from process startup sufficiently to inform a later static-import decision.
- Add fast, isolated tests for harness behavior, fixture control, result aggregation, and counter reporting; mock external dependencies so tests never contact Forgejo or invoke expensive real agents.

## Out of Scope
- Lazy-loading CLI commands, changing static command imports, or otherwise optimizing CLI startup.
- Rewriting production algorithms, adding caches, changing Board behavior, or changing production hot paths based on benchmark observations.
- Always-on production telemetry or instrumentation used solely by the benchmark.
- Publishing a permanently authoritative Markdown report of machine-specific benchmark numbers.
- Benchmarking Parallix build time as part of a runtime scenario’s timed region.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A documented benchmark command runs the five named scenarios against controlled fixtures and can be rerun on a later tree without edits to harness source or fixture definitions.
- Every elapsed-time scenario performs at least one warmup and at least five timed samples, excludes the Parallix build from its timed region, and emits median plus p95 (or the maximum when fewer than 20 samples are configured) in a machine-readable result.
- Benchmark output identifies the operating system, CPU model when available, Node version, Parallix revision, sample count, warmup count, fixture scale, and command or module scenario for each result set.
- The `px status <slug>`, `px stats`, and BoardProjection results include Git subprocess count, `git worktree list` invocation count, SQLite query count, and task-document filesystem-read count whenever the corresponding operation is exercised; unavailable counters are explicitly reported as unavailable rather than silently omitted.
- BoardProjection output compares a small fixture and a larger fixture with at least a 10:1 mission-count ratio, records the exact counts, and makes the per-build elapsed-time and available work-counter growth inspectable.
- Startup output includes separate evidence for cold `px --version` execution and CLI composition-root/module loading, allowing a later mission to determine whether static command imports are a material cold-start contributor without this mission changing import strategy.
- Focused automated tests cover result-summary calculation, fixture-scale selection, and counter collection/reporting, with no focused or unannotated skipped tests.
- `./scripts/verify-local.sh all` completes successfully on the final tree.

## Risks and Assumptions
- Wall-clock timing varies by host load, filesystem state, and process scheduling; medians, tail values, sample counts, environment metadata, and deterministic counters reduce—but do not remove—that variance.
- Existing seams may not expose every requested counter. Benchmark-only instrumentation is permitted only when it is off normal production paths and leaves runtime behavior unchanged.
- Controlled fixtures must be representative enough to exercise real status, stats, Git worktree, task-document, SQLite, and BoardProjection paths while staying small enough for fast local runs.
- Cold-start measurements can be distorted by prior process or filesystem cache state; the harness must state its cold-run procedure and retain raw samples in generated output.
- The benchmark harness may require a built artifact; that prerequisite must occur before timing and be stated by the runnable benchmark command or its documented setup.

## Checkpoints
- CP 1: Design the controlled fixture model, benchmark command interface, output schema, and counter-collection seams. Record how each required scenario excludes build cost and how cold-start conditions are established.
- CP 2: Implement the benchmark runner, fixtures, BoardProjection scale cases, summary statistics, environment metadata, and available structural counters. Run the harness against the mission tree and preserve generated evidence outside live authored documentation.
- CP 3: Add focused isolated tests, validate reruns against an unchanged harness definition, assess static CLI command-import contribution from the captured startup measurements, and run the required verification gate.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- Start each evidence row with durable, verifiable evidence Parallix recognizes today: exact benchmark or test names, ADR references, test file paths, and recognized repository commands or paths such as `npm ...`, `node ...`, `git ...`, `px ...`, or `./...`. File:line references are accepted parenthetically when necessary but discouraged because line numbers rot.
- Use the exact heading `## Goal Check` followed by the exact three-column pipe table `| Criterion | Evidence | Status |`.
- Include one row for every Success Criterion. Cite the benchmark command and generated result path for scenario coverage, warmups/samples, summary statistics, metadata, counters, BoardProjection scale ratio, and startup import evidence; cite exact focused test names and test paths for automated coverage; cite `./scripts/verify-local.sh all` for the integration gate.
- Explain which requested counters are available or unavailable and link that statement to the benchmark output path or an exact test name; do not treat raw terminal observations as proof.
- Raw `stat`/`ls` output or generic prose alone is not enough. It may be supplemental, but must be paired with an accepted command, exact test name, ADR reference, or repository path above.
- Add a concise work summary and end with a concrete `Next action:` line tied to the next checkpoint or handoff.

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Production CLI composition and command-loading behavior: measure it, but do not introduce lazy imports or alter import topology.
- Production BoardProjection logic, status/stat behavior, cache behavior, and repository workflow behavior: no optimization or semantic change is authorized.
- Normal production telemetry and always-on instrumentation: benchmark counters must be isolated to the harness or explicitly benchmark-only seams.
- Live authored documentation: do not add volatile machine-specific result tables; retain results as generated benchmark output and checkpoint evidence.

## Stop Rules
- Stop and request direction if a required scenario cannot be made controlled without changing production behavior, adding always-on telemetry, or depending on a real Forgejo service.
- Stop and request direction if reliable counter collection would require invasive production instrumentation rather than an existing seam or benchmark-only mechanism.
- Stop and request direction if the benchmark must modify its own source or fixture definition to compare a later tree, because that invalidates the baseline-comparison goal.
- Stop and request direction if no fixture can exercise a required path within a practical local run while keeping unit tests fast and dependency-mocked.
