# CP-4 — Final gate passes; all success criteria verified

## Summary

Final checkpoint. The mission's declared Gate (`npm test`) passes from a clean working tree
(1603 pass / 0 fail / 22 skipped, exit 0) with no test files modified. All ten Success
Criteria from `MISSION.md` are verified below with file:line and test-name evidence.

Deliverables landed across CP-1…CP-3:
- `docs/readme-rewrite-benchmark.md` — seven competitor READMEs analyzed (CP-1).
- `README.md` — rewritten as a credible GitHub landing page, nine sections in order, first
  300 words answering all five questions, 9/9 SEO phrases, no internal abstractions in the
  first 500 words (CP-2/CP-3).
- `docs/authority-reference.md` — all internal authority content extracted verbatim, nothing
  deleted (CP-2).

No restricted areas were touched (no changes under `lib/`, `test/`, `config/`, `index.js`,
`px.js`, `docs/use-cases.md`, `docs/adr/`, `AGENTS.md`, `CHANGELOG.md`, `LICENSE`,
`package.json`). No stop rule triggered. The backlog task file was preserved.

## Goal Check

| # | Success criterion | Evidence | Status |
|---|---|---|---|
| 1 | Benchmark doc with ≥6 competitor READMEs + required dimensions | `docs/readme-rewrite-benchmark.md` — Aider `:25`, Goose `:38`, OpenCode `:52`, Get Shit Done `:66`, Continue `:80`, Codex CLI `:94`, Cline `:108` (7 total); each has headline/first-paragraph/leads-with/quickstart/credibility/borrow/avoid; structure decision at `:166` | ✅ |
| 2 | First 300 words answer all five questions | `README.md:3` (what), `:5` (who + pain), `:9` (why not a single agent directly), `:11`–`:17` (first concrete thing — `npm pack` → `npm install -g ./magnus-parallix-*.tgz` → `px draft`, end-to-end verified, see "Review round 2 resolution") — verified by word-slice script | ✅ |
| 3 | All nine required sections in order | `README.md` headings at `:21,:32,:43,:57,:80,:107,:115,:122,:133` = Why Parallix? / What it does / The core workflow / Quick start / Example / Use cases / What Parallix is not / Current status / Documentation | ✅ |
| 4 | "What it does" 5–7 bullets, each UC-tied with confidence | `README.md:36`–`:41` — 6 bullets: UC-1 Confirmed, UC-2 Confirmed, UC-3 Confirmed, UC-4 Partial, UC-5 Confirmed, UC-6 Partial (confidence sourced from `docs/use-cases.md:23,30,37,44,51,58`) | ✅ |
| 5 | No internal abstractions in first 500 words | banned-term script over first 500 words → 0 hits (authority stack / state-map / adapter internals / mode tables / config boundary / canonical markdown companion / conflict resolution) | ✅ |
| 6 | ≥6 of 9 SEO phrases | SEO script → 9/9 present | ✅ |
| 7 | "What Parallix is not" covers not-a-model, not-an-IDE, not-a-magic-autonomous-engineer | `README.md:117` (not a model), `:118` (not an IDE), `:119` (not a magic autonomous engineer) | ✅ |
| 8 | "Current status" states alpha/local-first + npm-pack-only/no-registry | `README.md:124` (alpha, local-first), `:126` (local `npm pack` + global install only; no public npm registry publish, no Homebrew/Docker) | ✅ |
| 9 | Internal authority content preserved in `docs/authority-reference.md` | authority stack table `docs/authority-reference.md:36`, mode table `:26`, command aliases `:168`, validation model `:54`, state map `:153`, public distribution `:237` | ✅ |
| 10 | `npm test` passes after rewrite (no test files modified) | `npm test` → `pass 1603` / `fail 0`, exit 0 (CP-4 clean run); `git status --porcelain` empty; no paths under `test/` in the mission diff | ✅ |

### Gate evidence

`npm test` (mission Gate, `workflow.config.json` `adapters.verification.command`):

```
ℹ tests 1625
ℹ pass 1603
ℹ fail 0
ℹ skipped 22
```

Representative passing tests backing the README's value claims (unchanged by this mission,
cited in `docs/use-cases.md`): `test/draft.test.js` — `ensureWorktree creates worktree when
target directory is absent` (UC-1); `test/agents-limit-hit.test.js` — `startAgent persists a
block via updateAgentBlock when limit-hit detector fires` (UC-2); `test/verification.test.js`
— `runVerificationGate is a no-op pass when no command is configured` (UC-5).

## Review round 1 resolution (act-on-review, attempt 1)

Reviewer qwen returned `request-changes` with all 10 success criteria passing and a single
**advisory** finding: two SEO phrases sat late in the document — "AI coding workflow"
(formerly `README.md:30`) and "local-first developer workflow" (formerly `README.md:131`) —
weakening discoverability though technically compliant.

**Fixed.** Both phrases are now surfaced in the opening (within the first 300 words):
- "local-first developer workflow" → `README.md:3` (the lead positioning sentence).
- "AI coding workflow" → `README.md:7` ("It wraps your AI coding workflow without replacing
  it…").
- Removed the now-duplicate "wraps your AI coding workflow" clause at the old `README.md:30`
  to avoid repetition.

Re-verified after the fix: SEO 9/9 present; first-500-words banned-term scan 0 hits;
"multi-agent coding" adjacency preserved; nine section headings unchanged at
`:21,:32,:43,:57,:80,:107,:115,:122,:133`; `npm test` → 1603 pass / 0 fail / exit 0. No line
numbers shifted (in-place text edits), so all prior checkpoint citations remain valid.

## Review round 2 resolution (act-on-review, attempt 2)

Reviewer codex returned `request-changes` with two **legitimate, verified** findings: the
README's primary entry commands were wrong for this checkout. The package root is the repo
root (there is no `parallix/` subdirectory), and the dispatcher is `index.js` — so the
documented `npm pack ./parallix`, `npm install -g ./parallix-*.tgz`, and `node parallix
<command>` all failed (`ENOENT` / `MODULE_NOT_FOUND`). I reproduced both failures directly
before fixing. **Both findings accepted and fixed (no pushback).**

**Fixes:**
- `README.md:14`,`:63` — `npm pack ./parallix` → `npm pack` (produces
  `magnus-parallix-<version>.tgz`).
- `README.md:15`,`:66` — `npm install -g ./parallix-*.tgz` → `npm install -g
  ./magnus-parallix-*.tgz` (the actual scoped tarball name).
- `README.md:75` — `node parallix <command>` → `node index.js <command>` (the real
  repo-root dispatcher).
- `docs/authority-reference.md:17,:252,:256,:260,:278` — same three corrections in the
  extracted copy (reviewer required change #3).
- CP-2 / CP-4 SC-2 evidence updated to cite the corrected, verified commands.

**End-to-end verification (real, not asserted):**
- `npm pack` → `magnus-parallix-1.0.0.tgz`.
- `npm install -g --prefix <tmp> ./magnus-parallix-*.tgz` → installed `px`; `px --version`
  prints `@magnus/parallix 1.0.0`.
- `node index.js --help` → prints the `px` usage banner (exit 0).
- Re-checked all criteria: SEO 9/9, nine sections in order, banned-terms 0 in first 500
  words, `npm test` → 1603 pass / 0 fail / exit 0. No restricted areas touched.

## Review round 3 resolution (act-on-review, attempt 3)

Reviewer codex returned `request-changes` with a single **workflow-state** finding: the
mandated `px review task-1336 --verify` command was unavailable during review
(`/bin/bash: px: command not found`). The reviewer classified this as "a workflow-state
inconsistency rather than a README/content bug" and noted it should be reported rather than
worked around silently.

**Correction (round 4):** The round-3 resolution statement was imprecise. The `px` binary
exists at `/home/magnus/.nvm/versions/node/v24.15.0/bin/px` and works when invoked via its
absolute path, but the bare command `px review task-1336 --verify` still fails in the review
shell because `/home/magnus/.nvm/versions/node/v24.15.0/bin` is not on PATH. See round 4
resolution below for the disposition.

## Review round 4 resolution (act-on-review, attempt 4)

Reviewer codex returned `request-changes` with a single finding: the bare command `px review
task-1336 --verify` still fails in the review shell because the NVM bin directory is not on
PATH.

**Pushed back.** This finding is about the review environment's PATH configuration, not about
any deliverable produced by this mission. The facts:

- The `px` binary is installed and functional at
  `/home/magnus/.nvm/versions/node/v24.15.0/bin/px`.
- Invoking the absolute path works: `/home/magnus/.nvm/versions/node/v24.15.0/bin/px review
  task-1336 --verify` runs successfully.
- The mission scope is rewriting `README.md` as a GitHub landing page and extracting internal
  content to `docs/`. PATH configuration of the review environment is outside this scope.
- The px CLI is installed globally via npm (visible in `npm list -g`), and the binary is
  accessible — only the shell PATH is not configured to include it.

The reviewer correctly noted this is "a workflow-state inconsistency rather than a
README/content bug." It should be resolved by review-environment configuration (adding the NVM
bin directory to PATH), not by changes to the mission deliverables.

## Next action

Hand off to review: all checkpoints (CP-1…CP-4) and mission/doc changes are committed, the
working tree is clean, and the `npm test` Gate passes. Reviewer should diff
`main..mission/task-1336` and confirm the README landing-page criteria and the authority
extraction against the ten criteria above.
