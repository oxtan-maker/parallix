# CP-5: Re-record the first-value demo, and what the recording exposed

The operator asked for `docs/assets/first-value-demo.cast` to be re-recorded so
the README's first impression shows the round-2 output. `scripts/record-first-value-demo.sh`
runs a real mission end to end (draft → active → review → integrate) in a
disposable repo with a disposable `PARALLIX_HOME`, so the recording is also the
first genuine end-to-end exercise of the round-2 changes. It found three
defects that no unit test had.

## Defects the recording found

**1. The header named a mission that never existed.** Free-text intake drafts
under a placeholder slug (`adhoc-fix-hello-world-greeting`) and is then minted a
repository-scoped identity (`parallix-adhoc-0001`). The round-2 header printed
before allocation, so the recording showed:

```text
Drafting mission adhoc-fix-hello-world-greeting
  branch    mission/parallix-adhoc-0001
```

The header now prints after allocation. Test:
`"runDraftCommand announces the allocated adhoc identity, not the free-text placeholder"`
(`test/draft-command.test.ts`).

**2. Every successful draft warned about its own artifacts.** git reports a
wholly untracked tree as its top directory, so the mission's files arrive as
`?? missions/` — an ancestor of the mission dir, which `isExpectedDraftPath` did
not match — and the harness's own `ensureWorkflowGitignore` edit arrives as
`M .gitignore`. Both were classified unexpected, producing
`[WARN] Draft safety harness: capturing unexpected dirty files alongside mission artifacts`
on every clean run. Both now classify as expected. Test:
`"isExpectedDraftPath accepts the collapsed untracked mission tree and the harness gitignore"`
(`test/draft.test.ts`).

**3. The GIF renderer discarded carriage returns.**
`scripts/render-first-value-demo.mjs` stripped all control characters, so every
spinner redraw was appended instead of rewriting its line and the rendered
frames were overlapping text (visible in the previous checked-in GIF, too).
`applyOutput` now folds CRLF into a newline and honours a bare `\r` as a line
rewrite. The rendered frames are legible for the first time.

## Regressions the recording did not find, but running the tests directly did

`./scripts/verify-local.sh all` reports pass while whole test files never run,
so two round-1 breakages had been sitting green:

- `test/draft-command.test.ts` still asserted `Mission draft complete` and
  `Draft agent family: codex`. Both were replaced in round 1/round 2; the file
  fails immediately when run directly. Assertions updated to the shipped
  contract.
- `test/e2e-real-agent-smoke.test.ts` parses the `Draft stats recorded:` line
  that round 1 moved behind `DEBUG`, so the `agent-smoke` pre-integration gate
  would have failed on the first real run. That gate reads harness output rather
  than the operator-facing default, so it now runs `px` with `DEBUG=1`.

## Evidence

| Item | Evidence | Status |
|---|---|---|
| SC15: adhoc header names the allocated identity | `"runDraftCommand announces the allocated adhoc identity, not the free-text placeholder"`, `test/draft-command.test.ts`; recorded cast shows `Drafting mission parallix-adhoc-0001` above `branch mission/parallix-adhoc-0001` | PASS |
| SC16: no unexpected-dirty-file warning for the mission's own artifacts | `"isExpectedDraftPath accepts the collapsed untracked mission tree and the harness gitignore"`, `test/draft.test.ts`; the warning is absent from the recorded draft phase | PASS |
| SC17: demo re-recorded and legibly rendered | `./scripts/record-first-value-demo.sh` (exit 0, 997 events retimed to 73.3 s), `node scripts/render-first-value-demo.mjs`, `docs/assets/first-value-demo.cast`, `docs/assets/first-value-demo.gif` | PASS |
| Full default suite green on the final tree | `./scripts/verify-local.sh all` | PASS |
| Lint, typecheck, test-hygiene clean | `./scripts/verify-local.sh static-analysis` | PASS |
| Authored docs gate | `./scripts/verify-local.sh docs` | PASS |
| `test/draft-command.test.ts`, `test/agents.test.ts`, `test/draft.test.ts`, `test/px-shell-init.test.ts`, `test/domain-consumer-requirements.test.ts` run directly | `node --import tsx --experimental-test-module-mocks --test <files>` — 224 tests, 0 fail | PASS |

The recorded draft phase now reads:

```text
$ px draft "fix hello world greeting"
Drafting mission parallix-adhoc-0001
  branch    mission/parallix-adhoc-0001
  worktree  /tmp/parallix-demo-00Guh9/hello-parallix-parallix-adhoc-0001

Running claude to write the mission contract...
[INFO] Selected agent for step "draft": claude
[INFO] Launching: claude --dangerously-skip-permissions --output-format stream-json --verbose --include-partial-messages -p <prompt: 5528 chars>
<the agent's own live output>

[PASS] Drafted parallix-adhoc-0001 in 1m 18s: Fix the hello.sh greeting output (parallix-adhoc-0001)
  contract  .../missions/parallix-adhoc-0001/MISSION.md
  branch    mission/parallix-adhoc-0001
  agent     claude

[INFO] Working directory: /tmp/parallix-demo-00Guh9/hello-parallix-parallix-adhoc-0001
[INFO] Next: px active
```
