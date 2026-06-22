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
  importLegacyArtifact,
  importAllLegacyArtifacts,
  LEGACY_ARTIFACT_TO_EVENT_TYPE,
  readAllEvents,
  parseEventFile,
  buildEventFrontmatter,
  buildEventFooter,
  renderEventFile,
  generateEventTimestamp,
  sanitizeFilename,
  consumeHumanNotes,
} = require('../lib/review/review-events');

// Test slug that is guaranteed not to exist
const NONEXISTENT_SLUG = 'task-test-review-events-nonexistent';

// Create a temporary mission directory for testing
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-events-test-'));
const testMissionDir = path.join(tempDir, 'missions', 'task-test-events');
fs.mkdirSync(testMissionDir, { recursive: true });

// Write a minimal MISSION.md so findMissionDir works
fs.writeFileSync(path.join(testMissionDir, 'MISSION.md'), '# Test Mission\n', 'utf8');

const TEST_SLUG = 'task-test-events';

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

test('createEvent fails for invalid event type', () => {
  const result = createEvent(TEST_SLUG, 'invalid_type', { content: '# test' }, {
    worktree: tempDir,
    skipGit: true
  });
  assert.ok(!result.ok);
  assert.match(result.error, /Invalid event type/);
});

test('createEvent fails for invalid disposition', () => {
  const result = createEvent(TEST_SLUG, VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION, {
    content: '# test',
    disposition: 'INVALID'
  }, {
    worktree: tempDir,
    skipGit: true
  });
  assert.ok(!result.ok);
  assert.match(result.error, /Invalid disposition/);
});

test('createEvent fails for invalid verdict', () => {
  const result = createEvent(TEST_SLUG, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    content: '# test',
    verdict: 'INVALID'
  }, {
    worktree: tempDir,
    skipGit: true
  });
  assert.ok(!result.ok);
  assert.match(result.error, /Invalid verdict/);
});

test('createEvent succeeds for valid event', () => {
  const result = createEvent(TEST_SLUG, VALID_EVENT_TYPES.REVIEWER_FINDINGS, {
    content: '# Review Findings\n\n## Finding 1\n- File: workflow/lib/test.js\n- Severity: HIGH',
    round: 1,
    phase: 'reviewing',
    actor: 'claude'
  }, {
    worktree: tempDir,
    skipGit: true
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

test('createEvent adds workflow metadata footer', () => {
  const result = createEvent(TEST_SLUG, VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY, {
    content: '# Resolution Summary',
    round: 2,
    phase: 'fixing',
    actor: 'gemini'
  }, {
    worktree: tempDir,
    skipGit: true
  });
  
  assert.ok(result.ok);
  const fileContent = fs.readFileSync(result.path, 'utf8');
  assert.ok(fileContent.includes('[workflow-round:2, workflow-phase:fixing]'));
  
  // Cleanup
  fs.unlinkSync(result.path);
});

test('createEvent requires verdict for reviewer_outcome', () => {
  const result = createEvent(TEST_SLUG, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
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

test('createEvent requires disposition for implementer_disposition', () => {
  const result = createEvent(TEST_SLUG, VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION, {
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

test('createEvent succeeds with required fields for reviewer_outcome', () => {
  const result = createEvent(TEST_SLUG, VALID_EVENT_TYPES.REVIEWER_OUTCOME, {
    content: '# Review Outcome',
    round: 1,
    phase: 'reviewing',
    actor: 'codex',
    verdict: 'approve'
  }, {
    worktree: tempDir,
    skipGit: true
  });
  
  assert.ok(result.ok);
  assert.ok(result.path);
  const fileContent = fs.readFileSync(result.path, 'utf8');
  assert.ok(fileContent.includes('verdict: approve'));
  
  // Cleanup
  fs.unlinkSync(result.path);
});

test('createEvent succeeds with required fields for implementer_disposition', () => {
  const result = createEvent(TEST_SLUG, VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION, {
    content: '# Disposition',
    round: 1,
    phase: 'fixing',
    actor: 'mistral',
    disposition: 'CHANGES_MADE'
  }, {
    worktree: tempDir,
    skipGit: true
  });
  
  assert.ok(result.ok);
  assert.ok(result.path);
  const fileContent = fs.readFileSync(result.path, 'utf8');
  assert.ok(fileContent.includes('disposition: CHANGES_MADE'));
  
  // Cleanup
  fs.unlinkSync(result.path);
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
    fixedItems: ['item1', 'item2'],
    pushedBackItems: [],
    parkedItems: [],
  };
  
  const frontmatter = buildEventFrontmatter(event);
  assert.ok(frontmatter.includes('event_type: reviewer_findings'));
  assert.ok(frontmatter.includes('timestamp: 2026-05-25T14:30:22.000Z'));
  assert.ok(frontmatter.includes('round: 1'));
  assert.ok(frontmatter.includes('phase: reviewing'));
  assert.ok(frontmatter.includes('actor: codex'));
  assert.ok(frontmatter.includes('disposition: CHANGES_MADE'));
  assert.ok(frontmatter.includes('fixed_items:'));
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

test('parseEventFile extracts frontmatter', () => {
  const content = `---
event_type: reviewer_findings
timestamp: 2026-05-25T14:30:22.000Z
round: 1
phase: reviewing
---

# Findings

Some content here.`;
  
  const filePath = path.join(os.tmpdir(), 'test-parse.md');
  fs.writeFileSync(filePath, content, 'utf8');
  
  const parsed = parseEventFile(content, filePath);
  assert.equal(parsed.event_type, 'reviewer_findings');
  assert.equal(parsed.timestamp, '2026-05-25T14:30:22.000Z');
  assert.equal(parsed.round, 1);
  assert.equal(parsed.phase, 'reviewing');
  assert.equal(parsed.content, '# Findings\n\nSome content here.');
  
  fs.unlinkSync(filePath);
});

test('parseEventFile handles JSON array fields', () => {
  const content = `---
event_type: implementer_round_summary
fixed_items: ["item1","item2"]
pushed_back_items: []
parked_items: []
---

# Resolution`;
  
  const filePath = path.join(os.tmpdir(), 'test-parse-array.md');
  fs.writeFileSync(filePath, content, 'utf8');
  
  const parsed = parseEventFile(content, filePath);
  assert.deepEqual(parsed.fixed_items, ['item1', 'item2']);
  assert.deepEqual(parsed.pushed_back_items, []);
  assert.deepEqual(parsed.parked_items, []);
  
  fs.unlinkSync(filePath);
});

test('parseEventFile handles quoted strings with special chars', () => {
  const content = `---
event_type: blocked_publication
blocked_reason: "Cannot proceed: missing token"
---

Content`;
  
  const filePath = path.join(os.tmpdir(), 'test-parse-quoted.md');
  fs.writeFileSync(filePath, content, 'utf8');
  
  const parsed = parseEventFile(content, filePath);
  assert.equal(parsed.blocked_reason, 'Cannot proceed: missing token');
  
  fs.unlinkSync(filePath);
});

test('readAllEvents returns empty array for nonexistent directory', () => {
  const events = readAllEvents(NONEXISTENT_SLUG, { rootDir: tempDir });
  assert.deepEqual(events, []);
});

test('readAllEvents reads and parses event files', () => {
  // Create an event file
  const eventsDir = path.join(testMissionDir, 'review-events');
  fs.mkdirSync(eventsDir, { recursive: true });
  
  const eventContent = `---
event_type: reviewer_findings
round: 1
phase: reviewing
actor: claude
timestamp: 2026-05-25T14:30:22.000Z
---

# Test Finding`;
  
  const eventPath = path.join(eventsDir, '2026-05-25T143022-reviewer_findings-1-claude.md');
  fs.writeFileSync(eventPath, eventContent, 'utf8');
  
  const events = readAllEvents(TEST_SLUG, { rootDir: tempDir });
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'reviewer_findings');
  assert.equal(events[0].round, 1);
  assert.equal(events[0].actor, 'claude');
  
  // Cleanup
  fs.unlinkSync(eventPath);
});

test('importLegacyArtifact skips nonexistent file', () => {
  const result = importLegacyArtifact(TEST_SLUG, 'nonexistent.md', VALID_EVENT_TYPES.REVIEWER_FINDINGS, {}, {
    worktree: tempDir,
    tmpDir: os.tmpdir()
  });
  assert.ok(result.ok);
  assert.ok(result.skipped);
  assert.equal(result.path, null);
});

test('importLegacyArtifact imports existing /tmp/ file', () => {
  const tmpFile = path.join(os.tmpdir(), `${TEST_SLUG}-review-findings.md`);
  fs.writeFileSync(tmpFile, '# Legacy Findings\n\nContent here', 'utf8');
  
  const result = importLegacyArtifact(TEST_SLUG, 'review-findings.md', VALID_EVENT_TYPES.REVIEWER_FINDINGS, {
    round: 1,
    phase: 'reviewing',
    actor: 'codex'
  }, {
    worktree: tempDir,
    tmpDir: os.tmpdir(),
    skipGit: true
  });
  
  assert.ok(result.ok);
  assert.ok(!result.skipped);
  assert.ok(result.path);
  assert.ok(fs.existsSync(result.path));
  
  const fileContent = fs.readFileSync(result.path, 'utf8');
  assert.ok(fileContent.includes('event_type: reviewer_findings'));
  assert.ok(fileContent.includes('# Legacy Findings'));
  
  // Cleanup
  fs.unlinkSync(tmpFile);
  fs.unlinkSync(result.path);
});

test('LEGACY_ARTIFACT_TO_EVENT_TYPE maps all legacy artifacts', () => {
  assert.equal(LEGACY_ARTIFACT_TO_EVENT_TYPE['review-findings.md'], VALID_EVENT_TYPES.REVIEWER_FINDINGS);
  assert.equal(LEGACY_ARTIFACT_TO_EVENT_TYPE['review-outcome.md'], VALID_EVENT_TYPES.REVIEWER_OUTCOME);
  assert.equal(LEGACY_ARTIFACT_TO_EVENT_TYPE['review-verdict.txt'], VALID_EVENT_TYPES.REVIEWER_OUTCOME);
  assert.equal(LEGACY_ARTIFACT_TO_EVENT_TYPE['round-resolution.md'], VALID_EVENT_TYPES.IMPLEMENTER_ROUND_SUMMARY);
  assert.equal(LEGACY_ARTIFACT_TO_EVENT_TYPE['review-disposition.txt'], VALID_EVENT_TYPES.IMPLEMENTER_DISPOSITION);
});

test('importAllLegacyArtifacts imports multiple files', () => {
  // Create multiple legacy files
  const tmpFiles = {
    'review-findings.md': '# Findings',
    'review-outcome.md': '# Outcome',
    'round-resolution.md': '# Resolution',
  };
  
  const createdFiles = [];
  for (const [name, content] of Object.entries(tmpFiles)) {
    const filePath = path.join(os.tmpdir(), `${TEST_SLUG}-${name}`);
    fs.writeFileSync(filePath, content, 'utf8');
    createdFiles.push(filePath);
  }
  
  // Create a review-state.json for round/phase
  const statePath = path.join(testMissionDir, 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    reviewer: 'codex',
    implementer: 'claude',
    round: 2,
    phase: 'fixing',
    startedAt: new Date().toISOString()
  }, null, 2), 'utf8');
  
  const result = importAllLegacyArtifacts(TEST_SLUG, {
    worktree: tempDir,
    tmpDir: os.tmpdir(),
    skipGit: true
  });
  
  assert.ok(result.ok);
  assert.equal(result.imported.length, 3);
  
  // Cleanup
  for (const f of createdFiles) {
    try { fs.unlinkSync(f); } catch (_) {}
  }
  try { fs.unlinkSync(statePath); } catch (_) {}
  for (const imp of result.imported) {
    try { fs.unlinkSync(imp.path); } catch (_) {}
  }
});

test('importAllLegacyArtifacts with full reviewer artifact set normalizes verdict as metadata', () => {
  // Create all three reviewer artifacts: findings, outcome, and verdict
  const tmpFiles = {
    'review-findings.md': '# Review Findings\n\n1. Finding A',
    'review-outcome.md': '# Review Outcome\n\nThis is the outcome content',
    'review-verdict.txt': 'approve'
  };
  
  const createdFiles = [];
  for (const [name, content] of Object.entries(tmpFiles)) {
    const filePath = path.join(os.tmpdir(), `${TEST_SLUG}-${name}`);
    fs.writeFileSync(filePath, content, 'utf8');
    createdFiles.push(filePath);
  }
  
  // Create a review-state.json for round/phase
  const statePath = path.join(testMissionDir, 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    reviewer: 'codex',
    implementer: 'mistral',
    round: 2,
    phase: 'reviewing',
    startedAt: new Date().toISOString()
  }, null, 2), 'utf8');
  
  const result = importAllLegacyArtifacts(TEST_SLUG, {
    worktree: tempDir,
    tmpDir: os.tmpdir(),
    skipGit: true
  });
  
  assert.ok(result.ok, `import failed: ${result.errors ? result.errors.map(e => e.error).join('; ') : ''}`);
  
  // Should import exactly 3 artifacts: findings, outcome (with verdict metadata), verdict (as metadata)
  // But only 2 unique event files should be created: reviewer_findings and reviewer_outcome
  const outcomeImports = result.imported.filter(i => i.eventType === VALID_EVENT_TYPES.REVIEWER_OUTCOME);
  assert.equal(outcomeImports.length, 2, 'Should have 2 entries for outcome (one for outcome.md, one for verdict.txt as metadata)');
  
  // Find the actual outcome event file (not the metadata entry)
  const actualOutcomeImport = outcomeImports.find(i => !i.asMetadata);
  assert.ok(actualOutcomeImport, 'Should have a non-metadata outcome import');
  
  // Verify the verdict was stored as metadata
  const outcomeContent = fs.readFileSync(actualOutcomeImport.path, 'utf8');
  assert.ok(outcomeContent.includes('verdict:'), 'Outcome event should contain verdict frontmatter');
  assert.ok(outcomeContent.includes('approve'), 'Outcome event should have verdict value "approve"');
  
  // Verify only ONE reviewer_outcome event file was created (not two separate files)
  // Count actual files created (excluding metadata markers)
  const uniqueEventPaths = new Set(result.imported.filter(i => !i.asMetadata).map(i => i.path));
  assert.equal(uniqueEventPaths.size, 2, 'Should have exactly 2 unique event files: findings + outcome (verdict merged into outcome)');
  
  // Verify findings was also imported
  const findingsImport = result.imported.find(i => i.eventType === VALID_EVENT_TYPES.REVIEWER_FINDINGS);
  assert.ok(findingsImport, 'Should have imported reviewer_findings');
  
  // Cleanup
  for (const f of createdFiles) {
    try { fs.unlinkSync(f); } catch (_) {}
  }
  try { fs.unlinkSync(statePath); } catch (_) {}
  for (const imp of result.imported) {
    try { fs.unlinkSync(imp.path); } catch (_) {}
  }
});

test('classifyComment identifies human notes (no workflow footer)', () => {
  const { classifyComment, VALID_EVENT_TYPES } = require('../lib/review/review-events');
  
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
  const { hasWorkflowFooter } = require('../lib/review/review-events');
  
  // Has footer
  assert.ok(hasWorkflowFooter('Some content\n\n---\n`[workflow-round:1, workflow-phase:reviewing]`'));
  assert.ok(hasWorkflowFooter('`[workflow-round:2, workflow-phase:fixing]`'));
  
  // Does not have footer
  assert.ok(!hasWorkflowFooter('This is a human comment'));
  assert.ok(!hasWorkflowFooter('Some content\n\n---\n'));
  assert.ok(!hasWorkflowFooter(''));
});

test('consumeHumanNotes creates human_note events and skips workflow comments', async () => {
  const statePath = path.join(testMissionDir, 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    reviewer: 'claude',
    implementer: 'mistral',
    round: 3,
    phase: 'reviewing',
    startedAt: new Date().toISOString()
  }, null, 2), 'utf8');

  const seen = { branch: null, token: null };
  const result = await consumeHumanNotes(TEST_SLUG, 'claude', {
    worktree: tempDir,
    forgejoUser: 'claude',
    readTokenFn: () => 'token-123',
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
  assert.ok(fs.existsSync(eventPath));
  const content = fs.readFileSync(eventPath, 'utf8');
  assert.ok(content.includes('event_type: human_note'));
  assert.ok(content.includes('round: 3'));
  assert.ok(content.includes('phase: reviewing'));
  assert.ok(content.includes('actor: claude'));
  assert.ok(content.includes('Human reviewer note'));

  try { fs.unlinkSync(eventPath); } catch (_) {}
  try { fs.unlinkSync(statePath); } catch (_) {}
});

test('importAllLegacyArtifacts with only review-verdict.txt creates standalone outcome', () => {
  // Edge case: only review-verdict.txt exists (incomplete artifact set)
  const verdictPath = path.join(os.tmpdir(), `${TEST_SLUG}-review-verdict.txt`);
  fs.writeFileSync(verdictPath, 'request-changes', 'utf8');
  
  const statePath = path.join(testMissionDir, 'review-state.json');
  fs.writeFileSync(statePath, JSON.stringify({
    reviewer: 'codex',
    implementer: 'mistral',
    round: 1,
    phase: 'reviewing',
    startedAt: new Date().toISOString()
  }, null, 2), 'utf8');
  
  const result = importAllLegacyArtifacts(TEST_SLUG, {
    worktree: tempDir,
    tmpDir: os.tmpdir(),
    skipGit: true
  });
  
  assert.ok(result.ok);
  assert.equal(result.imported.length, 1);
  assert.equal(result.imported[0].eventType, VALID_EVENT_TYPES.REVIEWER_OUTCOME);
  assert.equal(result.imported[0].artifactName, 'review-verdict.txt');
  
  // Cleanup
  try { fs.unlinkSync(verdictPath); } catch (_) {}
  try { fs.unlinkSync(statePath); } catch (_) {}
  try { fs.unlinkSync(result.imported[0].path); } catch (_) {}
});

// Run with cleanup
test.before(() => {
  // Setup already done
});

test.after(() => {
  cleanupTempDir();
});
