# CP-3 — Config-boundary, line-preservation coverage, docs, diff budget, gate

## Work done

Closed out task-2465: confirmed the config-boundary and line-preservation
coverage in `test/prompt-split.test.ts`, verified `docs/config.md` documents the
one optional key and links all five shipped default-opinion files, measured the
qualifying `src/` diff budget, and ran the required gate.

### Config-boundary and preservation coverage

`test/prompt-split.test.ts` (12 tests, 12 pass, 0 fail under
`npx tsx --test test/prompt-split.test.ts`):

- Preservation (Success Criterion 2): `task-2465-0` … `task-2465-4` — for each of
  the five stages, core (minus its one added heading) + default non-blank-line
  multiset equals the parent-commit prompt non-blank-line multiset, and the only
  new line in the core file is the added heading. A moved-line edit breaks this.
- Launch equivalence (Success Criterion 3): `task-2465-draft/execute/review/act-on-review
  launch point preserves every pre-split line (no override)` — every non-placeholder
  parent line survives each wired launch and no `{{placeholder}}` leaks.
- Override retention (Success Criterion 4): `configured override replaces opinion content but
  retains a named core instruction` and `override cannot drop core even when the repo opinion
  omits it` — core tokens `Separation of duties — you are the reviewer, not the
  implementer`, `Mode: review.`, and `CHANGES_MADE|PUSHBACK_ALL|PARKED|BLOCKED` survive.
- Config boundary (Success Criterion 5): `adapters.prompts.override is accepted; unknown keys
  beneath it are rejected` — `validateWorkflowConfig({adapters:{}})` is `[]`,
  `{adapters:{prompts:{override:'x'}}}` is `[]`, and
  `{adapters:{prompts:{unknownKey:true}}}`, `{adapters:{prompts:{override:5}}}`, and
  `{adapters:{prompts:{draftOverride:'x'}}}` are all non-empty (rejected). No per-stage keys.

### Documentation

`docs/config.md` documents the optional key `adapters.prompts.override`: states an
unconfigured repository retains current behaviour byte for byte, shows the JSON
shape, explains unknown-key rejection through the existing config-error path, and
links the five shipped default-opinion files: `prompts/draft.md`,
`prompts/execute.md`, `prompts/review.md`, `prompts/act-on-review.md`,
`prompts/portfolio.md`.

### Qualifying `src/` diff budget (Success Criterion 6)

Command:

```
git diff main...HEAD --diff-filter=ACM -- 'src/*.ts' 'src/**/*.ts' 'src/*.js' 'src/**/*.js'
```

Added (`+`) lines excluding diff headers: **73** (runtime-assets.ts 30,
product-config.ts 29, active.ts 4, draft-prompts.ts 4, review-prompts.ts 6).
73 < 150. The diff is wiring (four launch points) plus the one config key and the
`assembleStagePrompt`/`resolvePromptOverride` loading path — no abstraction, no
new dependency, no templating.

### Gate (Mission gate)

`./scripts/verify-local.sh all` → exit code 0. Full suite: 2451 tests, 2451 pass,
0 fail. (The `[FAIL] [coverage-gate]` lines in the log are the coverage-gate's own
failure-mode unit cases, not a gate failure.)

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Ten files under `prompts/` (core + default per stage) | `ls -1 prompts/` → 10 files (`prompts/*-core.md` + `prompts/*.md`) | Pass |
| Preservation test per stage (multiset equals parent commit) | `test/prompt-split.test.ts` `task-2465-0` … `task-2465-4`; baseline `test/fixtures/prompt-split-parent.json` | Pass — 5/5 |
| No-override launch equivalence (5 launch points) | `test/prompt-split.test.ts` `task-2465-draft/execute/review/act-on-review launch point preserves every pre-split line (no override)`; portfolio covered by preservation test | Pass — 4/4 |
| Override retention of core (cannot drop core) | `test/prompt-split.test.ts` `configured override replaces opinion content but retains a named core instruction` + `override cannot drop core even when the repo opinion omits it` | Pass — 2/2 |
| One config key; unknown keys fail via config error path | `test/prompt-split.test.ts` `adapters.prompts.override is accepted; unknown keys beneath it are rejected`; `validateWorkflowConfig` `src/adapters/config/product-config.ts:205` | Pass |
| `src/` non-test/non-prompt/non-doc diff < 150 lines | `git diff main...HEAD --diff-filter=ACM -- 'src/*.ts' 'src/**/*.ts' 'src/*.js' 'src/**/*.js'` → 73 added lines < 150 | Pass — 73 |
| `docs/config.md` documents the key + links defaults | `docs/config.md` documents `adapters.prompts.override`, unconfigured behaviour, links `prompts/draft.md`, `prompts/execute.md`, `prompts/review.md`, `prompts/act-on-review.md`, `prompts/portfolio.md` | Pass |

## Mission gate

- [x] `./scripts/verify-local.sh all` → exit code 0 (2451 tests pass, 0 fail)

Next action: commit CP-2.md and CP-3.md; mission task-2465 complete.
