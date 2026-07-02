---
event_type: reviewer_findings
timestamp: 2026-07-02T04:53:29.482Z
round: 1
phase: reviewing
actor: claude
slug: task-1401
---

# Review Findings: task-1401 (Fix no-unused-vars warnings, promote to error)

## Finding 1 (Critical): Branch is 3 mission-merges behind its PR base — diff includes unrelated reverts

`git diff main..HEAD` (and the same diff against the actual review-remote `main`,
`866a2695`) shows 68 files changed, but only ~28 of them are the intended
no-unused-vars mechanical fixes. The remainder is **not** work done by this
mission — it is collateral damage from the branch never being rebased onto
`main` after three other missions merged:

- `missions/task-1390/*`, `missions/task-1394/*`, `missions/task-1398/*` — all
  deleted (mission artifacts from other missions, ~1170 lines)
- `test/active.test.js`, `test/agents.test.js`, `test/mistral.test.js`,
  `test/task-1390-shell-init-shebang.test.js` — all deleted (133 lines), despite
  the mission's own Restricted Areas explicitly forbidding changes to `test/`
- `package.json` / `package-lock.json` — `tsx` devDependency removed (519
  lines in lockfile), and the `build:cjs` script's shebang-insertion fix
  (added by task-1390) reverted to the pre-fix version
- `lib/agents/mistral.ts` — the `--yolo` flag and its explanatory comment
  (added by a later mission, task-1394 or similar, to fix a real non-interactive
  launch failure) are removed

Root cause: `git log f0803119^..main` shows the branch's base commit
(`0aa91c4c`) predates `0b55f932` (task-1398), `409540e7` (task-1390), and
`866a2695` (task-1394), all of which are ancestors of the PR's actual base
(`main` on the `review`/Forgejo remote, currently at `866a2695`). The workflow
has a commit literally titled "auto-commit mission artifacts before pre-review
rebase" (`f55eba8c`), but no rebase onto the updated `main` actually happened —
`git merge-base --is-ancestor main HEAD` fails (main is not an ancestor of
HEAD).

**Impact**: if this PR is squash-merged as-is, it will silently revert three
merged missions' work (mission artifacts, test files, the tsx dependency, the
build:cjs shebang fix, and the mistral `--yolo` non-interactive launch fix).
This is a serious integration regression, not a cosmetic issue — the
`--yolo` removal in particular reverts a documented bug fix for a real
production failure mode (interactive approval blocking outside a TTY).

This should be reported and fixed by rebasing/merging `mission/task-1401` onto
the current `main` before merge — not something I can resolve from review
mode, and not something CP-5's "Goal Check" table mentions or accounts for
(it only checks the no-unused-vars-specific criteria, none of which surface
this).

## Mission-scoped work: looks correct

Restricting the diff to the mission's actual files (`eslint.config.mjs`,
`px.ts`, and the 26 `lib/` files touched) confirms the intended work matches
the mission scope:

- `eslint.config.mjs:70,117` — `no-unused-vars` changed from `warn` to
  `error` in both blocks, ignore patterns untouched.
- `lib/commands/stats.ts` — all 12 unused interfaces/type imports and the
  `getPrimaryWorktree` import removed.
- `lib/core/git.ts:1` — `childProcess` import removed; `args` → `_args` in
  the `GitRunner` type signature (type-only, no runtime effect).
- Caught-error bindings in `lib/agents/agents.ts`, `lib/commands/draft.ts`,
  `lib/core/mission-utils.ts` renamed to `_err`/`_error`/`_e` as specified.
- The bulk of the 218 unused-parameter renames (spot-checked in
  `lib/review/review-artifacts.ts`) are renames within function *type
  signatures* (interface/callback option types), which have no runtime
  behavior — low risk, and `npx tsc --noEmit` passing with 0 errors gives
  reasonable confidence no rename broke an in-scope reference.
- `px.ts:11` — `(id: string)` → `(_id: string)` as specified.
- `./scripts/verify-local.sh static-analysis` and `docs` both pass locally,
  matching CP-5's claims (ESLint clean, tsc clean, test-hygiene clean, docs
  present).

## Verdict rationale

The mechanical no-unused-vars work itself is complete, correctly scoped, and
verifiably passes all its own gates. However the branch as a whole is not
safe to integrate: it would revert unrelated, already-merged work from three
other missions, including a real bug fix (mistral `--yolo`) and test files
explicitly marked out of scope. This must be fixed (rebase onto current main)
before merge.

---
`[workflow-round:1, workflow-phase:reviewing]`