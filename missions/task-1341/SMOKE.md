# Smoke Evidence

## Free Text Draft

- Command: `PATH="<stub-bin>:$PATH" node /home/magnus/code/parallix-task-1341/px.js draft "hello world" --agent codex`
- Temp repo: `/tmp/task1341-free-text-rerun-YMVY6G`
- Worktree: `/tmp/task1341-free-text-rerun-YMVY6G-adhoc-hello-world`
- Task file: `/tmp/task1341-free-text-rerun-YMVY6G-adhoc-hello-world/backlog/tasks/adhoc-hello-world - hello-world.md`
- Exit status: `0`
- Prompt evidence: synthetic draft prompt now says `preserve the \`unknown\` label unless you have concrete repo-specific evidence to replace it`
- Task evidence: frontmatter contains `id: ADHOC-HELLO-WORLD-2AAE6C35`
- Task evidence: synthetic task frontmatter contains `labels: [unknown]`

## Directory Draft

- Command: `PATH="<stub-bin>:$PATH" node /home/magnus/code/parallix-task-1341/px.js draft . --agent codex`
- Temp repo: `/tmp/task1341-dir-rerun-3DsULX`
- Worktree: `/tmp/task1341-dir-rerun-3DsULX-adhoc-task1341-dir-rerun-3dsulx`
- Task file: `/tmp/task1341-dir-rerun-3DsULX-adhoc-task1341-dir-rerun-3dsulx/backlog/tasks/adhoc-task1341-dir-rerun-3dsulx - draft-mission-for-task1341-dir-rerun-3dsulx.md`
- Exit status: `0`
- Task evidence: frontmatter contains `id: ADHOC-TASK1341-DIR-RERUN-3DSULX-B5336FB7`
- Task evidence: frontmatter contains `labels: [unknown]`

## Stats Unknown Classification

- Command: `node /home/magnus/code/parallix-task-1341/px.js stats --csv-file /tmp/task1341-stats-smoke-1arcND/stats.csv --today 2026-06-24`
- Temp repo: `/tmp/task1341-stats-smoke-1arcND`
- Output evidence: weekly report shows `# unknown missions` column
- Output evidence: current week row is `1  0  0  1`, proving one unknown-classification mission was counted

## Full Test Suite

- Command: `npm test`
- Output evidence: `# tests 1640`
- Output evidence: `# pass 1618`
- Output evidence: `# fail 0`
- Output evidence: `EXIT:0`

## Graphify

- Command: `graphify update .`
- Result: `/bin/bash: rad 1: graphify: kommandot finns inte`
