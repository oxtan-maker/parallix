# CP-1 — Prompt inventory and core/opinion classification

## Work done

Inventoryed the five shipped stage prompts and every launch point, and recorded
the line-by-line core / default-opinion classification that the split in CP-2
consumes. No source, prompt, or doc files were changed in this checkpoint.

### The five prompt files (parent commit `main`, byte source of truth)

| Stage | File | Non-blank lines |
|---|---|---|
| draft | `prompts/draft.md` | 38 |
| execute | `prompts/execute.md` | 32 |
| review | `prompts/review.md` | 58 |
| act-on-review | `prompts/act-on-review.md` | 20 |
| portfolio | `prompts/portfolio.md` | 24 |

### Launch points (the only code sites that read these prompts)

| Stage | Launch point | File : line |
|---|---|---|
| draft | `buildDraftPrompt` | `src/adapters/cli/commands/draft-prompts.ts:38` |
| execute | `buildExecutePrompt` | `src/adapters/cli/commands/active.ts:657` |
| review | `buildCompactReviewPrompt` | `src/adapters/review/review-prompts.ts:100` |
| act-on-review | `buildCompactActOnReviewPrompt` | `src/adapters/review/review-prompts.ts:133` |
| portfolio | **none** | `prompts/portfolio.md` is registered nowhere in `src/`; only a thin Vibe skill points at it |

`src/adapters/assets/runtime-assets.ts:17-21` (`RUNTIME_ASSET_KEYS`) lists the
four code launch points and confirms `prompts/portfolio.md` is not a runtime
asset. Assumption from the mission Risks holds: the four wired files plus the
unwired portfolio file are the complete surface; no other path supplies any of
the five prompts.

### Classification rule (mission-authoritative)

A line is CORE iff removing it mechanically breaks the loop: artifact paths or
filenames the loop reads back, parser-visible tokens/formats
(`Outcome: approve`, `## F1:`, `| Criterion | Evidence | Status |`,
`## Goal Check`, `CHANGES_MADE|PUSHBACK_ALL|PARKED|BLOCKED`,
`Reproduction-Test:`), `{{...}}` harness placeholders, permitted
`px`/`git`/`Forgejo` commands, safety / separation-of-duties rules, or
lifecycle mechanics. A mixed-purpose line stays wholly in core; a line is never
split. Everything else is default-opinion (how to review/act, evidence
standards, thoroughness, tone, graphify recommendations).

### Resulting partition (non-blank lines)

| Stage | Core | Opinion | Core sample (kept mandatory) |
|---|---|---|---|
| draft | 34 | 4 | placeholders, Forbidden actions, NEL format, `Reproduction-Test:` format |
| execute | 23 | 9 | terminal-condition mechanics, `## Goal Check` / table-format rules, `px active` ban |
| review | 35 | 23 | `px status` carve-out, artifact paths, `## F1:`/`Outcome:` formats, `You MUST NOT` SoD |
| act-on-review | 19 | 1 | `missions/{{slug}}/review-events/` path, `CHANGES_MADE|…` disposition token, BLOCKED safety |
| portfolio | 11 | 13 | artifact paths, `git branch` command, post-list-10 process |

Opinion halves hold exactly the overridable taste: quality guidance, evidence
standards, and `Graphify-first:` recommendations. No core line appears in any
opinion half, so an override cannot drop a core instruction.

### Preservation contract verified before writing files

The invariant CP-2 must satisfy: for every stage, the non-blank-line multiset
of `prompts/<stage>-core.md` (minus its one heading) unioned with
`prompts/<stage>.md` equals the parent-commit (`main`) non-blank-line multiset,
modulo the single added heading. A moved-line edit must break this. The exact
line lists feeding CP-2 are recorded above per stage; CP-2 generates the files
from `main` and re-verifies this multiset equality programmatically.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Ten files under `prompts/` (core + default per stage) | `ls -1 prompts/` → 10 files (`prompts/*-core.md` + `prompts/*.md`), count `10` | Not built — inventory complete; build in CP-2 |
| Preservation test per stage (multiset equals parent commit) | Parent baseline = `git show main:prompts/<stage>.md`; multiset invariant defined above | Not built — classification recorded in CP-1 |
| No-override launch equivalence (5 launch points) | Launch points at `draft-prompts.ts:38`, `active.ts:657`, `review-prompts.ts:100,133`; portfolio has no code launch point | Not built — wired in CP-2 |
| Override retention of core (cannot drop core) | No core line placed in any opinion half (see partition table) | Structurally guaranteed by CP-1 classification |
| One config key; unknown keys fail via config error path | `validateWorkflowConfig` in `src/adapters/config/product-config.ts`; `adapters.prompts` not yet added | Not built — added in CP-3 |
| `src/` non-test/non-prompt/non-doc diff < 150 lines | Budget tracked in CP-3 via `git diff main... --diff-filter=...` | Not measured — measure in CP-3 |
| `docs/config.md` documents the key + links defaults | `docs/config.md` (236 lines) present; section to add in CP-3 | Not built — added in CP-3 |

Next action: CP-2 — generate the ten prompt files from `main`, add the
`assembleStagePrompt` loading path, wire the four launch points, add the
`adapters.prompts.override` config key, and prove no-override equivalence plus
override core-retention with tests.
