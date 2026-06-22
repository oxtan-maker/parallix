# CP-1: Root cause verification & detection design

## Summary
Confirmed the failure path and the exact git output that must be detected.

- `buildCreatePrPushArgs` (`lib/tools/forgejo.js:785-826`) treats every non-zero
  `gitFetch` (`fetchReviewBranch`) result as a fatal error. For a brand-new
  mission branch the remote ref does not exist, so `git fetch review
  +refs/heads/<branch>:refs/remotes/review/<branch>` exits non-zero and the
  function returns `{ok: false, error: 'failed to fetch tracking ref ...'}`,
  aborting PR creation. This is exactly the task-1316 production failure.
- Reproduced the git fetch of a missing ref locally:
  `git fetch <remote> '+refs/heads/does-not-exist:refs/remotes/review/does-not-exist'`
  exits **128** and prints `fatal: could not find remote ref refs/heads/does-not-exist`
  (English locale). The production handoff log (task file lines 24-29) shows the
  same English message, confirming the parallix operator environment emits the
  English string.
- `lib/core/git.js` does **not** force `LC_ALL`/`LANG`, so git's message is
  locale-dependent (my local box emitted the Swedish translation
  `kunde inte hitta fjärr-referensen`). Detection targets the English message
  plus the `couldn't` spelling variant called out in the mission Risks section.
  **Update (round 1):** rather than leave this as a deferred caveat, the fix
  forces a stable C locale (`LC_ALL=C`/`LANG=C`) on the inspected git calls via
  a `cLocaleEnv()` helper applied in `fetchReviewBranch` and the `createPr` push
  calls, so detection is language-independent regardless of operator locale.
  This is a deliberate, reviewer-concurred deviation from the Restricted-Areas
  note on `fetchReviewBranch`; see CP-2 "Necessary, justified deviation".

## Detection design
- Add a small predicate `isMissingRemoteRef(result)` that lowercases the
  combined stderr/stdout (`pushOutput`) and matches `could not find remote ref`
  or `couldn't find remote ref`.
- In both fetch-failure branches of `buildCreatePrPushArgs`
  (`refreshTrackingRef` path ~line 797, and the lazy fetch path ~line 808):
  - if the failure is a missing remote ref → skip `--force-with-lease`, push
    plain (`pushArgs.push(remoteUrl, branch)`), return `{ok: true, pushArgs}`.
  - otherwise → keep the existing `{ok: false, error: ...}` early return.
- Exit-code-only detection (128) is rejected: auth/network fetch failures also
  exit 128, so it cannot distinguish "new branch" from a real failure. The
  string match is the only reliable discriminator git exposes.

## Goal Check
| Checkpoint goal | Evidence |
| --- | --- |
| Identify fatal-error path for missing remote ref | `lib/tools/forgejo.js:808-813` (fetch path), `lib/tools/forgejo.js:797-802` (refresh path) |
| Confirm exact git stderr + exit code | Local repro: `fatal: could not find remote ref refs/heads/does-not-exist`, exit 128; matches task log lines 24-29 |
| Confirm message is not locale-forced | `lib/core/git.js:3-13` (`spawnSync` with no `LC_ALL`/`LANG` env) — git.js is restricted/out of scope |
| Design detection that distinguishes new-branch from real failure | String match on `could not find remote ref` / `couldn't find remote ref`; exit-128-only rejected (auth also 128) |

Next action: Implement `isMissingRemoteRef` and the two fallback branches in
`buildCreatePrPushArgs`, add the two regression tests to
`test/forgejo.test.js`, and run `npm test`.
