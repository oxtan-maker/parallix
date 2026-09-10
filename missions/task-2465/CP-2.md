# CP-2 — Ten prompt files, loading path, no-override equivalence and override retention

## Work done

Built the ten prompt files from the parent-commit (`main`) source, added the
minimum single-key configuration key and the two-file loading/concatenation
path, wired all four code launch points, and proved no-override equivalence
plus override core-retention with tests. No prompt wording was changed: each
`prompts/<stage>-core.md` carries exactly one added file-naming heading and
every other line is a moved line or boundary blank line from `main`.

### The ten files (`prompts/`)

| Stage | Core (mandatory) | Default-opinion (overridable) |
|---|---|---|
| draft | `prompts/draft-core.md` | `prompts/draft.md` |
| execute | `prompts/execute-core.md` | `prompts/execute.md` |
| review | `prompts/review-core.md` | `prompts/review.md` |
| act-on-review | `prompts/act-on-review-core.md` | `prompts/act-on-review.md` |
| portfolio | `prompts/portfolio-core.md` | `prompts/portfolio.md` |

`ls -1 prompts/` reports exactly these ten files. Each core file begins with a
single `# <stage>` file-naming heading; that heading is the only line in a core
file that is not present in the parent-commit prompt.

### Loading / concatenation path (one config key, one assembly function)

- `src/adapters/assets/runtime-assets.ts:34` — `assembleStagePrompt(stage, { overridePath })` loads
  `prompts/<stage>-core.md` and appends either `prompts/<stage>.md` (shipped
  default) or the single `overridePath`. No per-stage, per-agent, per-model, or
  per-user selection; one closed surface.
- `src/adapters/config/product-config.ts:568` — `resolvePromptOverride(rootDir)` reads exactly one new
  key, `adapters.prompts.override` (a string path).
- `src/adapters/config/product-config.ts:205-212` — `validateWorkflowConfig` accepts only
  `adapters.prompts.override`; any other key beneath `adapters.prompts` fails through the
  existing configuration-error path.
- Wired launch points: `draft-prompts.ts:41`, `active.ts:659`, `review-prompts.ts:102`,
  `review-prompts.ts:136` (portfolio has no code launch point; it is covered by the
  preservation test).

### No-override equivalence (5 launch points)

With no override configured, each wired launch point assembles BOTH halves and
substitutes every placeholder, so every non-placeholder line of the parent-commit
prompt survives. The five launch-equivalence checks run in
`test/prompt-split.test.ts` and pass:

- `task-2465-draft launch point preserves every pre-split line (no override)`
- `task-2465-execute launch point preserves every pre-split line (no override)`
- `task-2465-review launch point preserves every pre-split line (no override)`
- `task-2465-act-on-review launch point preserves every pre-split line (no override)`
- portfolio: no code launch point; covered by its preservation test below.

### Override retention of core content

`test/prompt-split.test.ts`:

- `task-2465: configured override replaces opinion content but retains a named core instruction` —
  with `adapters.prompts.override` set, the assembled review prompt contains the
  repo-opinion placeholder AND the core instructions `Separation of duties — you are the
  reviewer, not the implementer` and `Mode: review.`.
- `task-2465: override cannot drop core even when the repo opinion omits it` — with a
  deliberately thin override, the assembled `act-on-review` prompt still contains the
  parser-visible core token `CHANGES_MADE|PUSHBACK_ALL|PARKED|BLOCKED`.

### Verification

`npx tsx --test test/prompt-split.test.ts` → 12 tests, 12 pass, 0 fail.
Preservation multiset equality for all five stages holds: core (minus heading) +
default non-blank-line multiset equals the parent-commit prompt non-blank-line
multiset.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Ten files under `prompts/` (core + default per stage) | `ls -1 prompts/` → 10 files: `prompts/draft-core.md`, `prompts/execute-core.md`, `prompts/review-core.md`, `prompts/act-on-review-core.md`, `prompts/portfolio-core.md`, `prompts/draft.md`, `prompts/execute.md`, `prompts/review.md`, `prompts/act-on-review.md`, `prompts/portfolio.md` | Pass |
| Preservation test per stage (multiset equals parent commit) | `test/prompt-split.test.ts` tests `task-2465-0` … `task-2465-4`; parent baseline = committed fixture `test/fixtures/prompt-split-parent.json` | Pass — 5/5 preservation tests pass |
| No-override launch equivalence (5 launch points) | `test/prompt-split.test.ts`: `task-2465-draft/execute/review/act-on-review launch point preserves every pre-split line (no override)`; portfolio has no code launch point | Pass — 4 launch tests pass |
| Override retention of core (cannot drop core) | `test/prompt-split.test.ts`: `configured override replaces opinion content but retains a named core instruction` and `override cannot drop core even when the repo opinion omits it` | Pass — 2/2 pass |
| One config key; unknown keys fail via config error path | `test/prompt-split.test.ts`: `adapters.prompts.override is accepted; unknown keys beneath it are rejected`; `validateWorkflowConfig` in `src/adapters/config/product-config.ts:205` | Pass |
| `src/` non-test/non-prompt/non-doc diff < 150 lines | Measured in CP-3 via `git diff main...HEAD --diff-filter=ACM -- 'src/*.ts' 'src/**/*.ts' 'src/*.js' 'src/**/*.js'` → 73 added lines | Measured in CP-3 |
| `docs/config.md` documents the key + links defaults | `docs/config.md` section documents `adapters.prompts.override`, unconfigured behaviour, and links all five shipped default-opinion files | Documented in CP-3 |

Next action: CP-3 — add the config-boundary and line-preservation evidence rows,
confirm `docs/config.md` links the five shipped defaults, measure the qualifying
`src/` diff with the `git diff` command above, and run `./scripts/verify-local.sh all`.
