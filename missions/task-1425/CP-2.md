# CP-2: Extract mission path/document and branch/worktree helpers

## Summary

Moved the mission path/document domain (adapter resolution, `missionBaseDir`,
`missionUsesYearTier`, `missionBranchPrefix`/`missionBranchName`/`missionBranchRef`,
`isMissionSlugCandidate`, `extractSlugFromBranch`, `getMissionYear`,
`missionDirForSlug`, `missionPathForSlug`, `findMissionDir`, `inferSlug`,
`findCheckpoints`/`compareCheckpointFiles`/`checkpointOrder`, `getFirstLine`,
`missionTitle`, `SUPPORTED_VERIFY_AREAS`, `normalizeVerifyArea`,
`detectMissionAreaFromContent`, `findMissionArea`) into
`lib/core/mission-utils/paths.ts` with signatures and default parameter behavior
(`rootDir: string = process.cwd()`, etc.) preserved byte-for-byte from the original
`lib/core/mission-utils.ts`.

Moved the branch/worktree/base-branch domain (`getPrimaryBranch`, `resolveMainRepo`,
`getPrimaryWorktree`, `conventionalWorktreePath`, `conventionalBaseWorktreePath`,
`detectLaunchBaseBranch`, `parseBaseBranchLine`, `readRecordedBaseBranch`,
`resolveMissionBaseBranch`, `findWorktreeForBranch` (internal), `resolveBaseWorktree`,
`resolveWorktree`) into `lib/core/mission-utils/worktree.ts`, importing the adapter
and path helpers it depends on (`resolveMissionAdapter`, `missionBaseDir`,
`missionBranchPrefix`, `missionBranchName`, `missionBranchRef`, `findMissionDir`,
`getMissionYear`) directly from `./paths.js` rather than duplicating them, so there
is a single source of truth for adapter/path resolution.

`process.cwd()` defaults, adapter config lookups (`loadAdapterConfig`), and git
runner injection parameters (`gitFn`/`options.gitFn`) were preserved unchanged on
every moved function signature.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Mission path/document helpers isolated in one module | `lib/core/mission-utils/paths.ts:37` (`missionBaseDir`), `lib/core/mission-utils/paths.ts:117` (`missionDirForSlug`), `lib/core/mission-utils/paths.ts:132` (`findMissionDir`) | PASS |
| Branch/worktree/base-branch helpers isolated in one module | `lib/core/mission-utils/worktree.ts:16` (`getPrimaryBranch`), `lib/core/mission-utils/worktree.ts:277` (`resolveBaseWorktree`), `lib/core/mission-utils/worktree.ts:314` (`resolveWorktree`) | PASS |
| Year-tier mission lookup behavior locked | `test/mission-utils.test.js`, `"findMissionDir and getMissionYear handle year rollover and prior-year missions"`, `"getMissionYear resolves year from a configured non-default baseDir (task-1209 SC1)"` | PASS |
| Base-worktree auto-create behavior locked | `test/mission-utils.test.js`, `"resolveBaseWorktree auto-creates a worktree on the base branch when none is checked out"` | PASS |
| `process.cwd()`/adapter/git-runner defaults preserved | `lib/core/mission-utils/worktree.ts:16` (`rootDirOrGitFn: string \| Function = process.cwd()`), `lib/core/mission-utils/paths.ts:22` (`resolveMissionAdapter(rootDir: string = process.cwd())`) | PASS |
| Facade still resolves these symbols for existing callers | `node --test test/mission-utils.test.js` (41/41 passing) | PASS |

Next action: extract graphify probe/update helpers and merge/artifact/noise helpers into `lib/core/mission-utils/graphify.ts` and `lib/core/mission-utils/merge-noise.ts` per CP-3.
