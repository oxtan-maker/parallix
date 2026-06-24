---
event_type: reviewer_findings
timestamp: 2026-06-23T17:13:51.239Z
round: 1
phase: reviewing
actor: codex
slug: task-1340
---

# Review Findings — task-1340

1. High — README now instructs users to install from the public npm registry even though `@magnusekdahl/parallix` is not published yet.
   Evidence: [README.md](/home/magnus/code/parallix-task-1340/README.md:63) describes the registry package as the supported path, [README.md](/home/magnus/code/parallix-task-1340/README.md:67) recommends `npm install -g @magnusekdahl/parallix`, and [README.md](/home/magnus/code/parallix-task-1340/README.md:159) says distribution is from the public npm registry. In the current state, `npm view @magnusekdahl/parallix version` returns `E404`, so the documented install path fails. The mission explicitly says actual publication is out of scope, so the docs need to present this as a post-publish path or keep the tarball path as the only currently working install.

2. High — The checkpoint evidence for the exclusion audit is false, so the final Goal Check is not backed by real command output.
   Evidence: [missions/task-1340/CP-2.md](/home/magnus/code/parallix-task-1340/missions/task-1340/CP-2.md:23) says the dry-run grep found zero matches, and [missions/task-1340/CP-2.md](/home/magnus/code/parallix-task-1340/missions/task-1340/CP-2.md:36) specifically claims `npm pack --dry-run | grep .local.json` returned zero matches. In reality, `npm pack --dry-run 2>&1 | grep '.local.json'` matches `config/agents.local.json.example`, and the exact combined count command documented in [missions/task-1340/CP-F.md](/home/magnus/code/parallix-task-1340/missions/task-1340/CP-F.md:39) returns `1`, not `0`. That means the CP-2 and CP-F Goal Check rows are citing incorrect evidence, which violates the mission’s requirement for real evidence in the final checkpoint.

3. Medium — ADR 0046 contains npm commands that are not supported in the current npm toolchain, so the documented rollback/signing procedure is not actionable.
   Evidence: [docs/adr/0046-npm-publish-process-and-security.md](/home/magnus/code/parallix-task-1340/docs/adr/0046-npm-publish-process-and-security.md:192) and [docs/adr/0046-npm-publish-process-and-security.md](/home/magnus/code/parallix-task-1340/docs/adr/0046-npm-publish-process-and-security.md:203) instruct the operator to use `npm yank`, while [docs/adr/0046-npm-publish-process-and-security.md](/home/magnus/code/parallix-task-1340/docs/adr/0046-npm-publish-process-and-security.md:224) claims npm supports `npm sign`. On this environment’s npm `11.12.1`, `npm help yank` and `npm help sign` both return `No matches in help`, so those commands are not valid publish guidance here.

4. Medium — The mission is marked complete even though a required gate was skipped because the referenced script does not exist.
   Evidence: [missions/task-1340/MISSION.md](/home/magnus/code/parallix-task-1340/missions/task-1340/MISSION.md:91) requires `./scripts/verify-local.sh docs` as a gate. [missions/task-1340/CP-F.md](/home/magnus/code/parallix-task-1340/missions/task-1340/CP-F.md:53) records that same gate as `Skipped (gate script not implemented)`, and there is no `scripts/verify-local.sh` in the repo. A missing required gate should be treated as unmet mission criteria or an inconsistency to resolve, not as successful completion.

## Notes

- The final checkpoint does contain a Goal Check table, but several rows rely on inaccurate evidence.
- `px review task-1340 --verify` was not runnable as a global command in this environment because `px` is not on `PATH`; `node px.js review task-1340 --verify` did run successfully and passed.

---
`[workflow-round:1, workflow-phase:reviewing]`