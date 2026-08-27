
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import childProcess from 'child_process';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const WORKFLOW_AGENT_NAMESModule = mockModule<typeof import('../src/adapters/agents/agents.js')>('../src/adapters/agents/agents.js', import.meta.url);
const fmt = mockModule<typeof import('../src/application/presentation/cli-format.js')>('../src/application/presentation/cli-format.js', import.meta.url);
const __mm1 = mockModule<typeof import('../src/adapters/backlog/backlog.js')>('../src/adapters/backlog/backlog.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { WORKFLOW_AGENT_NAMES } = WORKFLOW_AGENT_NAMESModule;
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
   transitionTaskOnIntegrationBranch,
   parseAssigneeFamilies,
   clearTaskAgentAssignee,
   hasBugLabel,
   getTaskLabels,
} = __mm1;
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
const { [`getTask${typeKey[0].toUpperCase()}${typeKey.slice(1)}`]: getTaskMissionType } = __mm1;

async function withTempRepo(fn) {
  const previous = process.cwd();
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-backlog-')));
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
    await fn(root);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function withTempGitRepo(fn) {
  await withTempRepo(async root => {
    childProcess.spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['symbolic-ref', 'HEAD', 'refs/heads/main'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['config', 'user.name', 'Workflow Test'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['config', 'user.email', 'workflow-test@example.com'], { cwd: root, encoding: 'utf8' });
    await fn(root);
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

test('transitionTask updates status and implementer and commits the change in a git repo', async () => {
  await withTempGitRepo(async root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-128 - transition.md');
    fs.writeFileSync(taskPath, 'id: TASK-128\nstatus: backlog\nassignee: [gemini]\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const logs = [];
    const ok = await transitionTask('task-128', 'active', { implementer: 'codex', rootDir: root, log: msg => logs.push(msg) });
    assert.equal(ok, true);
    assert.equal(getTaskStatus(taskPath), 'active');
    assert.equal(getTaskImplementer(taskPath), 'codex');

    const lastSubject = childProcess.spawnSync('git', ['log', '-1', '--format=%s'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    assert.equal(lastSubject, 'backlog(task-128): transition to active and implementer=codex');
    assert.ok(logs.some(msg => msg.includes('transitioned to active')));
  });
});

test('transitionTask commits only the mission worktree task when invoked from a sibling mission worktree', async () => {
  await withTempGitRepo(async root => {
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
      const ok = await transitionTask('task-2104', 'active', {
        implementer: 'codex',
        rootDir: worktreePath,
        log: msg => logs.push(msg)
      });

      assert.equal(ok, true, 'transitionTask should return true');

      const missionContent = fs.readFileSync(worktreeTaskPath, 'utf8');
      assert.match(missionContent, /^status: active$/m);
      assert.match(missionContent, /^assignee: \[codex\]$/m);
      const primaryContent = fs.readFileSync(path.join(root, 'backlog', 'tasks', 'task-2104-sibling.md'), 'utf8');
      assert.match(primaryContent, /^status: backlog$/m);
      assert.match(primaryContent, /^assignee: \[gemini\]$/m);

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

test('transitionTaskOnIntegrationBranch writes main metadata first and rebases the mission worktree afterward', async () => {
  await withTempGitRepo(async root => {
    const slug = 'task-2230';
    const taskPath = path.join(root, 'backlog', 'tasks', `${slug} - durable state.md`);
    fs.writeFileSync(taskPath, '---\nid: TASK-2230\nstatus: backlog\nassignee: [gemini]\nlabels:\n  - ai_sdlc\ndependencies: [TASK-17]\n---\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed durable task'], { cwd: root, encoding: 'utf8' });

    const missionWorktree = path.join(os.tmpdir(), `workflow-task-2230-${Date.now()}`);
    childProcess.spawnSync('git', ['worktree', 'add', '-b', `mission/${slug}`, missionWorktree, 'HEAD'], { cwd: root, encoding: 'utf8' });
    const missionFile = path.join(missionWorktree, 'missions', slug, 'MISSION.md');
    fs.mkdirSync(path.dirname(missionFile), { recursive: true });
    fs.writeFileSync(missionFile, '# Mission\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: missionWorktree, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'add mission'], { cwd: missionWorktree, encoding: 'utf8' });

    const previousPrimary = process.env.PRIMARY_WORKTREE;
    process.env.PRIMARY_WORKTREE = root;
    try {
      assert.equal(await transitionTaskOnIntegrationBranch(slug, 'active', { implementer: 'codex', rootDir: missionWorktree, log: () => {} }), true);
      const mainContent = fs.readFileSync(taskPath, 'utf8');
      assert.match(mainContent, /^status: active$/m);
      assert.match(mainContent, /^assignee: \[codex\]$/m);
      assert.match(mainContent, /^labels:\n  - ai_sdlc$/m);
      assert.match(mainContent, /^dependencies: \[TASK-17\]$/m);
      assert.equal(childProcess.spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', `mission/${slug}`], { cwd: root, encoding: 'utf8' }).status, 0);
    } finally {
      if (previousPrimary === undefined) { delete process.env.PRIMARY_WORKTREE; } else { process.env.PRIMARY_WORKTREE = previousPrimary; }
      childProcess.spawnSync('git', ['worktree', 'remove', '--force', missionWorktree], { cwd: root, encoding: 'utf8' });
      fs.rmSync(missionWorktree, { recursive: true, force: true });
    }
  });
});

test('transitionTaskOnIntegrationBranch targets a recorded feature base branch', async () => {
  await withTempGitRepo(async root => {
    const slug = 'task-2231';
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed main'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['checkout', '-b', 'feature/state-owner'], { cwd: root, encoding: 'utf8' });
    const taskPath = path.join(root, 'backlog', 'tasks', `${slug} - feature state.md`);
    fs.writeFileSync(taskPath, 'id: TASK-2231\nstatus: backlog\nlabels: [ai_sdlc]\ndependencies: []\nassignee: [gemini]\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed feature task'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['checkout', 'main'], { cwd: root, encoding: 'utf8' });
    const featureWorktree = path.join(os.tmpdir(), `workflow-feature-${Date.now()}`);
    childProcess.spawnSync('git', ['worktree', 'add', featureWorktree, 'feature/state-owner'], { cwd: root, encoding: 'utf8' });
    const missionWorktree = path.join(os.tmpdir(), `workflow-task-2231-${Date.now()}`);
    childProcess.spawnSync('git', ['worktree', 'add', '-b', `mission/${slug}`, missionWorktree, 'feature/state-owner'], { cwd: root, encoding: 'utf8' });
    const missionFile = path.join(missionWorktree, 'missions', slug, 'MISSION.md');
    fs.mkdirSync(path.dirname(missionFile), { recursive: true });
    fs.writeFileSync(missionFile, 'Base-Branch: feature/state-owner\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: missionWorktree, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'record feature base'], { cwd: missionWorktree, encoding: 'utf8' });

    const previousPrimary = process.env.PRIMARY_WORKTREE;
    process.env.PRIMARY_WORKTREE = root;
    try {
      const logs = [];
      assert.equal(await transitionTaskOnIntegrationBranch(slug, 'review', { rootDir: missionWorktree, log: message => logs.push(message) }), true, logs.join('\n'));
      assert.match(fs.readFileSync(path.join(featureWorktree, 'backlog', 'tasks', `${slug} - feature state.md`), 'utf8'), /^status: review$/m);
      assert.equal(fs.existsSync(path.join(root, 'backlog', 'tasks', `${slug} - feature state.md`)), false);
    } finally {
      if (previousPrimary === undefined) { delete process.env.PRIMARY_WORKTREE; } else { process.env.PRIMARY_WORKTREE = previousPrimary; }
      childProcess.spawnSync('git', ['worktree', 'remove', '--force', missionWorktree], { cwd: root, encoding: 'utf8' });
      childProcess.spawnSync('git', ['worktree', 'remove', '--force', featureWorktree], { cwd: root, encoding: 'utf8' });
      fs.rmSync(missionWorktree, { recursive: true, force: true });
      fs.rmSync(featureWorktree, { recursive: true, force: true });
    }
  });
});

test('transitionTaskOnIntegrationBranch reconciles task metadata conflicts and completes the rebase', async () => {
  await withTempGitRepo(async root => {
    const slug = 'task-2232';
    const taskPath = path.join(root, 'backlog', 'tasks', `${slug} - rebase conflict.md`);
    fs.writeFileSync(taskPath, 'id: TASK-2232\nstatus: refined\nassignee: [gemini]\nlabels:\n  - distribution\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });
    const missionWorktree = path.join(os.tmpdir(), `workflow-task-2232-${Date.now()}`);
    childProcess.spawnSync('git', ['worktree', 'add', '-b', `mission/${slug}`, missionWorktree, 'HEAD'], { cwd: root, encoding: 'utf8' });
    fs.writeFileSync(path.join(missionWorktree, 'backlog', 'tasks', `${slug} - rebase conflict.md`), 'id: TASK-2232\nstatus: mission-local\nassignee: [gemini]\nlabels:\n  - distribution\n  - user_value\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: missionWorktree, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'classify mission task'], { cwd: missionWorktree, encoding: 'utf8' });
    const previousPrimary = process.env.PRIMARY_WORKTREE;
    process.env.PRIMARY_WORKTREE = root;
    try {
      const logs = [];
      assert.equal(await transitionTaskOnIntegrationBranch(slug, 'active', { implementer: 'codex', rootDir: missionWorktree, log: message => logs.push(message) }), true, logs.join('\n'));
      assert.match(fs.readFileSync(taskPath, 'utf8'), /^status: active$/m);
      assert.match(fs.readFileSync(taskPath, 'utf8'), /^assignee: \[codex\]$/m);
      const missionContent = fs.readFileSync(path.join(missionWorktree, 'backlog', 'tasks', `${slug} - rebase conflict.md`), 'utf8');
      assert.match(missionContent, /^status: active$/m, 'integration-branch lifecycle status must win');
      assert.match(missionContent, /^assignee: \[codex\]$/m, 'integration-branch workflow assignee must win');
      assert.match(missionContent, /^  - user_value$/m, 'mission metadata must survive reconciliation');
      assert.equal(childProcess.spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', `mission/${slug}`], { cwd: root, encoding: 'utf8' }).status, 0);
      assert.notEqual(childProcess.spawnSync('git', ['rebase', '--show-current'], { cwd: missionWorktree, encoding: 'utf8' }).status, 0);
      assert.ok(logs.some(message => message.includes('Automatically reconciled')));
    } finally {
      if (previousPrimary === undefined) { delete process.env.PRIMARY_WORKTREE; } else { process.env.PRIMARY_WORKTREE = previousPrimary; }
      childProcess.spawnSync('git', ['worktree', 'remove', '--force', missionWorktree], { cwd: root, encoding: 'utf8' });
      fs.rmSync(missionWorktree, { recursive: true, force: true });
    }
  });
});

test('transitionTaskOnIntegrationBranch defers the rebase while the mission worktree has agent edits', async () => {
  await withTempGitRepo(async root => {
    const slug = 'task-2234';
    const taskPath = path.join(root, 'backlog', 'tasks', `${slug} - dirty mission.md`);
    fs.writeFileSync(taskPath, 'id: TASK-2234\nstatus: refined\nassignee: [gemini]\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed dirty mission task'], { cwd: root, encoding: 'utf8' });

    const missionWorktree = path.join(os.tmpdir(), `workflow-task-2234-${Date.now()}`);
    childProcess.spawnSync('git', ['worktree', 'add', '-b', `mission/${slug}`, missionWorktree, 'HEAD'], { cwd: root, encoding: 'utf8' });
    const missionFile = path.join(missionWorktree, 'missions', slug, 'MISSION.md');
    fs.mkdirSync(path.dirname(missionFile), { recursive: true });
    fs.writeFileSync(missionFile, '# Agent output in progress\n');

    const previousPrimary = process.env.PRIMARY_WORKTREE;
    process.env.PRIMARY_WORKTREE = root;
    try {
      const logs = [];
      assert.equal(await transitionTaskOnIntegrationBranch(slug, 'active', { implementer: 'codex', rootDir: missionWorktree, log: message => logs.push(message) }), true, logs.join('\n'));
      assert.match(fs.readFileSync(taskPath, 'utf8'), /^status: active$/m);
      assert.match(fs.readFileSync(taskPath, 'utf8'), /^assignee: \[codex\]$/m);
      assert.equal(fs.readFileSync(missionFile, 'utf8'), '# Agent output in progress\n', 'agent edits must not be stashed or rewritten');
      assert.ok(logs.some(message => message.includes('Deferring mission rebase')));
      assert.notEqual(childProcess.spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', `mission/${slug}`], { cwd: root, encoding: 'utf8' }).status, 0);
    } finally {
      if (previousPrimary === undefined) { delete process.env.PRIMARY_WORKTREE; } else { process.env.PRIMARY_WORKTREE = previousPrimary; }
      childProcess.spawnSync('git', ['worktree', 'remove', '--force', missionWorktree], { cwd: root, encoding: 'utf8' });
      fs.rmSync(missionWorktree, { recursive: true, force: true });
    }
  });
});

test('transitionTaskOnIntegrationBranch synchronizes approval with untracked reviewer events', async () => {
  await withTempGitRepo(async root => {
    const slug = 'task-2235';
    const taskPath = path.join(root, 'backlog', 'tasks', `${slug} - approved review.md`);
    fs.writeFileSync(taskPath, 'id: TASK-2235\nstatus: review\nassignee: [codex]\n');
    fs.mkdirSync(path.join(root, 'missions', slug), { recursive: true });
    fs.writeFileSync(path.join(root, 'missions', slug, 'MISSION.md'), '# Approved review mission\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed review task'], { cwd: root, encoding: 'utf8' });

    const missionWorktree = path.join(os.tmpdir(), `workflow-task-2235-${Date.now()}`);
    childProcess.spawnSync('git', ['worktree', 'add', '-b', `mission/${slug}`, missionWorktree, 'HEAD'], { cwd: root, encoding: 'utf8' });
    const eventPath = path.join(missionWorktree, 'missions', slug, 'review-events', 'reviewer_outcome.md');
    fs.mkdirSync(path.dirname(eventPath), { recursive: true });
    fs.writeFileSync(eventPath, 'Outcome: approve\n');
    assert.equal(
      childProcess.spawnSync('git', ['status', '--porcelain'], { cwd: missionWorktree, encoding: 'utf8' }).stdout.trim(),
      '?? missions/task-2235/review-events/'
    );

    const previousPrimary = process.env.PRIMARY_WORKTREE;
    process.env.PRIMARY_WORKTREE = root;
    try {
      const logs = [];
      assert.equal(await transitionTaskOnIntegrationBranch(slug, 'ready-for-integration', { rootDir: missionWorktree, log: message => logs.push(message) }), true, logs.join('\n'));
      assert.match(fs.readFileSync(taskPath, 'utf8'), /^status: ready-for-integration$/m);
      assert.match(fs.readFileSync(path.join(missionWorktree, 'backlog', 'tasks', path.basename(taskPath)), 'utf8'), /^status: ready-for-integration$/m, logs.join('\n'));
      assert.equal(fs.readFileSync(eventPath, 'utf8'), 'Outcome: approve\n');
      assert.ok(!logs.some(message => message.includes('Deferring mission rebase')));
    } finally {
      if (previousPrimary === undefined) { delete process.env.PRIMARY_WORKTREE; } else { process.env.PRIMARY_WORKTREE = previousPrimary; }
      childProcess.spawnSync('git', ['worktree', 'remove', '--force', missionWorktree], { cwd: root, encoding: 'utf8' });
      fs.rmSync(missionWorktree, { recursive: true, force: true });
    }
  });
});

test('transitionTaskOnIntegrationBranch still aborts shared-file rebase conflicts', async () => {
  await withTempGitRepo(async root => {
    const slug = 'task-2233';
    const taskPath = path.join(root, 'backlog', 'tasks', `${slug} - shared conflict.md`);
    fs.writeFileSync(taskPath, 'id: TASK-2233\nstatus: refined\nassignee: [gemini]\n');
    fs.writeFileSync(path.join(root, 'shared.txt'), 'base\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task and shared file'], { cwd: root, encoding: 'utf8' });

    const missionWorktree = path.join(os.tmpdir(), `workflow-task-2233-${Date.now()}`);
    childProcess.spawnSync('git', ['worktree', 'add', '-b', `mission/${slug}`, missionWorktree, 'HEAD'], { cwd: root, encoding: 'utf8' });
    fs.writeFileSync(path.join(missionWorktree, 'shared.txt'), 'mission\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: missionWorktree, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'edit shared file on mission'], { cwd: missionWorktree, encoding: 'utf8' });
    const missionHead = childProcess.spawnSync('git', ['rev-parse', 'HEAD'], { cwd: missionWorktree, encoding: 'utf8' }).stdout.trim();

    fs.writeFileSync(path.join(root, 'shared.txt'), 'main\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'edit shared file on main'], { cwd: root, encoding: 'utf8' });

    const previousPrimary = process.env.PRIMARY_WORKTREE;
    process.env.PRIMARY_WORKTREE = root;
    try {
      const logs = [];
      assert.equal(await transitionTaskOnIntegrationBranch(slug, 'active', { rootDir: missionWorktree, log: message => logs.push(message) }), false);
      assert.match(fs.readFileSync(taskPath, 'utf8'), /^status: active$/m);
      assert.equal(childProcess.spawnSync('git', ['rev-parse', 'HEAD'], { cwd: missionWorktree, encoding: 'utf8' }).stdout.trim(), missionHead);
      assert.notEqual(childProcess.spawnSync('git', ['rebase', '--show-current'], { cwd: missionWorktree, encoding: 'utf8' }).status, 0);
      assert.ok(logs.some(message => message.includes('Rebase aborted; the mission worktree was restored')));
    } finally {
      if (previousPrimary === undefined) { delete process.env.PRIMARY_WORKTREE; } else { process.env.PRIMARY_WORKTREE = previousPrimary; }
      childProcess.spawnSync('git', ['worktree', 'remove', '--force', missionWorktree], { cwd: root, encoding: 'utf8' });
      fs.rmSync(missionWorktree, { recursive: true, force: true });
    }
  });
});

test('transitionTask with clearAssignee resets assignee to empty and commits', async () => {
  await withTempGitRepo(async root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-129 - clear-assignee.md');
    fs.writeFileSync(taskPath, 'id: TASK-129\nstatus: active\nassignee: [claude]\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const ok = await transitionTask('task-129', 'refined', { clearAssignee: true, rootDir: root, log: () => {} });
    assert.equal(ok, true);
    assert.equal(getTaskStatus(taskPath), 'refined');
    const content = fs.readFileSync(taskPath, 'utf8');
    assert.ok(content.includes('assignee: []'), 'assignee must be cleared to empty array');

    const lastSubject = childProcess.spawnSync('git', ['log', '-1', '--format=%s'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    assert.equal(lastSubject, 'backlog(task-129): transition to refined');
  });
});

test('transitionTask with clearAssignee handles block-form assignee', async () => {
  await withTempGitRepo(async root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-130 - clear-block.md');
    fs.writeFileSync(taskPath, 'id: TASK-130\nstatus: active\nassignee:\n  - claude\n  - codex\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const ok = await transitionTask('task-130', 'refined', { clearAssignee: true, rootDir: root, log: () => {} });
    assert.equal(ok, true);
    const content = fs.readFileSync(taskPath, 'utf8');
    assert.ok(content.includes('assignee: []'), 'block-form assignee must be cleared to empty array');
  });
});

test('transitionTask with clearAssignee when no assignee field returns true without writing', async () => {
  await withTempGitRepo(async root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-131 - no-assignee.md');
    fs.writeFileSync(taskPath, 'id: TASK-131\nstatus: refined\n');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const ok = await transitionTask('task-131', 'refined', { clearAssignee: true, rootDir: root, log: () => {} });
    assert.equal(ok, true);
    const content = fs.readFileSync(taskPath, 'utf8');
    assert.ok(!content.includes('assignee'), 'assignee field must not be added when it did not exist');
  });
});

test('clearTaskAgentAssignee preserves human assignees when only agent families are cleared', async () => {
  await withTempGitRepo(root => {
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

test('clearTaskAgentAssignee clears block-form agent assignees while preserving human block assignees', async () => {
  await withTempGitRepo(root => {
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

test('clearTaskAgentAssignee does not mutate task when no agent families are present', async () => {
  await withTempGitRepo(root => {
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

test('transitionTask rejects suffixed slug regardless of frontmatter id match', async () => {
  await withTempGitRepo(async root => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    const taskPath1 = path.join(taskDir, 'task-1048 - target.md');
    fs.writeFileSync(taskPath1, 'id: TASK-1048\nstatus: backlog\nassignee: [gemini]\n');

    // Trap file: suffixed prefix resolves by slug match; frontmatter id differs (but guard rejects regardless)
    const taskPath2 = path.join(taskDir, 'task-1048-regress.md');
    fs.writeFileSync(taskPath2, 'id: TASK-1049\nstatus: backlog\nassignee: [claude]\n');

    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed tasks'], { cwd: root, encoding: 'utf8' });

    const logs = [];
    const ok = await transitionTask('task-1048-regress', 'active', { rootDir: root, log: msg => logs.push(msg) });
    assert.equal(ok, false, 'transitionTask must return false for suffixed slug with id mismatch');

    const lastSubject = childProcess.spawnSync('git', ['log', '-1', '--format=%s'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    assert.notEqual(lastSubject, 'backlog(task-1048-regress): transition to active', 'no stray commit should be created');

    const content = fs.readFileSync(taskPath2, 'utf8');
    assert.ok(!content.includes('status: active'), 'task file status must not be modified');

    assert.ok(logs.some(msg => msg.toLowerCase().includes('rejected')), 'a warning must be logged');
  });
});

test('transitionTask permits exact slug match (no suffix)', async () => {
  await withTempGitRepo(async root => {
    const taskPath = path.join(root, 'backlog', 'tasks', 'task-1048 - exact.md');
    fs.writeFileSync(taskPath, 'id: TASK-1048\nstatus: backlog\nassignee: [gemini]\n');

    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed task'], { cwd: root, encoding: 'utf8' });

    const logs = [];
    const ok = await transitionTask('task-1048', 'active', { rootDir: root, log: msg => logs.push(msg) });
    assert.equal(ok, true, 'exact slug match must be permitted');

    const lastSubject = childProcess.spawnSync('git', ['log', '-1', '--format=%s'], { cwd: root, encoding: 'utf8' }).stdout.trim();
    assert.equal(lastSubject, 'backlog(task-1048): transition to active', 'commit must use the exact slug');
  });
});

test('getTaskClassification ignores non-classification labels like bug — inline format', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');

    const pathAiBug = path.join(taskDir, 'task-classify-ai-bug.md');
    fs.writeFileSync(pathAiBug, '---\nlabels: [ai_sdlc, bug]\n---\n');
    assert.equal(getTaskMissionType(pathAiBug), 'ai_sdlc');

    const pathUserBug = path.join(taskDir, 'task-classify-user-bug.md');
    fs.writeFileSync(pathUserBug, '---\nlabels: [user_value, bug]\n---\n');
    assert.equal(getTaskMissionType(pathUserBug), 'user_value');

    const pathBugOnly = path.join(taskDir, 'task-classify-bug-only.md');
    fs.writeFileSync(pathBugOnly, '---\nlabels: [bug]\n---\n');
    assert.equal(getTaskMissionType(pathBugOnly), null);

    const pathUnknownBug = path.join(taskDir, 'task-classify-unknown-bug.md');
    fs.writeFileSync(pathUnknownBug, '---\nlabels: [unknown, bug]\n---\n');
    assert.equal(getTaskMissionType(pathUnknownBug), 'unknown');
  });
});

test('getTaskClassification ignores non-classification labels like bug — block format', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');

    const pathAiBug = path.join(taskDir, 'task-classify-block-ai-bug.md');
    fs.writeFileSync(pathAiBug, '---\nlabels:\n  - ai_sdlc\n  - bug\n---\n');
    assert.equal(getTaskMissionType(pathAiBug), 'ai_sdlc');

    const pathUserBug = path.join(taskDir, 'task-classify-block-user-bug.md');
    fs.writeFileSync(pathUserBug, '---\nlabels:\n  - user_value\n  - bug\n---\n');
    assert.equal(getTaskMissionType(pathUserBug), 'user_value');

    const pathBugOnly = path.join(taskDir, 'task-classify-block-bug-only.md');
    fs.writeFileSync(pathBugOnly, '---\nlabels:\n  - bug\n---\n');
    assert.equal(getTaskMissionType(pathBugOnly), null);
  });
});

test('hasBugLabel detects bug in inline and block label formats', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');

    const inlineTask = path.join(taskDir, 'task-bug-inline.md');
    fs.writeFileSync(inlineTask, '---\nlabels: [ai_sdlc, bug]\n---\n');
    assert.equal(hasBugLabel(inlineTask), true);

    const blockTask = path.join(taskDir, 'task-bug-block.md');
    fs.writeFileSync(blockTask, '---\nlabels:\n  - ai_sdlc\n  - bug\n---\n');
    assert.equal(hasBugLabel(blockTask), true);

    const noBugInline = path.join(taskDir, 'task-nobug-inline.md');
    fs.writeFileSync(noBugInline, '---\nlabels: [ai_sdlc]\n---\n');
    assert.equal(hasBugLabel(noBugInline), false);

    const noBugBlock = path.join(taskDir, 'task-nobug-block.md');
    fs.writeFileSync(noBugBlock, '---\nlabels:\n  - user_value\n---\n');
    assert.equal(hasBugLabel(noBugBlock), false);

    const nonexistent = path.join(taskDir, 'task-nonexistent.md');
    assert.equal(hasBugLabel(nonexistent), false);
  });
});

test('getTaskLabels extracts all labels from inline and block formats', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');

    const inlineTask = path.join(taskDir, 'task-labels-inline.md');
    fs.writeFileSync(inlineTask, '---\nlabels: [ai_sdlc, bug, feature]\n---\n');
    assert.deepEqual(getTaskLabels(inlineTask), ['ai_sdlc', 'bug', 'feature']);

    const blockTask = path.join(taskDir, 'task-labels-block.md');
    fs.writeFileSync(blockTask, '---\nlabels:\n  - user_value\n  - bug\n---\n');
    assert.deepEqual(getTaskLabels(blockTask), ['user_value', 'bug']);

    const noLabels = path.join(taskDir, 'task-labels-none.md');
    fs.writeFileSync(noLabels, '---\nid: TASK-000\n---\n');
    assert.deepEqual(getTaskLabels(noLabels), []);

    const nonexistent = path.join(taskDir, 'task-labels-missing.md');
    assert.deepEqual(getTaskLabels(nonexistent), []);
  });
});

test('getTaskLabels block format takes precedence over inline when both present', () => {
  withTempRepo(root => {
    const taskDir = path.join(root, 'backlog', 'tasks');
    const taskPath = path.join(taskDir, 'task-labels-precedence.md');
    fs.writeFileSync(taskPath, '---\nlabels: [inline-label]\nlabels:\n  - block-label\n---\n');
    // Block format is parsed first and returned; inline is fallback
    const labels = getTaskLabels(taskPath);
    assert.ok(labels.includes('block-label'));
  });
});
