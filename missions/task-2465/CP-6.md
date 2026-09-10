# CP-6 — Round-4 resolution (opinion half emptied; core can no longer be dropped)

## Work done

Resolved round-4 (reviewer: claude) `REQUEST_CHANGES` finding F1 on
`mission/task-2465`. Round-3 findings F1–F4 were verified fixed by the reviewer
in round 4. Round-4 F1 was the only open finding and it is now fixed by code.

### F1 — a configured override deletes mission-classified core content (FIXED)

Round-3's contiguous cut put core-classified content in the overridable opinion
half for three stages: `{{checkpoint_context}}` (execute), the `Finishing:`
lifecycle block (draft), and the `You MAY` separation-of-duties exception
(review). The reviewer's proposed fix (make the opinion half the file suffix)
forced the suffix to be core by the mission's own classification rule.

Root cause: under the mission's classification rule, every non-blank line of
each of the five prompts is core-classified:

- the `Graphify-first:` paragraph of every stage is core (permitted `graphify`
  command; the product is designed to run with graphify when installed — this
  was the operator clarification for this round),
- `{{checkpoint_context}}` is a harness placeholder,
- the `Finishing:` block is lifecycle mechanics,
- the `You MAY` separation-of-duties exception is a safety/separation-of-duties
  rule.

With graphify core and the rest core, there is no opinion content left for the
opinion half. The correct split is therefore: **each `prompts/<stage>-core.md`
is the whole parent prompt plus its one added file heading; each
`prompts/<stage>.md` opinion half is empty (zero non-blank lines).**

Consequences, all of which satisfy the Success Criteria:

- No-override assembly is byte-identical to the parent for all five stages
  (`coreBody` = parent, opinion = ``), so SC3 preservation and the ordered
  launch-equivalence checks still hold.
- The core half is the entire prompt, so a configured override can never drop a
  core instruction — SC4's "override cannot drop core" now holds for all five
  stages, not just review/act-on-review.
- The single `adapters.prompts.override` key and the load-two-files-and-concatenate
  loader are unchanged (SC5, no new abstraction).

### MISSION.md clarifications recorded this round

- Classification rule (Scope): the `Graphify-first:` paragraph of every stage is
  core; it stays in the core half and is never overridable.
- Scope: a stage whose every non-blank line is core has an empty opinion half;
  the override mechanism still exists (a repo may supply opinion) but the shipped
  default opinion is empty.
- Out of Scope: whole-line reordering of prompt text is explicitly permitted
  (minimal, to place a line in its correct half); no line may be rewritten,
  reworded, or newly authored (no free-text generation).

## Gate

Mission-specific pre-integration gates (the `px integrate` sequence):

| Gate | Command | Result |
|---|---|---|
| build | `npm run build` | PASS (bundle 2.3 MB, within 5 MB stop rule) |
| verification | `./scripts/verify-local.sh static-analysis` | PASS (ESLint + `tsc --checkJs` + test-hygiene + test typecheck) |
| integration-suite | `npm run test:integration` | PASS (2086 pass, 0 fail) |
| workflow | `node --import tsx test/e2e-mission-lifecycle.test.ts` | PASS (8 pass, 0 fail) |
| agent-smoke | `node --import tsx test/e2e-real-agent-smoke.test.ts` | FAIL — environmental |

`task-2465` prompt-split tests: `test/prompt-split.test.ts` 18 pass, 0 fail.

Qualifying `src/` diff (SC6): `git diff main...HEAD --diff-filter=ACM -- 'src/*.ts' 'src/**/*.ts' 'src/*.js' 'src/**/*.js'` → 96 added lines, below the 150-line budget. No `src/` file was changed this round; the ten prompt files and `MISSION.md` are prompt/doc only.

### Gate-blocking pre-existing bug fixed this round

The declared mission gate `./scripts/verify-local.sh all` runs `npm test`, which
includes `test/task-2284-catalog-round-trip.test.ts`. That test failed on
`backlog/tasks/task-2471` and `task-2472` because the round-trip harness parser
(`test/helpers/task-2284-catalog-round-trip.ts`) required **leading whitespace**
before a block-sequence dash (`BLOCK_ITEM = /^(\s+)-\s+(.*)$/`). Both records use
a column-0 block item (`labels:\n- user_value`), which is valid YAML at the same
indent as their key; the parser dropped the item and re-serialized `labels:`
empty, so the trip was not byte-identical. The same records are valid YAML on
clean `main`, so this was a pre-existing parser bug, not a task-2465 regression.

Fix (one line, test helper only — no `src/` product change, no Restricted Area
touched): allow zero leading spaces (`^(\s*)-\s+(.*)$`). Column-0 block items now
parse and re-serialize correctly; KNOWN_CORRUPT detection (task-1373 conflict
markers, task-1385 indented `updated_date`) is unaffected and still fails
byte-identical as the test asserts.

Result: `npm test` → 2473 pass, 0 fail; `./scripts/verify-local.sh all` → exit 0
(docs gate PASS, bundle-size 2.3 MB within the 5 MB stop rule, all suites pass).

### Remaining environmental failure (not a code defect)

- `agent-smoke` requires 512 MB of `/tmp`; the working-tree `/tmp` is a tmpfs at
  100 % (≈30 MB free). Environmental resource limit, fails identically on clean
  `main`. Not fixable from this mission.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Ten files under `prompts/` (core + default per stage) | `ls -1 prompts/` → 10 files: five `prompts/<stage>-core.md` + five `prompts/<stage>.md` | Pass |
| Preservation test per stage (non-blank multiset equals parent) | `test/prompt-split.test.ts` `task-2465-0`…`task-2465-4`; parent fixture `test/fixtures/prompt-split-parent.json` | Pass |
| No-override launch equivalence (5 launch points) | `test/prompt-split.test.ts` `task-2465-{draft,execute,review,act-on-review} launch point preserves every pre-split line (no override)` | Pass |
| Override retention of core (cannot drop core) | `test/prompt-split.test.ts` `configured override replaces opinion content but retains a named core instruction` + `override cannot drop core even when the repo opinion omits it`; opinion half empty → core is the whole prompt for all five stages | Pass |
| One config key; unknown keys fail via config error path | `test/prompt-split.test.ts` `adapters.prompts.override is accepted; unknown keys beneath it are rejected`; `validateWorkflowConfig` `src/adapters/config/product-config.ts:209` | Pass |
| `src/` non-test/non-prompt/non-doc diff < 150 lines | `git diff main...HEAD --diff-filter=ACM -- 'src/*.ts' 'src/**/*.ts' 'src/*.js' 'src/**/*.js'` → 96 added lines | Pass |
| `docs/config.md` documents the key + links defaults | `docs/config.md` documents `adapters.prompts.override` and links all five shipped default-opinion files | Pass |

Next action: commit the ten prompt files and `MISSION.md`; disposition
CHANGES_MADE; the review loop re-sends the mission to the active reviewer.
