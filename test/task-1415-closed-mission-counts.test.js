const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const stats = require('../lib/commands/stats');
const { recordPostIntegrationStats } = require('../lib/commands/integrate');

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  }
  return result;
}

// task-1415: "px stats shows stale mission counts when missions are closed."
//
// Investigation across `summarizeMissionWindow`, `summarizeAgentWindow`,
// `rowInWindow`, `canonicalizeStatsRow`, and `upsertStatsRow` found all of
// them already correct on main:
//   - `summarizeMissionWindow` filters to `closed: 'yes'` rows (task-1380).
//   - `summarizeAgentWindow` intentionally does NOT filter by `closed`
//     (task-1409) — its per-mission dedup (`byMission`, keyed on
//     `statsMissionKey` only) already collapses every stage row for a
//     mission down to one winner, so multiple stage rows can't inflate
//     agent counts either.
//   - `rowInWindow` is inclusive on both boundaries; `buildWeeklyWindows`
//     has no gap/overlap.
//   - `upsertStatsRow`'s dedup key includes `stage`, so an integration row
//     (`stage: 'default'`, `closed: 'yes'`) never collides with an earlier
//     stage row (`stage: 'active'|'draft'|'review'|'follow-up'`).
//
// The real defect was in `lib/commands/integrate.ts`:
// `recordPostIntegrationStats` derived the closed row's `date` from
// `git log -1 --format=%cs` on the base worktree *after* integration. In
// "Variant A" (PR already merged on Forgejo before `px integrate` runs),
// `finalizeVariantACloseout` only creates a new commit when there is a
// staged diff; when there isn't, no commit is made and `git log -1` returns
// whatever committer date the branch tip already carried — which can be
// the *original* mission commit's date from days earlier, not the day the
// mission was actually closed. The closed row then landed outside the
// current week's window even though closure just happened "today" —
// exactly the reported symptom (stats.csv rows increase, weekly mission
// counts don't move).
//
// Fix: `recordPostIntegrationStats` no longer derives `date` from git at
// all. It omits `date` entirely, letting `recordIntegrationStats` (and
// every other stats writer: `recordStageStats`, `recordActiveStats`, ...)
// fall back to its own default of "today", which is what "the mission
// closed" is actually supposed to mean.
//
// This test drives the real, unmocked integration path end-to-end against
// a real git repo whose tip commit is deliberately stamped with a
// three-week-old committer date (simulating the Variant A no-new-commit
// fast-forward path) and asserts the resulting closed row still lands in
// the current week. Before the fix this failed (the row was dated
// 2026-06-13 and excluded from both weekly windows); after the fix it
// passes (the row is dated "today" via the system clock).

test('task-1415: recordPostIntegrationStats counts a closed mission in the current week even when the base worktree tip commit is stale', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1415-integrate-'));
  const csvFile = path.join(root, 'stats.csv');

  git(['init'], root);
  git(['config', 'user.email', 'task-1415@example.com'], root);
  git(['config', 'user.name', 'Task 1415'], root);

  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  const taskFile = path.join(root, 'backlog', 'tasks', 'task-1388 - Example Mission.md');
  fs.writeFileSync(taskFile, [
    '---',
    'id: TASK-1388',
    'labels: [ai_sdlc]',
    'assignee: [codex]',
    'status: review',
    '---',
    '',
  ].join('\n'));

  // Simulate the Variant A fast-forward closeout: the base worktree's tip
  // commit is the mission's own commit from three weeks ago, stamped with an
  // old committer date via GIT_COMMITTER_DATE — exactly what `git log -1
  // --format=%cs` would report when `finalizeVariantACloseout` makes no new
  // closeout commit.
  git(['add', '.'], root);
  const staleDate = '2026-06-13T12:00:00';
  spawnSync('git', ['commit', '-m', 'mission commit from three weeks ago'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: staleDate,
      GIT_COMMITTER_DATE: staleDate,
    },
  });

  const committerDate = git(['log', '-1', '--format=%cs'], root).stdout.trim();
  assert.equal(committerDate, '2026-06-13',
    'fixture setup: base worktree tip commit must carry the stale committer date');

  try {
    recordPostIntegrationStats('task-1388', {
      rootDir: root,
      recordIntegrationStatsFn: (opts) => stats.recordIntegrationStats({ ...opts, filePath: csvFile }),
    });

    const csvData = stats.loadStatsCsv(csvFile, { rootDir: root });
    assert.equal(csvData.rows.length, 1);
    assert.equal(csvData.rows[0].closed, 'yes');
    assert.notEqual(csvData.rows[0].date, '2026-06-13',
      'the closed row must not be stamped with the stale base-worktree committer date');

    const todayReport = stats.renderWeeklyStatsReport(csvData.rows, { today: csvData.rows[0].date });
    const currentSection = todayReport.split('Current week')[1] || '';
    const currentDataLine = currentSection.split('\n').find(l => /^\d/.test(l));
    const missionCount = Number((currentDataLine || '').trim().split(/\s+/)[0]);

    assert.equal(missionCount, 1,
      'a mission closed via recordPostIntegrationStats must count in the week it was actually closed, ' +
      'regardless of how old the base worktree\'s tip commit is');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
