# CP-3: Fix unused caught-error bindings

## Summary

Renamed unused caught-error bindings to underscore-prefixed names in 3 files:

1. **lib/agents/agents.ts:595** — `catch (err)` → `catch (_err)` in `defaultIsAgentBlockedNow` function
2. **lib/commands/draft.ts:491** — `catch (error)` → `catch (_error)` in worktree creation handler
3. **lib/core/mission-utils.ts:932** — `catch (e)` → `catch (_e)` in branch listing
4. **lib/core/mission-utils.ts:949** — `catch (err)` → `catch (_err)` in tree listing

## Goal Check

| Criterion | Evidence |
|-----------|----------|
| `catch (err)` prefixed | `lib/agents/agents.ts:595` — `catch (_err)` |
| `catch (error)` prefixed | `lib/commands/draft.ts:491` — `catch (_error)` |
| `catch (e)` prefixed | `lib/core/mission-utils.ts:932` — `catch (_e)` |
| `catch (err)` prefixed | `lib/core/mission-utils.ts:949` — `catch (_err)` |
| ESLint clean on changed files | `npx eslint lib/agents/agents.ts lib/commands/draft.ts lib/core/mission-utils.ts` — no output (0 errors) |

## Next action: Fix CP 4 — rename all unused function parameters to `_` prefix across remaining 20 files
