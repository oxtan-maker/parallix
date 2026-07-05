# Mission: Rename mistral to vibe throughout codebase (task-1422)

## Goal

Replace every internal reference to the Mistral company name with the CLI tool name `vibe` across `lib/` source files, template files, and configuration — aligning the internal naming convention of `codex→codex`, `claude→claude` with the Mistral family where the CLI tool is `vibe`. The model identifier in stats output (the `model` field inside telemetry, e.g. `'mistral'` as returned by `getMistralProviderModel()` and used in `processResult`) must remain `"mistral"` unchanged, along with the actual `vibe` binary resolution which already returns `'vibe'`.

## Why Now

The codebase is inconsistent: Codex and Claude use their CLI names both internally and externally, but the Mistral agent family is labeled `mistral` throughout the harness code (`lib/agents/mistral.ts`, `lib/index.ts` export, agent keys in `agents.ts`, `review-prompts.ts`) despite the CLI binary being `vibe`. This creates confusion for contributors reading the code and makes the agent naming scheme harder to reason about. The rename is purely internal to the parallelix repo (no user-facing API change; the `vibe` binary is invoked at runtime regardless).

## Refinement Signals

- Predicted NEL bucket: Medium (81–235)
- Confidence: High
- Selection note: The affected source files are few and clearly identifiable; grep for `mistral` in `lib/` and `templates/` returns a bounded set of meaningful targets.
- Main drivers: naming consistency, developer confusion, technical debt

## Scope

### Files to rename

| # | File (rename) | Files referencing it |
|---|---------------|---------------------|
| 1 | `lib/agents/mistral.ts` → `lib/agents/vibe.ts` | `lib/index.ts`, `lib/agents/agents.ts`, `lib/agents/mistral-telemetry.ts` (import) |
| 2 | `lib/agents/mistral-telemetry.ts` → `lib/agents/vibe-telemetry.ts` | `lib/agents/mistral.ts` (import, now `vibe.ts`), tests |

### Code changes (lib/)

1. **`lib/agents/mistral.ts`** → `lib/agents/vibe.ts`:
   - Rename file to `vibe.ts`
   - Rename all exported functions: `buildMistralInvocation` → `buildVibeInvocation`, `extractMistralSessionId` → `extractVibeSessionId`, `resolveMistralCommand` → `resolveVibeCommand`, `buildMistralInvocation` → `buildVibeInvocation`, `startMistralAgent` → `startVibeAgent`, `isSpuriousMistralExit` → `isSpuriousVibeExit`
   - Update internal references: `parseMistralMeta` import → `parseVibeMeta` (after also renaming the telemetry module), `getMistralProviderModel` → get from renamed module
   - Update type names: `MistralInvocationOptions` → `VibeInvocationOptions`, `StartMistralAgentOptions` → `StartVibeAgentOptions`
   - Update constants: `DEFAULT_MISTRAL_LOG_DIR` (renamed in telemetry module) references
   - Update all JSDoc comments and inline comments referencing "mistral" → "vibe"
   - Keep the hardcoded `'mistral'` model string on line 250 of `processResult` unchanged (stats model exception)
   - Keep the function `resolveMistralCommand()` → `resolveVibeCommand()` which returns `'vibe'` — the return value is already correct

2. **`lib/agents/mistral-telemetry.ts`** → `lib/agents/vibe-telemetry.ts`:
   - Rename file to `vibe-telemetry.ts`
   - Rename exports: `parseMistralMeta` → `parseVibeMeta`, `extractMistralTelemetry` → `extractVibeTelemetry`, `getMistralProviderModel` → `getVibeProviderModel`, `DEFAULT_MISTRAL_LOG_DIR` → `DEFAULT_VIBE_LOG_DIR`
   - Update JSDoc header and all internal comments referencing "mistral" → "vibe"
   - **Keep** the `getVibeProviderModel()` return value `{ provider: 'mistral', model: 'mistral' }` unchanged — this is the stats model identifier which is explicitly out of scope

3. **`lib/index.ts`**:
   - Change import: `import * as mistralMod from './agents/mistral.js'` → `import * as vibeMod from './agents/vibe.js'`
   - Change import for telemetry (via the renamed file): update mistral-telemetry import if referenced here (currently not directly imported here but exported)
   - Change export: `export const mistral = mistralMod;` → `export const vibe = vibeMod;`

4. **`lib/agents/agents.ts`**:
   - Change import: `import { startMistralAgent, resolveMistralCommand, isSpuriousMistralExit } from './mistral.js'` → `import { startVibeAgent, resolveVibeCommand, isSpuriousVibeExit } from './vibe.js'`
   - Change LAUNCHERS key: `mistral: startMistralAgent` → `vibe: startVibeAgent`
   - Change RESOLVERS key: `mistral: resolveMistralCommand` → `vibe: resolveVibeCommand`
   - Change HEALTH_PROBE_ARGS key: `mistral: ['--help']` → `vibe: ['--help']`
   - Update the isSpuriousMistralExit call in `startAgent` (line ~961) and isSpuriousMistralExit comments (line ~955)
   - Update all inline comments referencing "mistral" → "vibe"

5. **`lib/review/review-prompts.ts`**:
   - Change the `PromptEntrypoints` type: `mistral: PromptEntry` → `vibe: PromptEntry`
   - Change the `PROMPT_ENTRYPOINTS` object key: `mistral: { ... }` → `vibe: { ... }`

6. **`lib/commands/stats-backfill.ts`**:
   - Change `normalizeHistoricalImplementer` regex: `if (/(^|[^a-z])mistral([^a-z]|$)/.test(normalized)) {return 'mistral';}` → `if (/(^|[^a-z])vibe([^a-z]|$)/.test(normalized)) {return 'vibe';}`

7. **`lib/agents/limit-hit.ts`**:
   - Leave the `mistral` key in `PATTERN_SETS` unchanged — these error patterns must match both `"mistral"` and `"vibe"` strings in stderr/stdout from the company API. The key name serves as the group selector in `detectLimitHit`, so changing the key from `'mistral'` to `'vibe'` requires updating every caller that looks up this group. Only add `"vibe"` patterns if they're not already present; no existing `"mistral"` pattern strings should be removed.

### Files and content to rename

8. **`templates/MISTRAL.md.template`** → `templates/VIBE.md.template`:
   - Rename file
   - Update heading: `# Mistral / Vibe` → `# Vibe`
   - Update: `This is the Mistral-specific adapter` → `This is the Vibe-specific adapter`
   - Update section `## Mistral-specific runtime rules` → `## Vibe-specific runtime rules`
   - Update section `## Mistral mode mapping` → `## Vibe mode mapping`
   - Leave `## Vibe command surface` section body unchanged (already uses "Vibe")

### Files NOT changed (out of scope)

- **`lib/agents/mistral.ts` line 250**: `const model = ... ? 'mistral' : pm.model` — the model name in stats is explicitly exempted per the backlog task description. After rename the line in `vibe.ts` will read `const model = ... ? 'mistral' : pm.model`.
- **Test files**: test files require mechanical updates (agent key `mistral` → `vibe`, function name renames) because test imports reference the renamed module interfaces. These are mechanical renames only — no new tests or test logic changes. Test filenames remain unchanged.
- **`agents.ts` line 955**: the comment referencing `isSpuriousMistralExit` is updated to reference `isSpuriousVibeExit` as part of the source rename, but the semantic meaning ("spurious exit handling for this agent family") does not change.

## Out of Scope

- Renaming test files or test content under `test/` (tests adapt mechanically to renamed imports)
- Updating user-facing `~/.vibe` directories, environment variables (`VIBE_HOME`, `VIBE_ACTIVE_MODEL`), or config files
- Updating `graphify` index or documentation outside the `templates/` scope
- Changing the model provider or model string in stats output telemetry (must remain `"mistral"`)
- Updating CI configuration, Docker setup scripts, or deployment artifacts
- Migrating any persistent state or migration for historical `mistral` agent names in blocklist data

## Success Criteria

> **Falsifiability rule (ADR 0039 Part 2):** Each criterion is falsifiable with concrete evidence.

1. All source files under `lib/` no longer reference the identifier `mistral` as a module name, function name, or import path. (Grep for `mistral` in `lib/` must only find occurrences inside string literals that are the stats model name `'mistral'` in `lib/agents/vibe.ts:250` and `lib/agents/vibe-telemetry.ts:158`, and in error-pattern regex strings in `lib/agents/limit-hit.ts:29-38`.)
2. `lib/agents/vibe.ts` exists and exports `buildVibeInvocation`, `startVibeAgent`, `resolveVibeCommand`, `isSpuriousVibeExit`, `extractVibeSessionId`, `processResult`, `ensureVibeHome`, `vibeConfigPath`, `vibeHomeRoot`, `vibeSessionLogDir`.
3. `lib/agents/vibe-telemetry.ts` exists and exports `parseVibeMeta`, `extractVibeTelemetry`, `getVibeProviderModel`, `DEFAULT_VIBE_LOG_DIR`.
4. `lib/index.ts` exports `vibe` (not `mistral`) as a named export with the same interface shape as the previous `mistral` export.
5. `lib/agents/agents.ts` uses `vibe` as the agent key in `LAUNCHERS`, `RESOLVERS`, and `HEALTH_PROBE_ARGS`, and calls `startVibeAgent`, `resolveVibeCommand`, `isSpuriousVibeExit` (not the `Mistral`-prefixed variants).
6. `lib/review/review-prompts.ts` has `vibe` as a key in `PromptEntrypoints` and `PROMPT_ENTRYPOINTS` (not `mistral`).
7. `lib/commands/stats-backfill.ts` `normalizeHistoricalImplementer` recognizes `vibe` (returns `'vibe'`) instead of `mistral`.
8. `templates/VIBE.md.template` exists (renamed from `MISTRAL.md.template`), with all headings and section titles updated to use "Vibe".
9. `./scripts/verify-local.sh all` passes on the final tree (no static-analysis or test failures in the affected areas).

## Risks and Assumptions

- **Assumption**: No internal code imports these modules via subpath resolution outside the direct imports listed above (all consumers go through `lib/index.ts` barrel exports or direct relative imports). Verified by the grep result showing 25 `lib/` matches — all accounted for.
- **Risk**: A downstream consumer (e.g. a published npm package or a script outside this repo) may import `lib/agents/mistral.js` directly. If so, a deprecation alias in `lib/index.ts` may be needed. Out of scope for this mission to investigate; flagged for post-merge follow-up.
- **Risk**: The `mistral` key in `PATTERN_SETS` inside `limit-hit.ts` is looked up by callers using the agent string. If internal callers pass `'mistral'` instead of `'vibe'` to `detectLimitHit`, the lookup will break. The rename in `agents.ts` must update every call site to pass `'vibe'`.
- **Assumption**: The `'mistral'` model string in `processResult` and `getVibeProviderModel` is intentional and does not need to change — the backlog task explicitly says "skip the model in stats, keep as is".

## Checkpoints

- CP 1: Rename files and update all module imports/exports in `lib/`. Confirm `lib/index.ts` exports `vibe` (not `mistral`), `lib/agents/agents.ts` uses `vibe` as the agent key, and `lib/agents/vibe.ts` + `lib/agents/vibe-telemetry.ts` exist with correct exports.
- CP 2: Update all functional references — `agents.ts` call sites (`startVibeAgent`, `resolveVibeCommand`, `isSpuriousVibeExit`), `review-prompts.ts` agent key, `stats-backfill.ts` normalizer, `limit-hit.ts` key.
- CP 3: Rename `templates/MISTRAL.md.template` → `templates/VIBE.md.template` with updated headings.
- CP 4: Verify with `./scripts/verify-local.sh all` — all affected areas pass static analysis and tests.

## Gates

- [x] ./scripts/verify-local.sh all

## Restricted Areas

- Do not modify test files beyond mechanical renames necessitated by the module rename (agent key `mistral` → `vibe`, function name renames) and pre-existing infrastructure fixes required for the gate to pass (e.g., Node version guards for `--experimental-strip-types`).
- Do not delete or revert files belonging to other missions/tasks on this shared branch (e.g., `missions/task-1415/`, `missions/task-1417/`, `backlog/completed/task-*`, `backlog/tasks/task-1421`, `backlog/tasks/task-1424`, `backlog/tasks/task-1425`, `backlog/tasks/task-1426`). The `git diff --name-status main..HEAD` must contain zero deletions outside the task-1422 scope.
- Do not modify `lib/agents/limit-hit.ts` PATTERN_SETS entries beyond adding any missing `"vibe"` patterns (the key must remain the group selector; do not remove existing patterns).
- Do not change the `'mistral'` model string in `lib/agents/vibe.ts:250` or `lib/agents/vibe-telemetry.ts:158`.
- Do not modify any published package metadata, npm publish config, or CI/CD pipelines.

## Stop Rules

- Stop if `./scripts/verify-local.sh static-analysis` fails on unrelated modules (outside the files listed in Scope) — this signals a missed import or unexpected dependency.
- Stop if any `test/` file fails after a successful rename — test failures indicate an external consumer not covered by the internal rename scope.
- Stop if a reference to the old `mistral` module path remains in any `lib/` file that is not covered by the Scope list above or by the intentional exemptions (model string in stats, error patterns in limit-hit).
