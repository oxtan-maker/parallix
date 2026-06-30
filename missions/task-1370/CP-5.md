# CP-5: Update .eslintignore, .gitignore, run full gate

## Work Summary

Updated `.eslintignore` and `.gitignore`:
- Restored `lib/commands/*.js` in `.gitignore` so compiled `build:cjs` output stays ignored instead of appearing as untracked churn
- Restored the canonical `.eslintignore` posture for `lib/commands/`: blanket-ignore generated and legacy `.js` without command-level negations in this wave
- Updated `MISSION.md` to match the repository's established JS→TS migration pattern: keep generated `.js` ignored, rely on `git rm --cached` + tracked `.ts` additions for rename detection, and keep `## Gates` entries executable

Reverted behavioral changes in `handoff.ts::runDeclaredGates`:
- Removed backtick-stripping (`cmd.replace(/^`(.+)`/, '$1')`) — outside faithful conversion scope
- Removed em-dash-description-stripping (`cmd.replace(/\s*[—–-].*$/, '').trim()`) — outside faithful conversion scope
- Restored original checkbox-prefix-only stripping: `line.replace(/^- \[[ x]\]\s*/, '').replace(/^- \s*/, '')`

## Goal Check

| Criterion | Evidence | Status |
|-----------|----------|--------|
| Rename ≥ 50% per file | checkpoint: 88%, handoff: 94%, active: 94%, draft: 93% (all via `git diff -M --cached`) | PASS |
| No `module.exports` remaining | `grep -rc 'module\.exports' lib/commands/{draft,active,checkpoint,handoff}.ts` returns zero matches | PASS |
| No `require()` from converted modules | All imports use ES `import` with `.js` extension | PASS |
| All exports preserved | draft: 25 exports, active: 9 exports, checkpoint: default export, handoff: 5 exports | PASS |
| TypeScript compilation clean | `npm run typecheck` — zero errors | PASS |
| Tests pass | `npm test` — 1731 pass, 0 fail, 22 skipped | PASS |
| Static-analysis gate clean | `./scripts/verify-local.sh static-analysis` — all 3 stages pass | PASS |
| Compiled output loads | `node -e "require('./lib/commands/draft')"` exit 0, `active` exit 0, `checkpoint` exit 0, `handoff` exit 0 | PASS |
| ESLint ignore preserved | `.eslintignore` still contains `lib/commands/*.js`, and no command-level negations remain to make unrelated hand-written JS fail ESLint | PASS |
| Gitignore preserved | `.gitignore` contains `lib/commands/*.js`, so generated command `.js` stays ignored instead of showing as untracked | PASS |

Next action: Final verification and handoff preparation
