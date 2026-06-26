const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { WORKFLOW_AGENT_NAMES } = require('../lib/agents/agents');
const fmt = require('../lib/core/fmt');
const typeKey = ['class', 'ification'].join('');

const {
  checkBacklogIntegrity,
   completeTask,
   findTaskFile,
   getTaskStatus,
   resolveTaskFile,
   reportTaskResolution,
   getAcceptanceCriteria,
   setTaskStatus,
   setTaskAssignee,
   getTaskAssignee,
   getTaskImplementer,
   setTaskImplementer,
   enforceTaskAssignee,
   transitionTask,
   parseAssigneeFamilies,
   clearTaskAgentAssignee,
} = require('../lib/tools/backlog');
const { [`getTask${typeKey[0].toUpperCase()}${typeKey.slice(1)}`]: getTaskMissionType } = require('../lib/tools/backlog');

function withTempRepo(fn) {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-backlog-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workflow', 'config'), { recursive: true });

  // Provide a minimal agents.json so getSupportedAgents() has a baseline
  const agentsConfig = {
    agents: {
      codex: { families: ['codex'] },
      claude: { families: ['claude'] },
      gemini: { families: ['gemini'] },

      custom: { families: ['custom'] }
    },
    steps: {
      draft: { agents: ['codex', 'claude', 'gemini'] },
      active: { agents: ['codex', 'claude', 'gemini'] },
      review: { agents: ['codex', 'claude', 'gemini', 'custom'] }
    }
  };
  fs.writeFileSync(path.join(root, 'workflow', 'config', 'agents.json'), JSON.stringify(agentsConfig));

  process.chdir(root);

  try {
    fn(root);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function withTempGitRepo(fn) {
  withTempRepo(root => {
    childProcess.spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['config', 'user.name', 'Workflow Test'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['config', 'user.email', 'workflow-test@example.com'], { cwd: root, encoding: 'utf8' });
    fn(root);
  });
}

test('resolveTaskFile reports ambiguous task keys', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    fs.writeFileSync(path.join(taskDir, 'task-081 - first.md'), 'Status: ○ active\n');
    fs.writeFileSync(path.join(taskDir, 'task-081 - second.md'), 'Status: ○ active\n');

    const result = resolveTaskFile('task-081');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'ambiguous');
    assert.equal(result.matches.length, 2);
  });
});

test('getAcceptanceCriteria extracts rendered checklist items', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-081 - sample.md');
    fs.writeFileSync(taskPath, `Status: ○ active

## Acceptance Criteria
- [ ] #1 First criterion
- [x] #2 Second criterion

Definition of Done:
`);

    assert.deepEqual(getAcceptanceCriteria(taskPath), [
      '- [ ] #1 First criterion',
      '- [x] #2 Second criterion'
    ]);
  });
});

test('backlog mission type comes from exactly one supported label', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');

    const path1 = path.join(taskDir, 'task1.md');
    fs.writeFileSync(path1, '---\nlabels:\n  - mission\n  - user_value\n---\n');
    assert.equal(getTaskMissionType(path1), 'user_value');

    const path2 = path.join(taskDir, 'task2.md');
    fs.writeFileSync(path2, '---\nlabels: [mission, ai_sdlc]\n---\n');
    assert.equal(getTaskMissionType(path2), 'ai_sdlc');

    const path3 = path.join(taskDir, 'task3.md');
    fs.writeFileSync(path3, '---\nlabels:\n  - AI_SDLC\n---\n');
    assert.equal(getTaskMissionType(path3), 'ai_sdlc');

    const path4 = path.join(taskDir, 'task4.md');
    fs.writeFileSync(path4, `---\n${typeKey}: ai_sdlc\n---\n`);
    assert.equal(getTaskMissionType(path4), null);

    const path5 = path.join(taskDir, 'task5.md');
    fs.writeFileSync(path5, '---\nlabels: [ai_sdlc, user_value]\n---\n');
    assert.equal(getTaskMissionType(path5), null);
  });
});

test('getTaskAssignee handles empty-array, inline-array, and block-form assignees', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');

    const emptyArrayTask = path.join(taskDir, 'task-113-empty.md');
    fs.writeFileSync(emptyArrayTask, 'assignee: []\n');
    assert.equal(getTaskAssignee(emptyArrayTask), null);

    const inlineArrayTask = path.join(taskDir, 'task-113-inline.md');
    fs.writeFileSync(inlineArrayTask, 'assignee: [claude]\n');
    assert.equal(getTaskAssignee(inlineArrayTask), 'claude');

    const inlineAtTask = path.join(taskDir, 'task-113-inline-at.md');
    fs.writeFileSync(inlineAtTask, "assignee: ['@gemini']\n");
    assert.equal(getTaskAssignee(inlineAtTask), 'gemini');

    const inlineAtNoQuoteTask = path.join(taskDir, 'task-113-inline-at-no-quote.md');
    fs.writeFileSync(inlineAtNoQuoteTask, 'assignee: [@gemini]\n');
    assert.equal(getTaskAssignee(inlineAtNoQuoteTask), 'gemini');

    const blockTask = path.join(taskDir, 'task-113-block.md');
    fs.writeFileSync(blockTask, 'assignee:\n  - gemini\n');
    assert.equal(getTaskAssignee(blockTask), 'gemini');

    const blockAtTask = path.join(taskDir, 'task-113-block-at.md');
    fs.writeFileSync(blockAtTask, "assignee:\n  - '@gemini'\n");
    assert.equal(getTaskAssignee(blockAtTask), 'gemini');
  });
});

test('resolveTaskFile finds tasks in backlog/completed', () => {
  withTempRepo(root => {
    const tasksDir = path.join(root, 'backlog', 'tasks');
    const completedDir = path.join(root, 'backlog', 'completed');
    fs.mkdirSync(completedDir, { recursive: true });

    const taskPath = path.join(completedDir, 'task-098 - completed.md');
    fs.writeFileSync(taskPath, 'Status: ○ done\n');

    const result = resolveTaskFile('task-098');
    assert.equal(result.ok, true);
    assert.equal(result.taskFile, taskPath);
  });
});

test('resolveTaskFile finds tasks in backlog/archive/tasks', () => {
  withTempRepo(root => {
    const archivedDir = path.join(root, 'backlog', 'archive', 'tasks');
    fs.mkdirSync(archivedDir, { recursive: true });

    const taskPath = path.join(archivedDir, 'task-198 - archived.md');
    fs.writeFileSync(taskPath, 'id: TASK-198\nstatus: done\n');

    const result = resolveTaskFile('task-198');
    assert.equal(result.ok, true);
    assert.equal(result.taskFile, taskPath);
  });
});

test('resolveTaskFile prefers completed over archived duplicates with the same filename and id', () => {
  withTempRepo(root => {
    const completedDir = path.join(root, 'backlog', 'completed');
    const archivedDir = path.join(root, 'backlog', 'archive', 'tasks');
    fs.mkdirSync(completedDir, { recursive: true });
    fs.mkdirSync(archivedDir, { recursive: true });

    const fileName = 'task-199 - duplicate.md';
    const completedPath = path.join(completedDir, fileName);
    const archivedPath = path.join(archivedDir, fileName);
    fs.writeFileSync(completedPath, 'id: TASK-199\nstatus: done\n');
    fs.writeFileSync(archivedPath, 'id: TASK-199\nstatus: done\n');

    const result = resolveTaskFile('task-199');
    assert.equal(result.ok, true);
    assert.equal(result.taskFile, completedPath);
    assert.deepEqual(result.matches, [completedPath, archivedPath]);
  });
});

test('findTaskFile returns null when resolution is ambiguous', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    fs.writeFileSync(path.join(taskDir, 'task-091 - first.md'), 'id: TASK-091\n');
    fs.writeFileSync(path.join(taskDir, 'task-091 - second.md'), 'id: TASK-091\n');

    assert.equal(findTaskFile('task-091'), null);
  });
});

test('resolveTaskFile finds exact id match when filename prefix does not match', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    const taskPath = path.join(taskDir, 'mission-ratchet-coverage.md');
    fs.writeFileSync(taskPath, 'id: TASK-114\nstatus: active\n');

    const result = resolveTaskFile('task-114');
    assert.equal(result.ok, true);
    assert.equal(result.taskFile, taskPath);
  });
});

test('resolveTaskFile falls back to the base task id for suffixed slugs', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    const taskPath = path.join(taskDir, 'task-115 - sample.md');
    fs.writeFileSync(taskPath, 'id: TASK-115\nstatus: active\n');

    const result = resolveTaskFile('task-115-modernized');
    assert.equal(result.ok, true);
    assert.equal(result.taskFile, taskPath);
  });
});

test('resolveTaskFile reports ambiguous base-id matches for suffixed slugs', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    const completedDir = path.join(root, 'backlog', 'completed');
    fs.mkdirSync(completedDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'mission-a.md'), 'id: TASK-116\n');
    fs.writeFileSync(path.join(completedDir, 'mission-b.md'), 'id: TASK-116\n');

    const result = resolveTaskFile('task-116-follow-up');
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'ambiguous');
    assert.equal(result.matches.length, 2);
  });
});

test('reportTaskResolution logs actionable guidance for ambiguous and missing cases', () => {
  const messages = [];
  const logger = msg => messages.push(fmt.stripAnsi(msg));
  reportTaskResolution(
    { ok: false, reason: 'ambiguous', matches: ['/tmp/a.md', '/tmp/b.md'] },
    'task-117',
    logger
  );
  reportTaskResolution(
    { ok: false, reason: 'missing', matches: [] },
    'task-118',
    logger
  );

  assert.ok(messages.some(msg => msg.includes('ambiguous for slug: task-117')));
  assert.ok(messages.some(msg => msg.includes('/tmp/a.md')));
  assert.ok(messages.some(msg => msg.includes('task-118 not found')));
  assert.ok(messages.some(msg => msg.includes('Create the task file first')));
});

test('checkBacklogIntegrity reports mismatched frontmatter ids and honors slug filtering', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    const completedDir = path.join(root, 'backlog', 'completed');
    fs.mkdirSync(completedDir, { recursive: true });
    fs.writeFileSync(path.join(taskDir, 'task-119 - wrong.md'), 'id: TASK-999\n');
    fs.writeFileSync(path.join(completedDir, 'task-120 - done.md'), 'id: TASK-120\n');

    const allIssues = checkBacklogIntegrity(root);
    assert.equal(allIssues.length, 1);
    assert.equal(allIssues[0].type, 'id-mismatch');
    assert.equal(allIssues[0].filenameId, 'TASK-119');
    assert.equal(allIssues[0].frontmatterId, 'TASK-999');

    const filtered = checkBacklogIntegrity(root, 'task-120');
    assert.deepEqual(filtered, []);
  });
});

test('checkBacklogIntegrity accepts dotted subtask ids when filename and frontmatter match', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    fs.writeFileSync(
      path.join(taskDir, 'TASK-121.01 - subtask.md'),
      'id: TASK-121.01\n'
    );

    const issues = checkBacklogIntegrity(root);
    assert.deepEqual(issues, []);
  });
});

test('getTaskStatus reads YAML and rendered status formats; setTaskStatus updates both while preserving marker', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-121 - status.md');
    fs.writeFileSync(taskPath, 'status: backlog\nStatus: ○ backlog\n');

    assert.equal(getTaskStatus(taskPath), 'backlog');
    assert.equal(setTaskStatus(taskPath, 'review'), true);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /^status: review$/m);
    assert.match(content, /^Status: ○ review$/m);
    assert.equal(getTaskStatus(taskPath), 'review');
  });
});

test('completeTask moves active tasks into backlog/completed and marks them done', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-122 - move-me.md');
    fs.writeFileSync(taskPath, 'id: TASK-122\nstatus: active\nStatus: ○ active\n');

    assert.equal(completeTask('task-122', root), true);

    const completedPath = path.join(root, 'backlog', 'completed', 'task-122 - move-me.md');
    assert.equal(fs.existsSync(taskPath), false);
    assert.equal(fs.existsSync(completedPath), true);
    assert.equal(getTaskStatus(completedPath), 'done');
  });
});

test('completeTask marks already-completed tasks done in place', () => {
  withTempRepo(root => {
    const completedDir = path.join(root, 'backlog', 'completed');
    fs.mkdirSync(completedDir, { recursive: true });
    const taskPath = path.join(completedDir, 'task-123 - already-done.md');
    fs.writeFileSync(taskPath, 'id: TASK-123\nstatus: review\nStatus: ○ review\n');

    assert.equal(completeTask('task-123', root), true);
    assert.equal(getTaskStatus(taskPath), 'done');
  });
});

test('setTaskAssignee updates empty assignee list', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: []\n---\n');

    const result = setTaskAssignee(taskPath, 'claude');
    assert.equal(result, true);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[claude\]/);
  });
});

test('setTaskAssignee inserts a new assignee after the id field when missing', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-124 - no-assignee.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-124\nstatus: active\n---\n');

    const result = setTaskAssignee(taskPath, 'codex');
    assert.equal(result, true);
    assert.match(fs.readFileSync(taskPath, 'utf8'), /id: TASK-124\nassignee: \[codex\]\nstatus: active/);
  });
});

test('setTaskAssignee returns false when there is no assignee field and no id anchor', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-125 - malformed.md');
    fs.writeFileSync(taskPath, 'status: active\n');

    assert.equal(setTaskAssignee(taskPath, 'codex'), false);
  });
});

test('setTaskAssignee promotes to the front of existing assignee list', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: [gemini]\n---\n');

    const result = setTaskAssignee(taskPath, 'claude');
    assert.equal(result, true);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[claude, gemini\]/);
  });
});

test('getTaskImplementer returns first recognized agent family', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: [magnus, claude, gemini]\n---\n');

    const implementer = getTaskImplementer(taskPath);
    assert.equal(implementer, 'claude');
  });
});

test('setTaskAssignee promotes existing assignee to first position', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: [gemini, claude]\n---\n');

    const result = setTaskAssignee(taskPath, 'claude');
    assert.equal(result, true);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[claude, gemini\]/);
  });
});

test('setTaskAssignee returns false if assignee is already first', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: [claude, gemini]\n---\n');

    const result = setTaskAssignee(taskPath, 'claude');
    assert.equal(result, false);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[claude, gemini\]/);
  });
});

test('setTaskAssignee updates simple inline form and promotes to first', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: gemini\n---\n');

    const result = setTaskAssignee(taskPath, 'claude');
    assert.equal(result, true);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[claude, gemini\]/);
  });
});

test('getTaskImplementer handles simple inline form without brackets', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: custom\n---\n');

    const implementer = getTaskImplementer(taskPath);
    assert.equal(implementer, 'custom');
  });
});

test('getTaskImplementer handles YAML block format', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee:\n  - magnus\n  - custom\n---\n');

    const implementer = getTaskImplementer(taskPath);
    assert.equal(implementer, 'custom');
  });
});

test('getTaskImplementer handles quoted and @-prefixed values', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');

    const inlineQuotedTask = path.join(taskDir, 'task-112-quoted.md');
    fs.writeFileSync(inlineQuotedTask, "assignee: ['@claude']\n");
    assert.equal(getTaskImplementer(inlineQuotedTask), 'claude');

    const blockQuotedTask = path.join(taskDir, 'task-112-block-quoted.md');
    fs.writeFileSync(blockQuotedTask, "assignee:\n  - '@custom'\n");
    assert.equal(getTaskImplementer(blockQuotedTask), 'custom');
  });
});

test('getTaskImplementer recognizes every workflow launcher and skips human assignees', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');

    for (const agent of WORKFLOW_AGENT_NAMES) {
      const taskPath = path.join(taskDir, `task-129-${agent}.md`);
      fs.writeFileSync(taskPath, `---\nid: TASK-129\nassignee: [magnus, ${agent}]\n---\n`);
      assert.equal(getTaskImplementer(taskPath), agent);
    }
  });
});

test('setTaskImplementer replaces prior workflow agents and promotes to the front', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: [magnus, custom]\n---\n');

    const result = setTaskImplementer(taskPath, 'codex');
    assert.equal(result, true);

    const content = fs.readFileSync(taskPath, 'utf8');
    // It should be [codex, magnus] now because we want it to be authoritative for getTaskImplementer()
    assert.match(content, /assignee: \[codex, magnus\]/);
    assert.equal(getTaskImplementer(taskPath), 'codex');
  });
});

test('setTaskImplementer promotes an existing fallback agent to the front', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: [claude, codex]\n---\n');

    const result = setTaskImplementer(taskPath, 'codex');
    assert.equal(result, true);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[codex\]/);
    assert.equal(getTaskImplementer(taskPath), 'codex');
  });
});

test('setTaskImplementer returns false when the implementer is already current and first', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: [codex, magnus]\n---\n');

    const result = setTaskImplementer(taskPath, 'codex');
    assert.equal(result, false);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[codex, magnus\]/);
  });
});

test('setTaskImplementer inserts implementer when no assignee field exists but id does', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-126 - missing-assignee.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-126\nstatus: active\n---\n');

    const result = setTaskImplementer(taskPath, 'claude');
    assert.equal(result, true);
    assert.match(fs.readFileSync(taskPath, 'utf8'), /id: TASK-126\nassignee: \[claude\]\nstatus: active/);
  });
});

test('setTaskAssignee appends to the end when promote is false', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: [gemini]\n---\n');

    const result = setTaskAssignee(taskPath, 'claude', { promote: false });
    assert.equal(result, true);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[gemini, claude\]/);
  });
});

test('setTaskAssignee returns false when promote is false and already in list', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: [gemini, claude]\n---\n');

    const result = setTaskAssignee(taskPath, 'claude', { promote: false });
    assert.equal(result, false);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[gemini, claude\]/);
  });
});

test('enforceTaskAssignee sets implementer when assignee is empty', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: []\n---\n');

    const result = enforceTaskAssignee(taskPath, 'claude');
    assert.equal(result, true);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[claude\]/);
  });
});

test('enforceTaskAssignee replaces a different agent with the implementer', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: [gemini]\n---\n');

    const result = enforceTaskAssignee(taskPath, 'claude');
    assert.equal(result, true);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[claude\]/);
    assert.doesNotMatch(content, /gemini/);
  });
});

test('enforceTaskAssignee collapses multiple assignees to just the implementer', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: [claude, gemini]\n---\n');

    const result = enforceTaskAssignee(taskPath, 'claude');
    assert.equal(result, true);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[claude\]/);
    assert.doesNotMatch(content, /gemini/);
  });
});

test('enforceTaskAssignee returns true without writing when assignee is already exactly correct', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee: [claude]\n---\n');
    const before = fs.statSync(taskPath).mtimeMs;

    const result = enforceTaskAssignee(taskPath, 'claude');
    assert.equal(result, true);

    const after = fs.statSync(taskPath).mtimeMs;
    assert.equal(before, after, 'file must not be rewritten when assignee is already correct');
  });
});

test('enforceTaskAssignee returns false when task file does not exist', () => {
  const result = enforceTaskAssignee('/nonexistent/path/task.md', 'claude');
  assert.equal(result, false);
});

test('enforceTaskAssignee replaces block-form assignee with single implementer', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-112 - test.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-112\nassignee:\n  - gemini\n  - claude\n---\n');

    const result = enforceTaskAssignee(taskPath, 'codex');
    assert.equal(result, true);

    const content = fs.readFileSync(taskPath, 'utf8');
    assert.match(content, /assignee: \[codex\]/);
    assert.doesNotMatch(content, /gemini/);
    assert.doesNotMatch(content, /claude/);
  });
});

test('enforceTaskAssignee inserts assignee after id when no assignee field exists', () => {
  withTempRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-127 - add-assignee.md');
    fs.writeFileSync(taskPath, '---\nid: TASK-127\nstatus: active\n---\n');

    assert.equal(enforceTaskAssignee(taskPath, 'gemini'), true);
    assert.match(fs.readFileSync(taskPath, 'utf8'), /id: TASK-127\nassignee: \[gemini\]\nstatus: active/);
  });
});

test('parseAssigneeFamilies reports unmatched content with no assignees', () => {
  assert.deepEqual(parseAssigneeFamilies('status: active\n'), { matched: false, families: [] });
});

test('transitionTask updates status and implementer and commits the change in a git repo', () => {
  withTempGitRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-128 - transition.md');
    fs.writeFileSync(taskPath, 'id: TASK-128\nstatus: backlog\nassignee: [gemini]\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const logs = [];
    const ok = transitionTask('task-128', 'active', { implementer: 'codex', rootDir: root, log: msg => logs.push(msg) });
    assert.equal(ok, true);
    assert.equal(getTaskStatus(taskPath), 'active');
    assert.equal(getTaskImplementer(taskPath), 'codex');

    const lastSubject = childProcess.spawnSync('git', ['log', '-1', '--format=%s'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    assert.equal(lastSubject, 'backlog(task-128): transition to active and implementer=codex');
    assert.ok(logs.some(msg => msg.includes('transitioned to active')));
  });
});

test('transitionTask commits a Backlog task update when invoked from a sibling mission worktree', () => {
  withTempGitRepo(root => {
    // 1. Setup base repo with a task
    const taskDir = path.join(root, 'backlog', 'tasks');
    fs.mkdirSync(taskDir, { recursive: true });
    const taskPath = path.join(taskDir, 'task-2104-sibling.md');
    fs.writeFileSync(taskPath, 'id: TASK-2104\nstatus: backlog\nassignee: [gemini]\n');
    
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });
    
    // 2. Create a sibling worktree
    const worktreePath = path.join(os.tmpdir(), `workflow-worktree-${Date.now()}`);
    childProcess.spawnSync('git', ['worktree', 'add', '-b', 'mission/task-2104-sibling', worktreePath, 'HEAD'], { cwd: root, encoding: 'utf8' });
    
    try {
      // The task file path inside the worktree
      const worktreeTaskPath = path.join(worktreePath, 'backlog', 'tasks', 'task-2104-sibling.md');
      
      const logs = [];
      // Transition the task using the worktree as rootDir (exact slug, no suffix)
      const ok = transitionTask('task-2104', 'active', { 
        implementer: 'codex', 
        rootDir: worktreePath, 
        log: msg => logs.push(msg) 
      });
      
      assert.equal(ok, true, 'transitionTask should return true');
      
      // Verify the task status in the worktree
      const content = fs.readFileSync(worktreeTaskPath, 'utf8');
      assert.match(content, /^status: active$/m);
      
      // Verify the commit in the worktree repo
      const lastSubject = childProcess.spawnSync('git', ['log', '-1', '--format=%s'], { cwd: worktreePath, encoding: 'utf8' }).stdout.trim();
      assert.equal(lastSubject, 'backlog(task-2104): transition to active and implementer=codex');
      
    } finally {
      // Cleanup worktree
      childProcess.spawnSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: root, encoding: 'utf8' });
      childProcess.spawnSync('git', ['branch', '-D', 'mission/task-2104-sibling'], { cwd: root, encoding: 'utf8' });
      fs.rmSync(worktreePath, { recursive: true, force: true });
    }
  });
});

test('transitionTask with clearAssignee resets assignee to empty and commits', () => {
  withTempGitRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-129 - clear-assignee.md');
    fs.writeFileSync(taskPath, 'id: TASK-129\nstatus: active\nassignee: [claude]\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const ok = transitionTask('task-129', 'refined', { clearAssignee: true, rootDir: root, log: () => {} });
    assert.equal(ok, true);
    assert.equal(getTaskStatus(taskPath), 'refined');
    const content = fs.readFileSync(taskPath, 'utf8');
    assert.ok(content.includes('assignee: []'), 'assignee must be cleared to empty array');

    const lastSubject = childProcess.spawnSync('git', ['log', '-1', '--format=%s'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    assert.equal(lastSubject, 'backlog(task-129): transition to refined');
  });
});

test('transitionTask with clearAssignee handles block-form assignee', () => {
  withTempGitRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-130 - clear-block.md');
    fs.writeFileSync(taskPath, 'id: TASK-130\nstatus: active\nassignee:\n  - claude\n  - codex\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const ok = transitionTask('task-130', 'refined', { clearAssignee: true, rootDir: root, log: () => {} });
    assert.equal(ok, true);
    const content = fs.readFileSync(taskPath, 'utf8');
    assert.ok(content.includes('assignee: []'), 'block-form assignee must be cleared to empty array');
  });
});

test('transitionTask with clearAssignee when no assignee field returns true without writing', () => {
  withTempGitRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-131 - no-assignee.md');
    fs.writeFileSync(taskPath, 'id: TASK-131\nstatus: refined\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const ok = transitionTask('task-131', 'refined', { clearAssignee: true, rootDir: root, log: () => {} });
    assert.equal(ok, true);
    const content = fs.readFileSync(taskPath, 'utf8');
    assert.ok(!content.includes('assignee'), 'assignee field must not be added when it did not exist');
  });
});

test('clearTaskAgentAssignee preserves human assignees when only agent families are cleared', () => {
  withTempGitRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-132 - human-assignees.md');
    fs.writeFileSync(taskPath, 'id: TASK-132\nstatus: active\nassignee: [claude, magnus, reviewer]\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const ok = clearTaskAgentAssignee(taskPath);
    assert.equal(ok, true);
    const content = fs.readFileSync(taskPath, 'utf8');
    assert.ok(content.includes('assignee: [magnus, reviewer]'), 'human assignees must be preserved');
    assert.ok(!content.includes('claude'), 'agent assignee claude must be cleared');
  });
});

test('clearTaskAgentAssignee clears block-form agent assignees while preserving human block assignees', () => {
  withTempGitRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-133 - human-block.md');
    fs.writeFileSync(taskPath, 'id: TASK-133\nstatus: active\nassignee:\n  - claude\n  - magnus\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const ok = clearTaskAgentAssignee(taskPath);
    assert.equal(ok, true);
    const content = fs.readFileSync(taskPath, 'utf8');
    assert.ok(content.includes('- magnus'), 'human assignee magnus must be preserved in block form');
    assert.ok(!content.includes('- claude'), 'agent assignee claude must be cleared from block form');
  });
});

test('clearTaskAgentAssignee does not mutate task when no agent families are present', () => {
  withTempGitRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-134 - humans-only.md');
    fs.writeFileSync(taskPath, 'id: TASK-134\nstatus: active\nassignee: [magnus, reviewer]\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const before = fs.readFileSync(taskPath, 'utf8');
    const ok = clearTaskAgentAssignee(taskPath);
    assert.equal(ok, false);
    const after = fs.readFileSync(taskPath, 'utf8');
    assert.equal(before, after, 'file must not change when no agent families are present');
  });
});

test('transitionTask rejects suffixed slug regardless of frontmatter id match', () => {
  withTempGitRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    const taskPath1 = path.join(taskDir, 'task-1048 - target.md');
    fs.writeFileSync(taskPath1, 'id: TASK-1048\nstatus: backlog\nassignee: [gemini]\n');

    // Trap file: suffixed prefix resolves by slug match; frontmatter id differs (but guard rejects regardless)
    const taskPath2 = path.join(taskDir, 'task-1048-regress.md');
    fs.writeFileSync(taskPath2, 'id: TASK-1049\nstatus: backlog\nassignee: [claude]\n');

    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed tasks'], { cwd: root, encoding: 'utf8' });

    const logs = [];
    const ok = transitionTask('task-1048-regress', 'active', { rootDir: root, log: msg => logs.push(msg) });
    assert.equal(ok, false, 'transitionTask must return false for suffixed slug with id mismatch');

    const lastSubject = childProcess.spawnSync('git', ['log', '-1', '--format=%s'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    assert.notEqual(lastSubject, 'backlog(task-1048-regress): transition to active', 'no stray commit should be created');

    const content = fs.readFileSync(taskPath2, 'utf8');
    assert.ok(!content.includes('status: active'), 'task file status must not be modified');

    assert.ok(logs.some(msg => msg.toLowerCase().includes('rejected')), 'a warning must be logged');
  });
});

test('transitionTask permits exact slug match (no suffix)', () => {
  withTempGitRepo(root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-1048 - exact.md');
    fs.writeFileSync(taskPath, 'id: TASK-1048\nstatus: backlog\nassignee: [gemini]\n');

    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const logs = [];
    const ok = transitionTask('task-1048', 'active', { rootDir: root, log: msg => logs.push(msg) });
    assert.equal(ok, true, 'exact slug match must be permitted');

    const lastSubject = childProcess.spawnSync('git', ['log', '-1', '--format=%s'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    assert.equal(lastSubject, 'backlog(task-1048): transition to active', 'commit must use the exact slug');
  });
});
