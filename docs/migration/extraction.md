# parallix standalone extraction record (task-1302)

This repository was extracted from the WrGroceries monorepo's embedded `parallix/`
directory as the standalone-repo "extraction proof" required by ADR 0044.

## Method — history-preserving

The extraction used **`git subtree split -P parallix`** (history-preserving), not a
flat copy. `git filter-repo` was not available on the workstation; `git subtree split`
is built into git 2.53 and reproduces every commit that touched `parallix/` with the
subtree promoted to the repository root. The standalone repo was then created with
`git clone -b <split-branch> --single-branch`, the `origin` remote removed, and the
default branch renamed to `main`.

Result: the full commit history for the parallix tree survives (`git log` shows the
`mission/task-1299`, `mission/task-1301`, `mission/task-1310`, etc. commits that
shaped the tool), and the working tree is byte-identical to the monorepo's
`parallix/` tree (verified with `diff -rq` across `lib/`, `test/`, `config/`,
`prompts/`, `templates/`, `examples/`, and the root files).

## Verbatim guarantee and the test-harness exception

No parallix **source** (`lib/`, `index.js`, `px.js`, command interfaces) was rewritten.
The only post-extraction edits are to **test-harness coupling** that assumed parallix
lived as a subdirectory of a host monorepo. These were unavoidable to satisfy the
mission's `npm test` zero-failures gate in a standalone checkout, and every one of
them is backward-compatible — re-running the edited test files inside the monorepo
still executes all tests with zero skips and zero failures.

### 1. Monorepo-script tests → auto-skip when the script is absent

`test/install.test.js` and the `scripts/verify-local.sh`-invoking tests in
`test/integration-pipelines.test.js` exercise WrGroceries monorepo scripts
(`scripts/install-workflow.sh`, `scripts/verify-local.sh`) that live **outside** the
parallix tree and are intentionally **not** carried into the standalone repo
(MISSION scope item 9 — those scripts stay in WrGroceries and are repointed to the
global `px` runner). Each such test now carries a `{ skip: ... }` guard keyed on the
script's presence: it runs unchanged in the monorepo and skips (with a documented
reason) in the standalone repo. Tests affected: 13 in `install.test.js`, 8 in
`integration-pipelines.test.js`.

### 2. Monorepo `.gitignore` assertion → skip outside the monorepo host

`test/agents.test.js` has one test asserting the monorepo `.gitignore` semantics for
the embedded `workflow/config/` tree, computed against `../..` (the monorepo root). In
the standalone repo `../..` is the parent code directory, not a git repo, so the
assertion does not apply. It now skips when no `.git` exists at `../..`. (1 test.)

### 3. Rebase tests → made hermetic to the Forgejo-review config

The standalone repo declares `workflow.config.json` with `adapters.review.provider:
"forgejo"` (required for self-hosting parity). That turns
`isForgejoReviewEnabled(process.cwd())` ON at the repo root. The rebase tests in
`test/rebase.test.js`, `test/rebase_diagnostics.test.js`, and
`test/rebase_hardening.test.js` were written assuming Forgejo-off (in the monorepo
they ran with `cwd = parallix/`, which had no local config), and they do not mock the
Forgejo fetch path. They now inject `isForgejoReviewEnabledFn: () => false` — the same
injection idiom two sibling tests in the file already use with `() => true` — so they
are hermetic to ambient config. (11 rebase calls across 3 files.)

Net: 22 tests skip in the standalone repo (host-coupled to the monorepo); 0 fail.
