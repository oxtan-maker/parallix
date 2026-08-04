
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  VALID_EVENT_TYPES,
  ALL_EVENT_TYPES,
  MIRRORED_EVENT_TYPES,
  VALID_DISPOSITIONS,
  VALID_VERDICTS,
  isValidEventType,
  isValidDisposition,
  isValidVerdict,
  shouldMirrorToForgejo,
  createEvent,
  eventFilePath,
  reviewEventsDir,
  readAllEvents,
  buildEventFrontmatter,
  buildEventFooter,
  renderEventFile,
  generateEventTimestamp,
  sanitizeFilename,
  consumeHumanNotes,
} = require('../.test-runtime/adapters/review/review-events.js');
const { seedMissionDatabase } = require('./fixtures/review-state-db.js');
const { agentFamily } = require('../.test-runtime/domain/agents.js');

// Test slug that is guaranteed not to exist
const NONEXISTENT_SLUG = 'task-test-review-events-nonexistent';

// Create a temporary mission directory for testing
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-events-test-'));
const testMissionDir = path.join(tempDir, 'missions', 'task-test-events');
fs.mkdirSync(testMissionDir, { recursive: true });

// Write a minimal MISSION.md so findMissionDir works
fs.writeFileSync(path.join(testMissionDir, 'MISSION.md'), '# Test Mission\n', 'utf8');

const TEST_SLUG = 'task-test-events';

// After the TASK-2322.12 cutover a review event is stored on the Review
// aggregate, so anything that creates or reads one needs a real operator
// database with a mission that has a Review. Each call gets its own
// PARALLIX_HOME so the seeds can't collide.
async function withSeededReview(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'review-events-home-'));
  const restoreHome = await seedMissionDatabase(home, TEST_SLUG, tempDir);
  try {
    return await fn(restoreHome.store);
  } finally {
    await restoreHome();
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// Cleanup helper
function cleanupTempDir() {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {
    // Ignore cleanup errors
  }
}

// Test with real temp directory
test('generateEventTimestamp produces filesystem-safe timestamp', () => {
  const ts = generateEventTimestamp();
  assert.match(ts, /^\d{4}-\d{2}-\d{2}T\d{6}$/, 'Timestamp should be ISO-like without colons');
  // Verify it can be used in a filename
  const testPath = path.join(os.tmpdir(), `${ts}-test.md`);
  assert.doesNotThrow(() => fs.writeFileSync(testPath, 'test', 'utf8'));
  fs.unlinkSync(testPath);
});

test('sanitizeFilename produces filesystem-safe strings', () => {
  assert.equal(sanitizeFilename('codex'), 'codex');
  assert.equal(sanitizeFilename('Codex Agent'), 'codex-agent');
  assert.equal(sanitizeFilename('claude@example.com'), 'claudeexamplecom');
  assert.equal(sanitizeFilename(''), 'unknown');
  assert.equal(sanitizeFilename(null), 'unknown');
  assert.equal(sanitizeFilename('---test---'), 'test');
  assert.equal(sanitizeFilename('UPPERCASE'), 'uppercase');
});

test('isValidEventType validates against taxonomy', () => {
  for (const type of ALL_EVENT_TYPES) {
    assert.ok(isValidEventType(type), `Type ${type} should be valid`);
  }
  assert.ok(!isValidEventType('invalid_type'));
  assert.ok(!isValidEventType(''));
  assert.ok(!isValidEventType(null));
  assert.ok(!isValidEventType('reviewer_findings_extra'));
});

test('isValidDisposition validates disposition values', () => {
  for (const d of VALID_DISPOSITIONS) {
    assert.ok(isValidDisposition(d), `Disposition ${d} should be valid`);
  }
  assert.ok(!isValidDisposition('invalid'));
  assert.ok(!isValidDisposition(''));
});

test('isValidVerdict validates verdict values', () => {
  for (const v of VALID_VERDICTS) {
    assert.ok(isValidVerdict(v), `Verdict ${v} should be valid`);
  }
  assert.ok(!isValidVerdict('invalid'));
  assert.ok(!isValidVerdict(''));
});

test('shouldMirrorToForgejo identifies mirrored event types', () => {
  // These should be mirrored
  assert.ok(shouldMirrorToForgejo(VALID_EVENT_TYPES.REVIEWER_FINDINGS));
  assert.ok(shouldMirrorToForgejo(VALID_EVENT_TYPES.REVIEWER_OUTCOME));
  assert.ok(shouldMirrorToForgejo(VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY));
  assert.ok(shouldMirrorToForgejo(VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION));
  assert.ok(shouldMirrorToForgejo(VALID_EVENT_TYPES.HUMAN_NOTE));
  
  // These should NOT be mirrored
  assert.ok(!shouldMirrorToForgejo(VALID_EVENT_TYPES.BLOCKED_PUBLICATION));
  assert.ok(!shouldMirrorToForgejo(VALID_EVENT_TYPES.PARKED_FOLLOWUP));
  assert.ok(!shouldMirrorToForgejo(VALID_EVENT_TYPES.NEUTRAL_DISCUSSION));
  assert.ok(!shouldMirrorToForgejo('invalid_type'));
});

test('reviewEventsDir returns null for nonexistent mission', () => {
  const result = reviewEventsDir(NONEXISTENT_SLUG);
  assert.equal(result, null);
});

test('reviewEventsDir returns path for existing mission', () => {
  const result = reviewEventsDir(TEST_SLUG, tempDir);
  assert.ok(result);
  assert.equal(result, path.join(testMissionDir, 'review-events'));
});

test('eventFilePath generates correct path', () => {
  const result = eventFilePath(TEST_SLUG, 'reviewer_findings', 1, 'codex', null, tempDir);
  assert.ok(result);
  assert.ok(result.includes('review-events'));
  assert.ok(result.includes('reviewer_findings'));
  assert.ok(result.includes('1'));
  assert.ok(result.includes('codex'));
  assert.ok(result.endsWith('.md'));
});

test('createEvent fails for invalid event type', async () => {
  const result = await createEvent(TEST_SLUG, 'invalid_type', { content: '# test' }, {
    worktree: tempDir,
    skipGit: true
  });
  assert.ok(!result.ok);
  assert.match(result.error, /Invalid event type/);
});

test('createEvent fails for invalid disposition', async () => {
  const result = await createEvent(TEST_SLUG, VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION, {
    content: '# test',
    disposition: 'INVALID'
  }, {
    worktree: tempDir,
    skipGit: true
  });
  assert.ok(!result.ok);
  assert.match(result.error, /Invalid disposition/);
});

test('createEvent fails for invalid verdict', async () => {
  const result = await createEvent(TEST_SLUG, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    content: '# test',
    verdict: 'INVALID'
  }, {
    worktree: tempDir,
    skipGit: true
  });
  assert.ok(!result.ok);
  assert.match(result.error, /Invalid verdict/);
});

test('createEvent succeeds for valid event', async () => {
  await withSeededReview(async (missionStore) => {
  const result = await createEvent(TEST_SLUG, VALID_EVENT_TYPES.REVIEWER_FINDINGS, {
    content: '# Review Findings\n\n## Finding 1\n- File: workflow/lib/test.js\n- Severity: HIGH',
    round: 1,
    phase: 'reviewing',
    actor: 'claude'
  }, {
    worktree: tempDir,
    skipGit: true,
    missionStore,
  });
  
  assert.ok(result.ok);
  assert.ok(result.path);
  assert.ok(fs.existsSync(result.path));
  
  const fileContent = fs.readFileSync(result.path, 'utf8');
  assert.ok(fileContent.includes('---'));
  assert.ok(fileContent.includes('event_type: reviewer_findings'));
  assert.ok(fileContent.includes('round: 1'));
  assert.ok(fileContent.includes('phase: reviewing'));
  assert.ok(fileContent.includes('actor: claude'));
  assert.ok(fileContent.includes('# Review Findings'));
  
  // Cleanup
  fs.unlinkSync(result.path);
  });
});

test('createEvent adds workflow metadata footer', async () => {
  await withSeededReview(async (missionStore) => {
  const result = await createEvent(TEST_SLUG, VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY, {
    content: '# Resolution Summary',
    round: 2,
    phase: 'fixing',
    actor: 'gemini'
  }, {
    worktree: tempDir,
    skipGit: true,
    missionStore,
  });
  
  assert.ok(result.ok);
  const fileContent = fs.readFileSync(result.path, 'utf8');
  assert.ok(fileContent.includes('[workflow-round:2, workflow-phase:fixing]'));
  
  // Cleanup
  fs.unlinkSync(result.path);
  });
});

test('createEvent requires verdict for reviewer_outcome', async () => {
  const result = await createEvent(TEST_SLUG, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    content: '# Review Outcome',
    round: 1,
    phase: 'reviewing',
    actor: 'codex'
  }, {
    worktree: tempDir,
    skipGit: true
  });
  
  assert.ok(!result.ok);
  assert.match(result.error, /reviewer_outcome event requires verdict/);
});

test('createEvent requires disposition for implementer_disposition', async () => {
  const result = await createEvent(TEST_SLUG, VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION, {
    content: '# Disposition',
    round: 1,
    phase: 'fixing',
    actor: 'mistral'
  }, {
    worktree: tempDir,
    skipGit: true
  });
  
  assert.ok(!result.ok);
  assert.match(result.error, /implementer_disposition event requires disposition/);
});

test('createEvent succeeds with required fields for reviewer_outcome', async () => {
  await withSeededReview(async (missionStore) => {
  const result = await createEvent(TEST_SLUG, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    content: '# Review Outcome',
    round: 1,
    phase: 'reviewing',
    actor: 'codex',
    verdict: 'approve'
  }, {
    worktree: tempDir,
    skipGit: true,
    missionStore,
  });
  
  assert.ok(result.ok);
  assert.ok(result.path);
  const fileContent = fs.readFileSync(result.path, 'utf8');
  assert.ok(fileContent.includes('verdict: approve'));
  
  // Cleanup
  fs.unlinkSync(result.path);
  });
});

test('createEvent succeeds with required fields for implementer_disposition', async () => {
  await withSeededReview(async (missionStore) => {
  const result = await createEvent(TEST_SLUG, VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION, {
    content: '# Disposition',
    round: 1,
    phase: 'fixing',
    actor: 'mistral',
    disposition: 'CHANGES_MADE'
  }, {
    worktree: tempDir,
    skipGit: true,
    missionStore,
  });
  
  assert.ok(result.ok);
  assert.ok(result.path);
  const fileContent = fs.readFileSync(result.path, 'utf8');
  assert.ok(fileContent.includes('disposition: CHANGES_MADE'));
  
  // Cleanup
  fs.unlinkSync(result.path);
  });
});

test('buildEventFrontmatter includes all fields', () => {
  const event = {
    eventType: 'reviewer_findings',
    timestamp: '2026-05-25T14:30:22.000Z',
    round: 1,
    phase: 'reviewing',
    actor: 'codex',
    slug: 'task-test',
    disposition: 'CHANGES_MADE',
    itemDispositions: [
      { kind: 'fixed' as const, findingId: 'item1' as const },
      { kind: 'fixed' as const, findingId: 'item2' as const },
    ],
  };

  const frontmatter = buildEventFrontmatter(event);
  assert.ok(frontmatter.includes('event_type: reviewer_findings'));
  assert.ok(frontmatter.includes('timestamp: 2026-05-25T14:30:22.000Z'));
  assert.ok(frontmatter.includes('round: 1'));
  assert.ok(frontmatter.includes('phase: reviewing'));
  assert.ok(frontmatter.includes('actor: codex'));
  assert.ok(frontmatter.includes('disposition: CHANGES_MADE'));
  assert.ok(frontmatter.includes('item_dispositions:'));
});

test('buildEventFooter matches existing metadata footer pattern', () => {
  const footer = buildEventFooter('task-test', 3, 'fixing');
  assert.equal(footer, '\n\n---\n`[workflow-round:3, workflow-phase:fixing]`');
});

test('renderEventFile combines frontmatter and content', () => {
  const event = {
    eventType: 'reviewer_findings',
    timestamp: '2026-05-25T14:30:22.000Z',
    round: 1,
    phase: 'reviewing',
    actor: 'codex',
    slug: 'task-test',
    content: '# Findings'
  };
  
  const rendered = renderEventFile(event);
  assert.ok(rendered.startsWith('---'));
  assert.ok(rendered.includes('event_type: reviewer_findings'));
  assert.ok(rendered.includes('# Findings'));
  assert.ok(rendered.includes('[workflow-round:1, workflow-phase:reviewing]'));
});

test('renderEventFile does not duplicate an existing workflow metadata footer', () => {
  const footer = buildEventFooter('task-test', 1, 'reviewing');
  const event = {
    eventType: 'reviewer_findings',
    timestamp: '2026-05-25T14:30:22.000Z',
    round: 1,
    phase: 'reviewing',
    actor: 'codex',
    slug: 'task-test',
    content: `# Findings${footer}`
  };

  const rendered = renderEventFile(event);
  const footerMatches = rendered.match(/\`\[workflow-round:1, workflow-phase:reviewing\]\`/g) || [];

  assert.equal(footerMatches.length, 1);
});

test('createEvent fails loudly when the mission has no Review in the database', async () => {
  // No seeded database: there is no Review to append the event to. The event
  // must not be written anywhere else — a mission that quietly acquires a
  // file-backed review conversation is the dual authority the cutover removed.
  const eventsDir = path.join(testMissionDir, 'review-events');
  fs.mkdirSync(eventsDir, { recursive: true });
  const before = fs.readdirSync(eventsDir);

  const result = await createEvent(TEST_SLUG, VALID_EVENT_TYPES.REVIEWER_FINDINGS, {
    content: '# Findings',
    round: 1,
    phase: 'reviewing',
    actor: 'claude',
  }, { worktree: tempDir, skipGit: true, error: () => {} });

  assert.ok(!result.ok);
  assert.match(result.error, /no Review in the operator database/i);
  assert.equal(result.path, null);
  assert.deepEqual(fs.readdirSync(eventsDir), before, 'no event file may be written without a stored event');
});

test('readAllEvents returns empty array for nonexistent directory', async () => {
  const events = await readAllEvents(NONEXISTENT_SLUG, { rootDir: tempDir });
  assert.deepEqual(events, []);
});

test('readAllEvents reads the stored events, not the exported files', async () => {
  await withSeededReview(async (missionStore) => {
    const eventsDir = path.join(testMissionDir, 'review-events');
    fs.mkdirSync(eventsDir, { recursive: true });
    for (const f of fs.readdirSync(eventsDir)) { fs.unlinkSync(path.join(eventsDir, f)); }

    // A Markdown file that was never stored is not an event. Reading it back
    // would resurrect the second authority this mission removed.
    fs.writeFileSync(
      path.join(eventsDir, '2026-05-25T143022-reviewer_findings-1-claude.md'),
      ['---', 'event_type: reviewer_findings', 'round: 9', 'phase: reviewing',
        'actor: nobody', 'timestamp: 2026-05-25T14:30:22.000Z', '---', '', '# Stray file'].join('\n'),
      'utf8',
    );

    assert.deepEqual(await readAllEvents(TEST_SLUG, { rootDir: tempDir, missionStore }), []);

    const created = await createEvent(TEST_SLUG, VALID_EVENT_TYPES.REVIEWER_FINDINGS, {
      content: '# Test Finding',
      round: 1,
      phase: 'reviewing',
      actor: 'claude',
    }, { worktree: tempDir, skipGit: true, missionStore });
    assert.ok(created.ok);

    const events = await readAllEvents(TEST_SLUG, { rootDir: tempDir, missionStore });
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'reviewer_findings');
    assert.equal(events[0].round, 1);
    assert.equal(events[0].actor, 'claude');

    for (const f of fs.readdirSync(eventsDir)) { fs.unlinkSync(path.join(eventsDir, f)); }
  });
});

test('classifyComment identifies human notes (no workflow footer)', () => {
  const { classifyComment, VALID_EVENT_TYPES } = require('../.test-runtime/adapters/review/review-events.js');
  
  // Human comment (no footer)
  const humanComment = { body: 'This is a human comment' };
  assert.equal(classifyComment(humanComment), VALID_EVENT_TYPES.HUMAN_NOTE);
  
  // Workflow comment (with footer)
  const workflowComment = { body: 'Some content\n\n---\n`[workflow-round:1, workflow-phase:reviewing]`' };
  assert.equal(classifyComment(workflowComment), null);
  
  // Empty body
  const emptyComment = { body: '' };
  assert.equal(classifyComment(emptyComment), VALID_EVENT_TYPES.HUMAN_NOTE);
});

test('hasWorkflowFooter detects workflow metadata footer', () => {
  const { hasWorkflowFooter } = require('../.test-runtime/adapters/review/review-events.js');
  
  // Has footer
  assert.ok(hasWorkflowFooter('Some content\n\n---\n`[workflow-round:1, workflow-phase:reviewing]`'));
  assert.ok(hasWorkflowFooter('`[workflow-round:2, workflow-phase:fixing]`'));
  
  // Does not have footer
  assert.ok(!hasWorkflowFooter('This is a human comment'));
  assert.ok(!hasWorkflowFooter('Some content\n\n---\n'));
  assert.ok(!hasWorkflowFooter(''));
});

test('consumeHumanNotes creates human_note events and skips workflow comments', async () => {
  // The round and phase stamped on the event come from the Review aggregate
  // after the TASK-2322.12 cutover, so seed the operator database rather than a
  // review-state.json file.
  const restoreHome = await seedMissionDatabase(
    path.join(tempDir, 'parallix-home'),
    TEST_SLUG,
    tempDir,
    { number: 3, reviewer: agentFamily('claude'), implementer: agentFamily('mistral'), phase: 'reviewing' },
  );
  const missionStore = restoreHome.store;

  const seen = { branch: null, token: null };
  const result = await consumeHumanNotes(TEST_SLUG, 'claude', {
    worktree: tempDir,
    forgejoUser: 'claude',
    readTokenFn: () => 'token-123',
    readReviewStateFn: (slug, rootDir) => require('../.test-runtime/adapters/review/review-state.js').readReviewState(slug, rootDir, missionStore),
    createEventFn: (slug, eventType, params, options) => createEvent(slug, eventType, params, { ...options, missionStore }),
    getCommentsFn: async (branch, token) => {
      seen.branch = branch;
      seen.token = token;
      return [
        {
          body: 'Human reviewer note',
          user: 'magnus',
          created: '2026-05-25T19:00:00Z'
        },
        {
          body: 'Workflow note\n\n---\n`[workflow-round:3, workflow-phase:reviewing]`',
          user: 'claude',
          created: '2026-05-25T19:01:00Z'
        }
      ];
    }
  });

  assert.ok(result.ok);
  assert.equal(seen.branch, 'mission/task-test-events');
  assert.equal(seen.token, 'token-123');
  assert.equal(result.created.length, 1);
  assert.equal(result.skipped.length, 1);

  const eventPath = result.created[0].path;
  // After TASK-2322.12 cutover, events are stored in SQLite (path starts with 'sqlite:').
  // The .md file path remains as a compatibility fallback.
  if (typeof eventPath === 'string' && eventPath.startsWith('sqlite:')) {
    // Verify the event was persisted in the Review aggregate
    const events = await readAllEvents(TEST_SLUG, { rootDir: tempDir, missionStore });
    assert.ok(Array.isArray(events) && events.length > 0);
    const lastEvent = events[events.length - 1];
    assert.equal(lastEvent.event_type, 'human_note');
    assert.equal(lastEvent.round, 3);
    assert.equal(lastEvent.phase, 'reviewing');
    assert.equal(lastEvent.actor, 'claude');
    assert.ok(lastEvent.content.includes('Human reviewer note'));
  } else {
    assert.ok(fs.existsSync(eventPath));
    const content = fs.readFileSync(eventPath, 'utf8');
    assert.ok(content.includes('event_type: human_note'));
    assert.ok(content.includes('round: 3'));
    assert.ok(content.includes('phase: reviewing'));
    assert.ok(content.includes('actor: claude'));
    assert.ok(content.includes('Human reviewer note'));

    try { fs.unlinkSync(eventPath); } catch (_) {}
  }
  await restoreHome();
});

// Run with cleanup
test.before(() => {
  // Remove stale /tmp/ task-test-events-* files from interrupted previous runs
  // These are created by importAllLegacyArtifacts tests and persist if a run is killed
  const tmpFiles = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('task-test-events-'));
  for (const f of tmpFiles) {
    try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch (_) {}
  }
});

test.after(() => {
  cleanupTempDir();
});
