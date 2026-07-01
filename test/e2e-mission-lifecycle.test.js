const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const packageJson = require('../package.json');

const CLI_ENTRY = path.resolve(__dirname, '..', packageJson.bin.px);

function runCommand(command, args, options = {}) {
  const result = childProcess.spawnSync(command, args, {
    encoding: 'utf8',
    ...options
  });
  if (result.error && result.status === null) {
    throw result.error;
  }
  return result;
}

function runGit(cwd, args, options = {}) {
  const result = runCommand('git', args, { cwd, ...options });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return (result.stdout || '').trim();
}

function commandDir(command) {
  const probe = runCommand('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  if (probe.status !== 0) {
    throw new Error(`Could not resolve command on PATH: ${command}`);
  }
  return (probe.stdout || '').trim();
}

function maybeCommandPath(command) {
  const probe = runCommand('bash', ['-lc', `command -v ${command}`], { encoding: 'utf8' });
  return probe.status === 0 ? (probe.stdout || '').trim() : null;
}

function writeExecutable(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function lifecycleStubSource() {
  return `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');

function writeFile(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
}

function read(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function match(prompt, regex) {
  const found = prompt.match(regex);
  return found ? found[1].trim() : null;
}

function taskIdFromTask(taskPath) {
  const content = read(taskPath);
  const idMatch = content.match(/^id:\\s*([^\\r\\n]+)/m);
  return idMatch ? idMatch[1].trim() : 'TASK-UNKNOWN';
}

function missionTitleFromTask(taskPath, slug) {
  const content = read(taskPath);
  const titleMatch = content.match(/^title:\\s*([^\\r\\n]+)/m);
  return titleMatch ? titleMatch[1].trim() : slug;
}

const prompt = process.argv[process.argv.length - 1] || '';
const slug = match(prompt, /^Slug:\\s*(task-[a-z0-9-]+)/im)
  || match(prompt, /^Mode: act-on-review\\. Branch:\\s*mission\\/(task-[a-z0-9-]+)/im)
  || match(prompt, /^Mode: review\\. .*?Mission:\\s+.*?(task-[a-z0-9-]+)/im)
  || 'task-unknown';
const missionPath = match(prompt, /^Mission path:\\s*(.+)$/m) || match(prompt, /^Mission:\\s*(.+)$/m);
const missionDir = match(prompt, /^Mission dir:\\s*(.+)$/m) || (missionPath ? path.dirname(missionPath) : null);
const taskPath = match(prompt, /^Backlog task:\\s*(.+)$/m);
const reviewFindingsPath = match(prompt, /\\\`([^\\\`\\n]+-review-findings\\.md)\\\`/);
const reviewOutcomePath = match(prompt, /\\\`([^\\\`\\n]+-review-outcome\\.md)\\\`/);
const reviewVerdictPath = match(prompt, /\\\`([^\\\`\\n]+-review-verdict\\.txt)\\\`/);
const resolutionPath = match(prompt, /\\\`([^\\\`\\n]+-round-resolution\\.md)\\\`/);
const dispositionPath = match(prompt, /\\\`([^\\\`\\n]+-review-disposition\\.txt)\\\`/);

if (process.argv.includes('--help')) {
  process.stdout.write('stub opencode help\\n');
  process.exit(0);
}

if (/^Mode: draft\\./m.test(prompt)) {
  const taskId = taskIdFromTask(taskPath);
  const title = missionTitleFromTask(taskPath, slug);
  const missionBody = [
    '---',
    'id: ' + taskId,
    'title: ' + title,
    'status: drafted',
    '---',
    '',
    '# Mission: ' + title + ' (' + slug + ')',
    '',
    '## Goal',
    'Exercise the real lifecycle with a deterministic stub agent.',
    '',
    '## Why Now',
    'Protect the TypeScript workflow surface from regression drift.',
    '',
    '## Refinement Signals',
    '- Predicted NEL bucket: Small (0-80)',
    '- Confidence: High',
    '- Selection note: activate as-is',
    '- Main drivers: e2e coverage',
    '',
    '## Scope',
    '- Run draft, active, review, and integrate through the real CLI.',
    '',
    '## Out of Scope',
    '- Real model execution',
    '',
    '## Success Criteria',
    '- Lifecycle completes with deterministic artifacts.',
    '',
    '## Risks and Assumptions',
    '- Stubbed codex replaces all agent output.',
    '',
    '## Checkpoints',
    '- CP 1: Draft and execute',
    '- CP 2: Review and integrate',
    '',
    '## Gates',
    '- [ ] node -e ""',
    '',
    '## Restricted Areas',
    '- None in the temp repo.',
    '',
    '## Stop Rules',
    '- Stop if the stub cannot satisfy the real workflow contract.',
    ''
  ].join('\\n');
  writeFile(missionPath, missionBody);
  writeFile(path.join(missionDir, 'milestone-1.md'), '# Milestone 1\\n\\nDraft scaffold complete.\\n');
}

if (/^Mode: execute after lock\\./m.test(prompt)) {
  const cp1 = [
    '# CP-1: Execute stub',
    '',
    '## Goal Check',
    '',
    '| Criterion | Evidence | Status |',
    '|-----------|----------|--------|',
    '| Mission scaffold exists | missions/' + slug + '/MISSION.md:1 | PASS |',
    '| Backlog task preserved | backlog/tasks/' + path.basename(taskPath) + ':1 | PASS |',
    '',
    'Next action: Run review.',
    ''
  ].join('\\n');
  const cp2 = [
    '# CP-2: Ready for review',
    '',
    '## Goal Check',
    '',
    '| Criterion | Evidence | Status |',
    '|-----------|----------|--------|',
    '| Execute artifacts committed | missions/' + slug + '/CP-1.md:1 | PASS |',
    '| Final checkpoint present | missions/' + slug + '/CP-2.md:1 | PASS |',
    '',
    'Next action: Approve the mission in review.',
    ''
  ].join('\\n');
  writeFile(path.join(missionDir, 'CP-1.md'), cp1);
  writeFile(path.join(missionDir, 'CP-2.md'), cp2);
  writeFile(path.join(process.cwd(), 'deliverable.txt'), 'stub execute output\\n');
}

if (/^Mode: review\\./m.test(prompt)) {
  writeFile(reviewFindingsPath, '# Findings\\n\\nNo blocking findings. The lifecycle artifacts are present and consistent.\\n');
  writeFile(reviewOutcomePath, 'Verdict: approve\\n\\nLifecycle approved for integration.\\n');
  writeFile(reviewVerdictPath, 'approve\\n');
}

if (/^Mode: act-on-review\\./m.test(prompt)) {
  writeFile(resolutionPath, 'fixed_items: []\\npushed_back_items: []\\nparked_items: []\\nblocked_reason: ""\\n');
  writeFile(dispositionPath, 'CHANGES_MADE\\n');
}

process.stdout.write('{"sessionID":"ses_stubbed_opencode"}\\n');
`;
}

function createTask(repoRoot, slug, title) {
  const taskPath = path.join(repoRoot, 'backlog', 'tasks', `${slug} - ${title.replace(/\s+/g, '-').toLowerCase()}.md`);
  const taskId = slug.toUpperCase();
  const body = [
    '---',
    `id: ${taskId}`,
    `title: ${title}`,
    'status: backlog',
    'assignee: []',
    "created_date: '2026-07-01 00:00'",
    'labels: [ai_sdlc]',
    'dependencies: []',
    '---',
    '',
    '## Description',
    '',
    'End-to-end lifecycle probe.',
    ''
  ].join('\n');
  fs.writeFileSync(taskPath, body, 'utf8');
  return taskPath;
}

function setupRepository({ slug, title }) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-e2e-'));
  const repoRoot = path.join(tmpRoot, 'repo');
  const binDir = path.join(repoRoot, 'bin');
  const stateHome = path.join(tmpRoot, 'parallix-home');
  const reviewTmpDir = path.join(tmpRoot, 'review-artifacts');

  fs.mkdirSync(path.join(repoRoot, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'backlog', 'completed'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'backlog', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'config'), { recursive: true });
  fs.mkdirSync(reviewTmpDir, { recursive: true });

  writeExecutable(path.join(binDir, 'opencode'), lifecycleStubSource());
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  fs.symlinkSync(commandDir('git'), path.join(binDir, 'git'));
  fs.symlinkSync(commandDir('bash'), path.join(binDir, 'bash'));
  fs.symlinkSync(commandDir('id'), path.join(binDir, 'id'));
  const graphifyPath = maybeCommandPath('graphify');
  if (graphifyPath) {
    fs.symlinkSync(graphifyPath, path.join(binDir, 'graphify'));
  }

  fs.writeFileSync(path.join(repoRoot, 'workflow.config.json'), JSON.stringify({
    product: {
      name: 'e2e-probe',
      targetUser: 'tests'
    },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
      agents: { models: { custom: 'stub/custom' } },
      missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: '../<repo>-<slug>' },
      verification: { command: ':', defaultArea: 'all' },
      review: { provider: 'none', tmpDir: reviewTmpDir }
    }
  }, null, 2));

  fs.writeFileSync(path.join(repoRoot, 'config', 'state-map.json'), JSON.stringify({
    ready: 'refined',
    approved: 'ready-for-integration'
  }, null, 2));

  fs.writeFileSync(path.join(repoRoot, 'README.md'), '# E2E Probe\n', 'utf8');
  createTask(repoRoot, slug, title);

  runGit(repoRoot, ['init', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.email', 'test@example.com']);
  runGit(repoRoot, ['config', 'user.name', 'Parallix E2E']);
  runGit(repoRoot, ['add', '.']);
  runGit(repoRoot, ['commit', '-m', 'initial test repo']);

  return {
    tmpRoot,
    repoRoot,
    binDir,
    stateHome,
    reviewTmpDir
  };
}

function workflowEnv(binDir, stateHome, repoRoot) {
  return {
    ...process.env,
    FORCE_COLOR: '0',
    FORGEJO_USER: 'custom',
    PRIMARY_WORKTREE: repoRoot,
    PARALLIX_HOME: stateHome,
    PATH: binDir
  };
}

function runWorkflow(repoRoot, env, args, timeout = 60000) {
  const stdoutPath = path.join(os.tmpdir(), `parallix-e2e-stdout-${process.pid}-${Date.now()}.log`);
  const stderrPath = path.join(os.tmpdir(), `parallix-e2e-stderr-${process.pid}-${Date.now()}.log`);
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  let result;
  try {
    result = childProcess.spawnSync(process.execPath, [CLI_ENTRY, ...args], {
      cwd: repoRoot,
      env,
      timeout,
      stdio: ['ignore', stdoutFd, stderrFd]
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  result.stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
  result.stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, 'utf8') : '';
  fs.rmSync(stdoutPath, { force: true });
  fs.rmSync(stderrPath, { force: true });
  if (result.error && result.status === null) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `px ${args.join(' ')} failed (status=${result.status}, signal=${result.signal}, error=${result.error ? result.error.message : 'none'})\n` +
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return result;
}

function worktreePathFor(repoRoot, slug) {
  return path.resolve(repoRoot, '..', `${path.basename(repoRoot)}-${slug}`);
}

function shouldKeepTmp() {
  return process.env.PARALLIX_E2E_KEEP_TMP === '1';
}

function taskFileIn(rootDir, slug) {
  const candidateDirs = [
    path.join(rootDir, 'backlog', 'tasks'),
    path.join(rootDir, 'backlog', 'completed'),
    path.join(rootDir, 'backlog', 'archive')
  ];
  for (const dir of candidateDirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }
    const match = fs.readdirSync(dir)
      .map(name => path.join(dir, name))
      .find(filePath => path.basename(filePath).startsWith(slug));
    if (match) {
      return match;
    }
  }
  return null;
}

function taskStatus(taskPath) {
  const content = fs.readFileSync(taskPath, 'utf8');
  const match = content.match(/^status:\s*([^\r\n]+)/m);
  return match ? match[1].trim().toLowerCase() : null;
}

function missionPath(rootDir, slug) {
  return path.join(rootDir, 'missions', slug, 'MISSION.md');
}

function missionDir(rootDir, slug) {
  return path.join(rootDir, 'missions', slug);
}

function reviewState(rootDir, slug) {
  return JSON.parse(fs.readFileSync(path.join(missionDir(rootDir, slug), 'review-state.json'), 'utf8'));
}

function reviewEventFiles(rootDir, slug) {
  const eventDir = path.join(missionDir(rootDir, slug), 'review-events');
  return fs.existsSync(eventDir)
    ? fs.readdirSync(eventDir).sort()
    : [];
}

function checkpointFiles(rootDir, slug) {
  return fs.readdirSync(missionDir(rootDir, slug))
    .filter(name => /^CP-\d+\.md$/.test(name))
    .sort();
}

function readMissionId(missionFile) {
  const content = fs.readFileSync(missionFile, 'utf8');
  const match = content.match(/^id:\s*([^\r\n]+)/m);
  return match ? match[1].trim() : null;
}

function countTaskIds(rootDir, id) {
  let count = 0;
  for (const dir of ['tasks', 'completed', 'archive']) {
    const fullDir = path.join(rootDir, 'backlog', dir);
    if (!fs.existsSync(fullDir)) {
      continue;
    }
    for (const name of fs.readdirSync(fullDir)) {
      const content = fs.readFileSync(path.join(fullDir, name), 'utf8');
      if (new RegExp(`^id:\\s*${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').test(content)) {
        count += 1;
      }
    }
  }
  return count;
}

function assertCheckpointShape(rootDir, slug, expectedFiles) {
  const files = checkpointFiles(rootDir, slug);
  assert.deepEqual(files, expectedFiles);
  for (const file of files) {
    const content = fs.readFileSync(path.join(missionDir(rootDir, slug), file), 'utf8');
    assert.match(content, /^# CP-\d+:/m, `${file} should have a checkpoint heading`);
    assert.match(content, /^## Goal Check$/m, `${file} should have an exact Goal Check heading`);
    assert.match(content, /^Next action:\s+\S/m, `${file} should have a non-generic Next action line`);
  }
}

function runScenario({ launchFromFeatureBranch = false, integrate = true }) {
  const slug = launchFromFeatureBranch ? 'task-2001' : 'task-2002';
  const title = launchFromFeatureBranch ? 'Feature Branch Lifecycle' : 'Primary Branch Lifecycle';
  const repo = setupRepository({ slug, title });
  const env = workflowEnv(repo.binDir, repo.stateHome, repo.repoRoot);
  const worktree = worktreePathFor(repo.repoRoot, slug);
  /** @type {any} */
  const summary = {
    slug,
    repoRoot: repo.repoRoot,
    worktree,
    draft: null,
    active: null,
    integrate: null
  };

  try {
    const mainHeadBefore = runGit(repo.repoRoot, ['rev-parse', 'HEAD']);

    if (launchFromFeatureBranch) {
      runGit(repo.repoRoot, ['checkout', '-b', 'feature/e2e-base']);
    }

    runWorkflow(repo.repoRoot, env, ['draft', slug, '--agent', 'custom']);

    assert.ok(fs.existsSync(worktree), `expected mission worktree at ${worktree}`);
    const worktreeTask = taskFileIn(worktree, slug);
    assert.ok(worktreeTask, 'draft should bootstrap the backlog task into the worktree');
    assert.equal(taskStatus(worktreeTask), 'refined');

    const draftedMission = fs.readFileSync(missionPath(worktree, slug), 'utf8');
    assert.match(draftedMission, /^---[\s\S]*^---$/m);
    assert.match(draftedMission, /^## Goal$/m);
    if (launchFromFeatureBranch) {
      assert.match(draftedMission, /^Base-Branch:\s*feature\/e2e-base$/m);
    } else {
      assert.doesNotMatch(draftedMission, /^Base-Branch:/m);
    }

    summary.draft = {
      taskStatus: taskStatus(worktreeTask),
      missionId: readMissionId(missionPath(worktree, slug)),
      missionHasBaseBranch: /^Base-Branch:/m.test(draftedMission)
    };

    runWorkflow(worktree, env, ['active', slug, '--implementer', 'custom']);

    const state = reviewState(worktree, slug);
    summary.active = {
      taskStatus: taskStatus(worktreeTask),
      checkpointFiles: checkpointFiles(worktree, slug),
      milestoneFiles: fs.readdirSync(missionDir(worktree, slug))
        .filter(name => name.startsWith('milestone-') && name.endsWith('.md'))
        .sort(),
      reviewState: {
        phase: state.phase,
        disposition: state.disposition
      },
      reviewEvents: reviewEventFiles(worktree, slug),
      taskIdCount: countTaskIds(worktree, summary.draft.missionId)
    };

    if (!integrate) {
      return summary;
    }

    runWorkflow(worktree, env, ['integrate', slug, '--no-integration-gates']);

    const rootTask = taskFileIn(repo.repoRoot, slug);
    assert.ok(rootTask, 'integrate should leave the task in the base checkout');
    assert.equal(taskStatus(rootTask), 'done');
    assert.ok(!fs.existsSync(worktree), 'integrate should clean up the mission worktree');

    const mainHeadAfter = runGit(repo.repoRoot, ['rev-parse', 'main']);
    if (launchFromFeatureBranch) {
      const featureHeadAfter = runGit(repo.repoRoot, ['rev-parse', 'feature/e2e-base']);
      assert.equal(mainHeadAfter, mainHeadBefore, 'main must remain unchanged for feature-branch missions');
      assert.notEqual(featureHeadAfter, mainHeadBefore, 'feature base branch should receive the landed squash commit');
    } else {
      assert.notEqual(mainHeadAfter, mainHeadBefore, 'main should advance after integrating a primary-branch mission');
    }

    summary.integrate = {
      rootTaskStatus: taskStatus(rootTask),
      worktreeExistsAfter: fs.existsSync(worktree),
      mainHeadBefore,
      mainHeadAfter
    };
    if (launchFromFeatureBranch) {
      summary.integrate.featureHeadAfter = runGit(repo.repoRoot, ['rev-parse', 'feature/e2e-base']);
    }

    return summary;
  } finally {
    if (!shouldKeepTmp()) {
      fs.rmSync(repo.tmpRoot, { recursive: true, force: true });
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  }
}

function runScenarioInChild(options) {
  const encoded = Buffer.from(JSON.stringify(options), 'utf8').toString('base64');
  const stdoutPath = path.join(os.tmpdir(), `parallix-e2e-child-stdout-${process.pid}-${Date.now()}.log`);
  const stderrPath = path.join(os.tmpdir(), `parallix-e2e-child-stderr-${process.pid}-${Date.now()}.log`);
  const stdoutFd = fs.openSync(stdoutPath, 'w');
  const stderrFd = fs.openSync(stderrPath, 'w');
  let result;
  try {
    result = childProcess.spawnSync(process.execPath, [__filename, '--scenario', encoded], {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', stdoutFd, stderrFd]
    });
  } finally {
    fs.closeSync(stdoutFd);
    fs.closeSync(stderrFd);
  }
  result.stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, 'utf8') : '';
  result.stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, 'utf8') : '';
  fs.rmSync(stdoutPath, { force: true });
  fs.rmSync(stderrPath, { force: true });
  if (result.error && result.status === null) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `scenario child failed (status=${result.status}, signal=${result.signal})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }
  return JSON.parse((result.stdout || '').trim());
}

if (process.argv[2] === '--scenario') {
  const payload = JSON.parse(Buffer.from(process.argv[3], 'base64').toString('utf8'));
  const summary = runScenario(payload);
  process.stdout.write(JSON.stringify(summary));
  process.exit(0);
}

test('feature-branch lifecycle drafts from the recorded base and integrates back into that feature branch', () => {
  const summary = runScenarioInChild({ launchFromFeatureBranch: true, integrate: true });
  assert.equal(summary.draft.taskStatus, 'refined');
  assert.equal(summary.draft.missionHasBaseBranch, true);
  assert.equal(summary.active.taskStatus, 'ready-for-integration');
  assert.equal(summary.active.reviewState.phase, 'approved');
  assert.equal(summary.active.reviewState.disposition, 'APPROVED');
  assert.deepEqual(summary.active.checkpointFiles, ['CP-1.md', 'CP-2.md']);
  assert.equal(summary.integrate.rootTaskStatus, 'done');
  assert.equal(summary.integrate.worktreeExistsAfter, false);
  assert.equal(summary.integrate.mainHeadAfter, summary.integrate.mainHeadBefore);
  assert.notEqual(summary.integrate.featureHeadAfter, summary.integrate.mainHeadBefore);
});

test('primary-branch lifecycle integrates cleanly to main and marks the task done', () => {
  const summary = runScenarioInChild({ launchFromFeatureBranch: false, integrate: true });
  assert.equal(summary.draft.taskStatus, 'refined');
  assert.equal(summary.draft.missionHasBaseBranch, false);
  assert.equal(summary.active.taskStatus, 'ready-for-integration');
  assert.deepEqual(summary.active.checkpointFiles, ['CP-1.md', 'CP-2.md']);
  assert.equal(summary.integrate.rootTaskStatus, 'done');
  assert.equal(summary.integrate.worktreeExistsAfter, false);
  assert.notEqual(summary.integrate.mainHeadAfter, summary.integrate.mainHeadBefore);
});

test('artifact-focused run produces mission, checkpoint, milestone, and review artifacts with the expected structure', () => {
  const summary = runScenarioInChild({ launchFromFeatureBranch: true, integrate: false });
  assert.ok(summary.draft.missionId, 'MISSION.md should contain a frontmatter id');
  assert.equal(summary.active.taskIdCount, 1, 'mission id should map to exactly one backlog task in the test repo');
  assert.deepEqual(summary.active.milestoneFiles, ['milestone-1.md']);
  assert.deepEqual(summary.active.checkpointFiles, ['CP-1.md', 'CP-2.md']);
  assert.ok(summary.active.reviewEvents.some(name => name.includes('reviewer_findings')));
  assert.ok(summary.active.reviewEvents.some(name => name.includes('reviewer_outcome')));
});
