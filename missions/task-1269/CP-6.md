# CP-6: ADR documentation

## Summary

Authored `docs/adr/adr-mutation-testing.md`, covering:

- **Why line coverage is insufficient** — cites arxiv 2510.09907 and
  earezki.com's "Tests Are Everything in Agentic AI" (~20% mutation score
  for AI-generated suites despite high line coverage), and how mutation
  score complements (not replaces) the existing 90% line-coverage gate.
- **Diff-scoped, not full-repo** — the transitive-callee scoping algorithm
  from CP-2, the regex-vs-TS-compiler-services tradeoff and its documented
  limitation (dynamic requires/re-exports invisible), and the `.ts`→`.js`
  runtime-path mapping.
- **StrykerJS via the `command` runner** — the CP-1 POC result, why
  `npx stryker` was avoided in favor of the direct binary path, and the
  `NODE_TEST_CONTEXT` nested-test-runner hazard found and fixed in CP-5.
- **Ratchet design** — the baseline JSON schema, why ratchet-only (no
  default absolute threshold), the incremental baseline-seeding decision
  from CP-4 (and why it deliberately deviates from the checkpoint's literal
  "all lib/ files" phrasing in favor of the mission's own Out-of-Scope
  section), and the accepted single-writer concurrency limitation.
- **Lifecycle placement** — pre-integrate rationale tied to TASK-1133's
  sub-30s per-checkpoint budget vs. the measured ~27s-for-2-files runtime,
  and how that maps to `config/integration-pipelines.json`'s `mutation` gate
  at order 40 (CP-7).
- **Consequences** — explicit positive/negative list, including the
  `coverageAnalysis: "off"` performance tradeoff inherent to the `command`
  runner.

## Goal Check

| Success criterion | Evidence |
|---|---|
| ADR exists and compares line coverage vs. mutation score | `docs/adr/adr-mutation-testing.md` §Context, §Decision |
| Cites arxiv 2510.09907 | `docs/adr/adr-mutation-testing.md` §Context (2nd bullet) and §Links |
| Documents lifecycle placement rationale | `docs/adr/adr-mutation-testing.md` §Decision "4. Lifecycle placement: pre-integrate, not per-checkpoint" |
| Documents ratchet design decisions | `docs/adr/adr-mutation-testing.md` §Decision "3. Ratchet, not absolute floor" |
| `./scripts/verify-local.sh docs` passes | See command output below |

Command run:
```
$ ./scripts/verify-local.sh docs
PASS: all required documentation present
```
(verifies `README.md`, `CHANGELOG.md`, `LICENSE`, and `docs/adr/` all
exist; `adr-mutation-testing.md` is a new file inside that already-required
directory).

Next action: CP-7 — wire `mutation-gate` into `scripts/verify-local.sh` as
a subcommand and add a `mutation` entry at order 40 in
`config/integration-pipelines.json`, per the lifecycle placement decided
here.
