# CP-4 — Round-3 review resolution (contiguous review split, ordered preservation tests)

## Work done

Resolved round-3 (reviewer: claude) `REQUEST_CHANGES` findings F1–F4 on
`mission/task-2465`. F1 and F2 are a single defect in the `review` split: the
core/opinion cut was non-contiguous (two gaps, at parent lines 13–17 and
30–35), which both reordered two opinion sections to the end of the assembled
prompt and dropped the `Separation of duties` section entirely. F3 is the test
defect that let F1/F2 pass; F4 (missing-override surfacing) was already correct
and needs no change.

### F1/F2 — contiguous review split (core = parent lines 1–65, opinion = 66–68)

The pre-split `review` prompt has its mandatory sections in this order:
`Load before reviewing:` → `Review history is not optional context:` (13–17) →
`Minimum loop contract:` → `Rebasing Artifacts:` (30–35) → `Check:` →
`Graphify-first:` → `Separation of duties` (54–68). The committed split had
moved 13–17 and 30–35 into the opinion half (appended at the end) and had not
placed `Separation of duties` in either half.

Re-cut at the parent blank-line boundary after line 65:

- `prompts/review-core.md` = `# Review core` heading + parent lines 1–65
  (all mandatory sections, in parent order: `Review history` and `Rebasing
  Artifacts` now sit in core at their correct positions).
- `prompts/review.md` = parent lines 66–68 (the `You MAY` artifact-write
  permissions — the overridable opinion tail).

Verified: `assembleStagePrompt('review', {})` now equals the parent-commit
`review` prompt byte-for-byte (single trailing newline). Interior blank lines
are preserved (core 6 blank lines, opinion 4) — F2 satisfied. The cut keeps
every heading with its list and every mandatory section (including
`Separation of duties`) wholly in core per the mission Scope classification
rule.

### F3 — ordered preservation tests (removed the review block-multiset escape hatch)

`test/prompt-split.test.ts` special-cased `review` in two places to compare as a
block multiset / section-marker presence, which is blind to reordering (exactly
the F3 defect). With the review split now contiguous, both special-cases are
removed:

- `assertLaunchKeepsEveryLine` now runs the ordered-subsequence check for
  `review` like every other stage (parent non-placeholder lines must appear in
  order in the launched prompt).
- The assembly-reconstruction test now runs the ordered `normalizeBlankRuns`
  comparison for `review` like every other stage; the now-unused `blocks`
  helper was deleted.

`npx tsx --test test/prompt-split.test.ts` → 18 tests, 18 pass, 0 fail.

### F4 — no change

`readOverride` already throws on a configured-but-missing override
(`task-2465: a configured override whose file is missing surfaces a config
error` passes). No edit.

### Gate

`./scripts/verify-local.sh all` → exit code 0 (2473 tests pass, 0 fail;
`test/metric-contract.test.ts` passes). Static analysis (ESLint + `tsc --checkJs`
+ test-hygiene) clean.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Ten files under `prompts/` (core + default per stage) | `ls -1 prompts/` → 10 files: five `prompts/<stage>-core.md` + five `prompts/<stage>.md` | Pass |
| Preservation test per stage (non-blank-line multiset equals parent) | `test/prompt-split.test.ts` `task-2465-0`…`task-2465-4`; parent fixture `test/fixtures/prompt-split-parent.json` | Pass |
| No-override launch equivalence (5 launch points) | `test/prompt-split.test.ts` `task-2465-draft/execute/review/act-on-review launch point preserves every pre-split line (no override)`; review now uses ordered-subsequence check like other stages | Pass |
| Override retention of core (cannot drop core) | `test/prompt-split.test.ts` `configured override replaces opinion content but retains a named core instruction` + `override cannot drop core even when the repo opinion omits it` | Pass (see round-4 F1 scope question below) |
| One config key; unknown keys fail via config error path | `test/prompt-split.test.ts` `adapters.prompts.override is accepted; unknown keys beneath it are rejected`; `validateWorkflowConfig` `src/adapters/config/product-config.ts:209` | Pass |
| `src/` non-test/non-prompt/non-doc diff < 150 lines | `git diff main...HEAD --diff-filter=ACM -- 'src/*.ts' 'src/**/*.ts' 'src/*.js' 'src/**/*.js'` → 91 added lines | Pass |
| `docs/config.md` documents the key + links defaults | `docs/config.md` documents `adapters.prompts.override` and links all five shipped default-opinion files | Pass |

Next action: round-4 resolution — F1 is a genuine SC3-vs-SC4 scope conflict
requiring a mission decision (recorded in CP-5); F2/F3 fixed in this commit.
