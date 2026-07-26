# Mission: Make Graphify usable from Codex (task-2297)

## Goal
Ensure the repository's Graphify workflow can be invoked by Codex from a mission worktree without resolving `graphify-out/graph.json` from a different task worktree or failing before it can provide actionable graph context.

## Why Now
The current Graphify invocation for Codex fails with `graph file not found` under the prior task worktree (`parallix-task-2294`) while operating in task-2297. This prevents Codex from following the repository's graph-first workflow and makes codebase exploration unreliable for missions that depend on it.

## Refinement Signals
- Predicted NEL bucket: Small (0–80)
- Confidence: High
- Selection note: The observed cross-worktree graph path failure gives a bounded reproduction and a clear verification target.
- Main drivers: Codex command working-directory resolution, Graphify graph discovery, and regression coverage for task worktrees.

## Scope
- Add a focused regression test under `test/` that invokes the Codex-facing Graphify query path from a task worktree whose sibling task worktree contains the stale graph location reported in the backlog.
- Correct the repository-owned Graphify/Codex integration so graph discovery and query execution resolve from the active worktree rather than a remembered or hard-coded sibling worktree.
- Preserve the existing Graphify behavior when `graphify-out/graph.json` is present in the active worktree and provide an actionable result when it is absent.
- Update workflow documentation only where it describes the corrected Codex Graphify invocation or graph-location behavior.

## Out of Scope
- Rebuilding, repairing, or checking in a generated `graphify-out/graph.json` for any mission worktree.
- Changing Graphify's extraction, clustering, visualization, or semantic-extraction algorithms.
- Broad changes to Codex agent delegation, model configuration, or unrelated mission workflow commands.
- Implementing fixes during this draft phase.

## Success Criteria
> **Falsifiability rule (ADR 0039 Part 2):** Each criterion must be falsifiable. Forbidden: subjective adjectives ("easy, fast, simple, intuitive, user-friendly, responsive, quick, efficient" without an attached metric) and vague quantifiers ("multiple, several, some, many, few, various"). For refactor / condense / migration missions, the criterion must enumerate the specific elements (rules, files, behaviours) that must survive — generic phrases like "preserve critical content" are not sufficient.

- A regression test at `test/task-2297-graphify-codex-repro.test.js` reproduces the backlog scenario: while the active task worktree has no graph, an attempted Graphify query must not look for `graphify-out/graph.json` beneath `parallix-task-2294`; the test is red at the mission parent commit and green after the fix.
- The Codex-facing Graphify query path resolves the active repository/worktree before locating `graphify-out/graph.json`; it never reuses a graph path belonging to a different task worktree.
- When the active worktree lacks `graphify-out/graph.json`, the command returns an actionable active-worktree result instead of an uncaught `graph file not found` failure that references another worktree.
- When the active worktree contains `graphify-out/graph.json`, the existing Graphify query command still runs against that active-worktree graph.
- The final checkpoint's `## Goal Check` table records one accepted evidence reference for each criterion, including the focused regression test and the required verification command.

## Risks and Assumptions
- Assumption: the stale `parallix-task-2294` path originates in repository-owned Codex/Graphify integration rather than a host-level installation; implementation must confirm this before changing shared tooling.
- Risk: the Graphify executable may retain state outside this repository. If reproduction shows the defect is solely host configuration, stop and report the external ownership instead of changing unrelated repository code.
- Risk: changing query initialization could regress normal graph queries. The focused active-graph scenario and the repository verifier must remain green.

## Checkpoints
Reproduction-Test: test/task-2297-graphify-codex-repro.test.js

- CP 1: Author `test/task-2297-graphify-codex-repro.test.js` before any fix. It must simulate invocation from the task-2297 worktree when the only stale graph reference is under `parallix-task-2294`, and assert that graph lookup is anchored to the active worktree rather than the sibling path. The assertion must fail at the mission parent commit (red) and pass after the implementation (green).
- CP 2: Trace the Codex-facing Graphify query initialization to identify the repository-owned source of worktree/path selection, then implement the smallest correction that anchors graph discovery to the active worktree and handles a missing active graph actionably.
- CP 3: Run the focused reproduction test and the required repository gate; record criterion-by-criterion evidence in the final checkpoint document.

### Checkpoint Documentation Requirements
Every checkpoint document (CP-N.md) MUST include:
- A summary of work done
- The exact heading `## Goal Check`
- The exact 3-column pipe-delimited table header `| Criterion | Evidence | Status |`
- At least one evidence row per criterion using verifiable references. Parallix already accepts:
  1. **File:line references** — e.g., `lib/commands/handoff.ts:292` (must point to an existing file and line)
  2. **Test names** — e.g., `"real custom-agent launcher smoke: full lifecycle with hello-world task (SC3/SC4/SC5/SC6/SC7)"` (must match a test name in the repo)
  3. **Test file paths** — e.g., `test/e2e-real-agent-smoke.test.ts` (must be an existing test file)
  4. **ADR references** — e.g., `ADR 0048` (must correspond to an existing file under `docs/adr/`)
  5. **Recognized repo commands or paths** — e.g., `` `npm test -- test/repair-handoff.test.ts` ``, `` `px review <slug> --verify` ``, or `` `./scripts/verify-local.sh all` ``
- Raw `stat`/`ls` output or generic prose alone is not enough. It may appear as supplemental context only when paired with an accepted file:line reference, exact test name, ADR reference, test file path, or recognized repository command/path above.
- A non-generic `Next action:` line at the bottom

Example Goal Check table:

| Criterion | Evidence | Status |
|---|---|---|
| Draft prompt defines checkpoint evidence rules | `prompts/draft.md:28` | PASS |
| Repair loop has targeted incomplete-evidence coverage | `test/repair-handoff.test.ts`, `"buildRelaunchPrompt returns string containing Goal Check table and mission slug"` | PASS |
| Verification gate ran | `./scripts/verify-local.sh docs` | PASS |

## Gates
- [ ] ./scripts/verify-local.sh all

## Restricted Areas
- Do not modify generated `graphify-out/` artifacts to mask the defect.
- Do not alter host-global Codex or Graphify installation state unless the investigation proves repository ownership is impossible; report that condition under Stop Rules instead.
- Do not change unrelated agent delegation, extraction, clustering, visualization, or mission lifecycle behavior.

## Stop Rules
- Stop if the red reproduction shows that the stale path is produced only by host-global state outside the repository; document the exact external owner and reproduction evidence rather than applying a repository workaround.
- Stop if correcting active-worktree resolution requires changing Graphify extraction, clustering, or visualization semantics; split that work into a follow-up mission.
- Stop if the focused regression test cannot be made deterministic with mocked filesystem/process boundaries; redesign the seam before modifying production behavior.
