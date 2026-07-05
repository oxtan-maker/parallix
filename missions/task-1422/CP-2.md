# CP-2: Update all functional references

## Work Done

1. Updated `lib/agents/agents.ts` comment: "Codex and Mistral" → "Codex and Vibe" (line 951)
2. Updated `lib/review/review-prompts.ts`:
   - `PromptEntrypoints` type: `mistral: PromptEntry` → `vibe: PromptEntry` (line 21)
   - `PROMPT_ENTRYPOINTS` object key: `mistral:` → `vibe:` (line 26)
3. Updated `lib/commands/stats-backfill.ts`:
   - `normalizeHistoricalImplementer` regex and return: `mistral` → `vibe` (line 64)

## Goal Check

| # | Criterion | Evidence |
|---|-----------|----------|
| 1 | `agents.ts` calls `startVibeAgent` | `lib/agents/agents.ts:84` → `vibe: startVibeAgent` |
| 2 | `agents.ts` calls `resolveVibeCommand` | `lib/agents/agents.ts:91` → `vibe: resolveVibeCommand` |
| 3 | `agents.ts` calls `isSpuriousVibeExit` | `lib/agents/agents.ts:961` → `!(chosen === 'vibe' && isSpuriousVibeExit(result))` |
| 4 | `review-prompts.ts` has `vibe` key in type | `lib/review/review-prompts.ts:21` → `vibe: PromptEntry` |
| 5 | `review-prompts.ts` has `vibe` key in object | `lib/review/review-prompts.ts:26` → `vibe: { review: '$review all', actOnReview: '/act-on-review' }` |
| 6 | `stats-backfill.ts` normalizer returns `vibe` | `lib/commands/stats-backfill.ts:64` → `if (/(^|[^a-z])vibe([^a-z]|$)/.test(normalized)) {return 'vibe';}` |
| 7 | `agents.ts` comment updated | `lib/agents/agents.ts:952` → `// and isSpuriousVibeExit (vibe.ts).` |
| 8 | `agents.ts` comment: "Codex and Vibe" | `lib/agents/agents.ts:951` → `// Codex and Vibe get the` |

## Next action
Execute CP-3: Rename `templates/MISTRAL.md.template` → `templates/VIBE.md.template` with updated headings.
