---
id: TASK-1327
title: sometimes the backlog.md task is in the wrong state
status: done
assignee: [codex]
created_date: '2026-06-22 03:28'
updated_date: '2026-06-22 04:49'
labels: [ai_sdlc]
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
after agents did not agree on task-1322 I read through, and approved the PR:

px review --submit-review approve --message "looks good"
[INFO] Submitting review outcome "approve" on mission/task-1322 as qwen...
[PASS] Review outcome "approve" posted on PR for mission/task-1322.
magnus@debian:~/code/parallix-task-1322$ px integrate
[INFO] Integration preflight for task-1322
[PASS] Mission branch: mission/task-1322
[PASS] Mission doc: /home/magnus/code/parallix-task-1322/missions/task-1322/MISSION.md
[PASS] Backlog task: task-1322 - prevent-backlog-task-id-recycling-collision.md (active)
[PASS] Backlog classification: ai_sdlc
[FAIL] Backlog status: expected approved, or review with an approved/merged Forgejo PR; found active
[PASS] Forgejo PR: PR #11 open
[PASS] Forgejo approval: latest formal review state is APPROVED
[PASS] Forgejo token: resolved for codex (/home/magnus/code/parallix/.forgejo-local/tokens/codex)
[PASS] Integration checkout branch: /home/magnus/code/parallix is on main
[PASS] Integration checkout conflicts: no unresolved merge entries in the git index
[WARN] Integration checkout dirty: /home/magnus/code/parallix has uncommitted changes that will be stashed temporarily
[INFO]   - D "backlog/tasks/task-1319 - session-not-found-error.md"
[WARN] Backlog context: does not resolve to /home/magnus/code/parallix. (Ignore if running from worktree to test dry-run; post-squash closeout still requires the local integration checkout).
[INFO] Forgejo configuration: allow_manual_merge assumed enabled
[WARN] Integration warnings: main-dirty, backlog-context
[INFO] Variant B automation: Backlog task closeout, worktree-path rewrite, squash commit with hook-enforced validation, Forgejo sync-merged, and mission worktree cleanup.
[FAIL] 
[FAIL] Integration preflight failed. Resolve the blockers above before running integrate.

The approval did not reach forgejo however and regardless the integration code did not trust the parallix state for approval but checked only forgejo (first check parallix, if nothing is found using forgejo as fallback for checking for appoved is ok)

Also the backlog.md task seems to be in active still (on file in the file tree, which is strange since backlog.md marks it as being in review)

After fixing that by manually editing the backlog.md task in the branch I also see that there are uncommitted files as part of the review work which also creates problems on integration:

less backlog/tasks/task-1322\ -\ prevent-backlog-task-id-recycling-collision.md 
magnus@debian:~/code/parallix-task-1322$ nano backlog/tasks/task-1322\ -\ prevent-backlog-task-id-recycling-collision.md 
magnus@debian:~/code/parallix-task-1322$ git status
På grenen mission/task-1322
Ändringar ej i incheckningskön:
  (använd ”git add <fil>...” för att uppdatera vad som ska checkas in)
  (använd ”git restore <fil>...” för att förkasta ändringar i arbetskatalogen)
        ändrad:        backlog/tasks/task-1322 - prevent-backlog-task-id-recycling-collision.md

Ospårade filer:
  (använd ”git add <fil>...” för att ta med i det som ska checkas in)
        missions/task-1322/review-events/2026-06-21T164903-implementer_disposition-1-codex.md
        missions/task-1322/review-events/2026-06-21T164903-implementer_round_summary-1-codex.md

inga ändringar att checka in (använd ”git add” och/eller ”git commit -a”)
magnus@debian:~/code/parallix-task-1322$ git add -A

Another dirty example:

[PASS] Created review event: 2026-06-22T044024-reviewer_findings-2-claude.md
[PASS] Created review event: 2026-06-22T044024-reviewer_outcome-2-claude.md
[INFO] Persisted reviewer artifacts to repo store: /home/magnus/code/parallix-task-1330/missions/task-1330/review-events/2026-06-22T044024-reviewer_findings-2-claude.md, /home/magnus/code/parallix-task-1330/missions/task-1330/review-events/2026-06-22T044024-reviewer_outcome-2-claude.md
[INFO] consumeHumanNotes: created 0 human_note events, skipped 4 workflow comments
[INFO] Posting PR comment on mission/task-1330 as claude...
[PASS] Comment posted on PR for mission/task-1330.
[INFO] Submitting review outcome "approve" on mission/task-1330 as claude...
[PASS] Review outcome "approve" posted on PR for mission/task-1330.
[INFO] Round 2: reviewer outcome = APPROVED
[PASS] Autonomous review stopped: reviewer approved the PR. Hand off to human review/integration.
[PASS] Task task-1330 transitioned to ready-for-integration and committed.
magnus@debian:~/code/parallix-task-1330$ px rebase
[INFO] Rebasing mission/task-1330 onto local main...
[PASS] Rebase completed cleanly.
[INFO] Next: npm test
[INFO] Next: px integrate task-1330 --dry-run
magnus@debian:~/code/parallix-task-1330$ px --help

Usage: px <command> [args]

Core Commands:
  mission-start [<slug>] Implementer's startup preflight.
  verify-env            Diagnostic preflight: prints a USABLE / NOT USABLE verdict with remediation.
  verify [<area>]       Run the configured repository verification gate.
  setup                 Interactive setup wizard: writes config, bootstraps Forgejo, and verifies the install.
  setup-review          Legacy Forgejo-only bootstrap for tokens, repo creation, and git review remote.
  draft [<slug>]          Mission setup automation (branch, worktree, MISSION.md).
  active [<slug>]       Run preflight then launch the execute agent in the mission worktree.
  status [<slug>]       Unified mission and repository overview.
  checkpoint [<slug>] <cp> "<next>"  Verify, commit, and push checkpoint.
  review [<slug>] [--verify|--submit|--push [--force]|--comment "<msg>"|--comment-file <path>|--submit-review <outcome> [--message "<msg>"|--message-file <path>]|--start|--continue] [--implementer <a>] [--reviewer <a>] [--focus <f>] [--max-attempts <n>] [--dry-run] [--reset] [--no-gate]
  handoff [<slug>] [--no-gate] [--force]  Sync, push, and transition mission to review.
  integrate [<slug>] [--dry-run] [--no-integration-gates]  Land a reviewed mission into the local integration checkout on main. --no-integration-gates skips integration-time staging/e2e gates.
  resolve-conflict [<slug>]       Detect merge conflicts in the mission worktree and emit resolution guidance.
  rebase [<slug>] [--push]          Rebase mission branch onto the primary integration branch (main) with auto-resolution of mission-specific conflicts.
  diff [<slug>]                Launch the primary local diff tool for branch-vs-main review.
  stats [<csv_file>|--csv-file <path>] [--today YYYY-MM-DD|--from YYYY-MM-DD --to YYYY-MM-DD] [--output <file>]  Print parallix weekly or range tables from <PARALLIX_HOME>/stats.csv; legacy retrospective CSVs remain supported.

Notes:
  - <slug> is optional if it can be inferred from the current branch, directory name, or git worktree.
  - When provided, <slug> MUST be the lowercase Backlog task key (e.g., task-073).
  - Mistyped parallix subcommands print the closest supported `px ...` suggestion when the match is unambiguous.
  - Run `px stats --help` for pre-integration stats preview examples.
  - No npm dependencies — requires Node.js built-ins only.

magnus@debian:~/code/parallix-task-1330$ px review --push
[PASS] Task task-1330 transitioned to review and committed.
[INFO] Pushing mission/task-1330 to the review provider as claude...
[INFO] Found dedicated worktree: /home/magnus/code/parallix-task-1330
[INFO] Pushing mission/task-1330 as Forgejo user magnus (force-with-lease)...
remote: 
remote: Visit the existing pull request:        
remote:   http://localhost:3300/magnus/parallix/pulls/12 merges into main        
remote: 
To http://localhost:3300/magnus/parallix.git
 + 4944beb14...330bf09a9 mission/task-1330 -> mission/task-1330 (forced update)
[INFO] PR already exists: http://localhost:3300/magnus/parallix/pulls/12
[PASS] Branch pushed and PR updated for mission/task-1330.
magnus@debian:~/code/parallix-task-1330$ git status
På grenen mission/task-1330
Ospårade filer:
  (använd ”git add <fil>...” för att ta med i det som ska checkas in)
        missions/task-1330/review-events/2026-06-22T044024-reviewer_findings-2-claude.md
        missions/task-1330/review-events/2026-06-22T044024-reviewer_outcome-2-claude.md

inget köat för incheckning, men ospårade filer finns (spåra med ”git add”)
<!-- SECTION:DESCRIPTION:END -->
