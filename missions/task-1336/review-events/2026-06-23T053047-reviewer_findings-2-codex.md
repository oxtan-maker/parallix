---
event_type: reviewer_findings
timestamp: 2026-06-23T05:30:47.768Z
round: 2
phase: reviewing
actor: codex
slug: task-1336
---

# Task-1336 Review Findings

## Findings

### 1. Broken install path in the README invalidates the promised quick start and the first-300-words success claim
Severity: high

`README.md` now tells readers to start with `npm pack ./parallix` and `npm install -g ./parallix-*.tgz` at both the opening call to action and the Quick start section ([README.md](/home/magnus/code/parallix-task-1336/README.md:11), [README.md](/home/magnus/code/parallix-task-1336/README.md:59)). In this checkout there is no `parallix/` subdirectory; the package root is the repository root ([package.json](/home/magnus/code/parallix-task-1336/package.json:1)). Running the documented command fails immediately with `ENOENT` because `/home/magnus/code/parallix-task-1336/parallix/package.json` does not exist.

That is not a cosmetic issue. Success criterion 2 requires the first 300 words to tell the reader the first concrete thing to do, and CP-2/CP-4 both mark that criterion as passed using these exact lines as evidence ([missions/task-1336/CP-2.md](/home/magnus/code/parallix-task-1336/missions/task-1336/CP-2.md:32), [missions/task-1336/CP-4.md](/home/magnus/code/parallix-task-1336/missions/task-1336/CP-4.md:26)). As written, the first concrete action is broken.

### 2. The documented no-install entrypoint is also wrong, so the README and authority reference now advertise a command that cannot run
Severity: medium

The new README says a reader can run straight from a checkout with `node parallix <command>` and labels that equivalent to `node index.js <command>` ([README.md](/home/magnus/code/parallix-task-1336/README.md:72)). The extracted authority reference repeats the same claim ([docs/authority-reference.md](/home/magnus/code/parallix-task-1336/docs/authority-reference.md:17), [docs/authority-reference.md](/home/magnus/code/parallix-task-1336/docs/authority-reference.md:278)). In this repository, `node parallix --help` fails with `MODULE_NOT_FOUND` because there is no `parallix` path/module at the repo root, while `index.js` is the actual executable entrypoint.

This matters for both user-facing accuracy and the mission's extraction goal: the rewrite was supposed to move internal operational content into `docs/` without degrading it. Instead, the migration preserved an invalid invocation form in both places.

## Verification notes

- Attempted required command `px review task-1336 --verify`; `px` is not on `PATH` in this review environment (`/bin/bash: px: command not found`). I treated that as workflow inconsistency evidence and continued with direct diff inspection rather than substituting an invented command.
- Attempted `graphify query ...` per repo instructions; `graphify` is also not on `PATH` here.
- Verified command failures directly:
  - `npm pack ./parallix` → `ENOENT` for missing `/parallix/package.json`
  - `node parallix --help` → `MODULE_NOT_FOUND`

---
`[workflow-round:2, workflow-phase:reviewing]`