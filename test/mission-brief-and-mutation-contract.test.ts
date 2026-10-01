// Mission brief and typed mutation contract: checkpoint documents, prompt authority and parity, typed
// Mission mutations, dependencies as a domain value, and Backlog materialization.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Checkpoint document: no task ID in the legacy file
//   Prompt parity: TASK-2468
//   Prompt authority: TASK-2521.03
//   Typed Mission mutation parity: TASK-2521.03
//   Mission dependency value: TASK-2521.04
//   Backlog Mission materialization: no task ID in the legacy file

import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCheckpointDocument, reconcileLegacyCheckpoint, renderCheckpointDocument } from '../src/adapters/backlog/checkpoint-document.js';
import { MissionId, missionId, missionLabels } from '../src/domain/mission.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDraftPrompt, resolveClassificationInstructions } from '../src/adapters/cli/commands/draft-prompts.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';
import { KNOWN_COMMANDS } from '../src/interfaces/cli/runtime.js';
import { missionBrief } from '../src/domain/mission-brief.js';
import { ASSIGN_HELP, CHECKPOINT_HELP, CRITERION_HELP, GATE_HELP, GOAL_HELP, NEL_HELP, SCOPE_HELP } from '../src/interfaces/cli/mission-writes.js';
import { MissionDependencyViolation, missionDependencies } from '../src/domain/mission-dependencies.js';
import { renderStatus, statusJson } from '../src/interfaces/cli/status.js';
import { StatusMissionData, StatusResult } from '../src/application/ports/cli-workflows.js';
import { materializeBacklogMission, missionStatusFromBacklog, type BacklogMissionRecord, type BacklogMissionSnapshot } from '../src/adapters/backlog/mission-materialization.js';
import { agentFamily } from '../src/domain/agents.js';
import { repositoryId } from '../src/domain/repository.js';

// no task ID in the legacy file (was test/checkpoint-document.test.ts)
describe('Checkpoint document', () => {
  const missionId = 'task-2525.04' as unknown as MissionId;

  const DOC = `# CP-2: First fix + regression tests

  ## Summary

  Work done.

  ## Goal Check

  | Criterion | Evidence | Status |
  |---|---|---|
  | Slice fixed | \`npm test -- test/checkpoint-document.test.ts\` | PASS |
  | Static analysis | \`./scripts/verify-local.sh static-analysis\` | PASS |

  Next action: Advance.`;

  test('parseCheckpointDocument extracts name, first line, goal-check rows, and next action', () => {
    const data = parseCheckpointDocument(missionId, 'CP-2.md', DOC);

    assert.equal(data.name, 'CP-2');
    assert.equal(data.rawFilename, 'CP-2.md');
    assert.equal(data.firstLine, 'CP-2: First fix + regression tests');
    assert.equal(data.goalCheck.length, 2);
    assert.deepEqual(data.goalCheck[0], { criterion: 'Slice fixed', evidence: '`npm test -- test/checkpoint-document.test.ts`' });
    assert.deepEqual(data.goalCheck[1], { criterion: 'Static analysis', evidence: '`./scripts/verify-local.sh static-analysis`' });
    assert.match(data.nextActionText, /^Advance/);
  });

  test('parseCheckpointDocument stops scanning at the next ## heading after the Goal Check table', () => {
    const content = [
      '# CP-3',
      '',
      '## Goal Check',
      '',
      '| Criterion | Evidence | Status |',
      '|---|---|---|',
      '| A | ev | PASS |',
      '',
      '## Next section',
      '',
      '| B | ev2 | PASS |',
      '',
      'Next action: go',
    ].join('\n');

    const data = parseCheckpointDocument(missionId, 'CP-3.md', content);
    assert.equal(data.goalCheck.length, 1);
    assert.equal(data.goalCheck[0].criterion, 'A');
  });

  test('parseCheckpointDocument ignores rows with fewer than two cells by ending the table', () => {
    const content = [
      '# CP-4',
      '## Goal Check',
      '| Criterion | Evidence | Status |',
      '|---|---|---|',
      '| only-one-cell',
      '| real | ev | PASS |',
      'Next action: go',
    ].join('\n');

    const data = parseCheckpointDocument(missionId, 'CP-4.md', content);
    assert.equal(data.goalCheck.length, 0);
  });

  test('parseCheckpointDocument accepts the alternate Goal Check Table heading', () => {
    const content = [
      '# CP-5',
      '## Goal Check Table',
      '| Criterion | Evidence | Status |',
      '|---|---|---|',
      '| A | ev | PASS |',
      'Next action: go',
    ].join('\n');

    const data = parseCheckpointDocument(missionId, 'CP-5.md', content);
    assert.equal(data.goalCheck.length, 1);
  });

  test('parseCheckpointDocument throws for a non-CP-named document', () => {
    assert.throws(() => parseCheckpointDocument(missionId, 'notes.md', DOC), /not named CP-<n>\.md/);
  });

  test('parseCheckpointDocument reads a multiline Next action section', () => {
    const parsed = parseCheckpointDocument(missionId, 'CP-1.md', '# CP-1: Check\n\n## Next action\n\nReview the change.\nThen hand off.\n');
    assert.equal(parsed.nextActionText, 'Review the change.\nThen hand off.');
  });

  test('parseCheckpointDocument collects the last Next action line when several are present', () => {
    const content = [
      '# CP-6',
      'Next action: first',
      '',
      '## Goal Check',
      '| Criterion | Evidence | Status |',
      '|---|---|---|',
      '| A | ev | PASS |',
      '',
      'Next action: second',
    ].join('\n');

    const data = parseCheckpointDocument(missionId, 'CP-6.md', content);
    assert.equal(data.nextActionText, 'second');
  });

  test('renderCheckpointDocument round-trips parsed data through the same shape', () => {
    const parsed = parseCheckpointDocument(missionId, 'CP-2.md', DOC);
    const rendered = renderCheckpointDocument(parsed);
    const reparsed = parseCheckpointDocument(missionId, 'CP-2.md', rendered);

    assert.deepEqual(reparsed.goalCheck, parsed.goalCheck);
    assert.equal(reparsed.nextActionText, parsed.nextActionText);
  });

  test('legacy checkpoint reconciliation fills missing evidence and rejects changed evidence', () => {
    const source = parseCheckpointDocument(missionId, 'CP-2.md', DOC);
    const empty = { ...source, goalCheck: [], nextActionText: '' };
    assert.deepEqual(reconcileLegacyCheckpoint(empty, source)?.goalCheck, source.goalCheck);
    assert.deepEqual(reconcileLegacyCheckpoint(source, empty), source);
    assert.equal(reconcileLegacyCheckpoint(source, {
      ...source, goalCheck: [{ criterion: source.goalCheck[0].criterion, evidence: 'different' }],
    }), null);
  });

  test('legacy checkpoint reconciliation completes an earlier truncated next action', () => {
    const source = parseCheckpointDocument(missionId, 'CP-1.md', '# CP-1: Check\n\n## Next action\n\nReview.\nThen hand off.\n');
    const truncated = { ...source, nextActionText: 'Review.' };
    assert.equal(reconcileLegacyCheckpoint(truncated, source)?.nextActionText, 'Review.\nThen hand off.');
    assert.equal(reconcileLegacyCheckpoint({ ...source, nextActionText: 'Different.' }, source), null);
  });

  test('legacy checkpoint reconciliation replaces only a synthetic handoff action', () => {
    const source = parseCheckpointDocument(missionId, 'CP-2.md', DOC);
    const synthetic = { ...source, nextActionText: 'Review the handed-off change.' };
    assert.equal(reconcileLegacyCheckpoint(synthetic, source)?.nextActionText, source.nextActionText);
    assert.equal(reconcileLegacyCheckpoint({ ...synthetic, goalCheck: [] }, source), null);
    assert.equal(reconcileLegacyCheckpoint({ ...synthetic, goalCheck: [{ criterion: 'Other', evidence: 'Other' }] }, source), null);
  });
});

// TASK-2468 (was test/task-2468-prompt-parity.test.ts)
describe('Prompt parity', () => {
  // TASK-2468 prompt parity: the one common draft prompt must render the same
  // intake-independent body for both intakes, differing only in the substituted
  // intake block (the classification instructions). The adhoc rendering must not
  // carry a Backlog task-file instruction, because an adhoc mission has no such
  // file — its intent comes from the free-text draft and its labels live in the
  // operator database, not a Backlog task.



  function writeTask(rootDir, slug, body) {
    const tasksDir = path.join(rootDir, 'backlog', 'tasks');
    fs.mkdirSync(tasksDir, { recursive: true });
    const file = path.join(tasksDir, `${slug} - ${slug.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.md`);
    fs.writeFileSync(file, body, 'utf8');
    return file;
  }

  function backlogTaskPath() {
    const root = registeredMkdtemp('parallix-bg-');
    // A real Backlog task: classified, no synthetic marker.
    const file = writeTask(
      root,
      'task-1000',
      ['---', 'id: TASK-1000', 'title: x', 'status: backlog', 'assignee: []', 'labels: [ai_sdlc]', '---', ''].join('\n'),
    );
    return { root, file, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
  }

  function syntheticTaskPath() {
    const root = registeredMkdtemp('parallix-ah-');
    // An adhoc draft's synthetic task: source marker present, unknown label.
    const file = writeTask(
      root,
      'adhoc-fix-hello',
      [
        '---',
        'id: ADHOC-FIX-HELLO',
        'title: fix hello',
        'status: backlog',
        'assignee: []',
        'labels: [unknown]',
        'source: synthetic',
        '---',
        '',
      ].join('\n'),
    );
    return { root, file, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
  }

  test('the substituted intake block differs between intakes and names the right authority', () => {
    const bg = backlogTaskPath();
    const ah = syntheticTaskPath();
    try {
      const bgInstructions = resolveClassificationInstructions(bg.file);
      const ahInstructions = resolveClassificationInstructions(ah.file);

      assert.notEqual(bgInstructions, ahInstructions, 'the two intakes must substitute different intake blocks');
      // Backlog intake still targets the Backlog task labels it owns.
      assert.match(bgInstructions, /Backlog task labels/);
      // Adhoc intake must not instruct through a Backlog task file it has no such file for.
      assert.doesNotMatch(ahInstructions, /Backlog task labels/);
    } finally {
      bg.cleanup();
      ah.cleanup();
    }
  });

  test('the common draft prompt body is intake-independent modulo identity and the intake block', () => {
    const bg = backlogTaskPath();
    const ah = syntheticTaskPath();
    try {
      const bgPrompt = buildDraftPrompt('task-1000', { rootDir: bg.root });
      const ahPrompt = buildDraftPrompt('adhoc-fix-hello', { rootDir: ah.root });
      const bgInstructions = resolveClassificationInstructions(bg.file);
      const ahInstructions = resolveClassificationInstructions(ah.file);

      // Normalize away the per-mission identity (slug + absolute paths) and the
      // substituted intake block, then the instruction bodies must match: the
      // intake difference is confined to that one block.
      const normalize = (prompt, instructions, root) =>
        prompt
          .replace(instructions, '{{classificationInstructions}}')
          .replaceAll(root, '<root>')
          .replace(/(?:task-1000|adhoc-fix-hello)/g, '<slug>');
      assert.equal(normalize(ahPrompt, ahInstructions, ah.root), normalize(bgPrompt, bgInstructions, bg.root));
      // The adhoc rendering must not instruct through a Backlog task file it has no such file for.
      assert.doesNotMatch(ahInstructions, /Backlog task labels/);
    } finally {
      bg.cleanup();
      ah.cleanup();
    }
  });
});

// TASK-2521.03 (was test/task-2521-03-prompt-authority.test.ts)
describe('Prompt authority', () => {
  /**
   * TASK-2521.03 SC6 / AC #5 — prompt authority.
   *
   * The runtime prompts must route Mission context and checkpoint evidence
   * through supported `px` commands, and must not present repository workflow
   * metadata as the Mission database. These assertions are red against the
   * pre-mission prompts (which instructed agents to write `CP-N.md` as durable
   * evidence and to execute "per the contract in MISSION.md") and green after.
   */


  const promptDir = path.join(process.cwd(), 'prompts');

  function prompt(name: string): string {
    return fs.readFileSync(path.join(promptDir, name), 'utf8');
  }

  function runtimePrompts(): { name: string; source: string }[] {
    return fs.readdirSync(promptDir)
      .filter((file) => file.endsWith('.md'))
      .map((name) => ({ name, source: prompt(name) }));
  }

  test('no runtime prompt instructs an agent to write a CP-N.md file as durable evidence', () => {
    for (const { name, source } of runtimePrompts()) {
      assert.ok(!/write `CP-N\.md`/.test(source), `${name} must not instruct writing CP-N.md as durable evidence`);
      assert.ok(
        !/create.{0,40}`?CP-\d*N?\.md`?.{0,40}(durable|evidence)/i.test(source),
        `${name} must not instruct creating a CP file as durable evidence`,
      );
    }
  });

  test('no runtime prompt presents repository workflow metadata as the Mission database', () => {
    for (const { name, source } of runtimePrompts()) {
      for (const match of source.matchAll(/^.*Mission database.*$/gm)) {
        assert.match(
          match[0],
          /is not the Mission database/,
          `${name} may only mention the Mission database to deny that workflow metadata is it`,
        );
      }
    }
  });

  test('the execute prompt reads Mission state and records only checkpoints', () => {
    const source = prompt('execute-core.md');
    assert.match(source, /px status \{\{slug\}\}/);
    assert.match(source, /px checkpoint record --name/);
    // An executing agent must not be able to rewrite the contract it is judged
    // against: goal, scope and gates are settled at draft.
    for (const write of [/px goal set/, /px scope set/, /px gate add/, /px gate remove/]) {
      assert.doesNotMatch(source, write, 'execute must not advertise a mission write');
    }
    assert.doesNotMatch(source, /--data <json>|--data-stdin/, 'no JSON request blob may be advertised');
    // AC #10: where the version comes from, and that a stale write changes nothing.
    assert.match(source, /--expected-version/);
    assert.match(source, /rejected with an explicit conflict and changes nothing/);
    // Lifecycle and review writes stay with the workflow, not the implementer.
    assert.match(source, /do not run .*`px active`.*`px review`/);
  });

  test('no runtime prompt tells an agent to read or write a workflow file for Mission state', () => {
    for (const { name, source } of runtimePrompts()) {
      assert.doesNotMatch(source, /px context/, `${name} must not name the retired context command`);
      assert.doesNotMatch(source, /px mission /, `${name} must not name the retired px mission namespace`);
      // Naming a workflow file even to deny it authority keeps it in the agent's
      // head as a place Mission state might live. The prompts must not mention
      // one at all.
      for (const file of [/MISSION\.md/, /\{\{missionPath\}\}/, /CP-\*\.md/, /review-state\.json/, /review-events/]) {
        assert.doesNotMatch(source, file, `${name} must not name a workflow file`);
      }
    }
  });

  test('the review and act-on-review prompts take Mission and review state from px status', () => {
    for (const name of ['review-core.md', 'act-on-review-core.md']) {
      const source = prompt(name);
      assert.match(source, /px status \{\{slug\}\}/, `${name} must name the supported read`);
    }
  });
});

// TASK-2521.03 (was test/task-2521-03-mutation-parity.test.ts)
describe('Typed Mission mutation parity', () => {
  /** TASK-2521.03 parity evidence: legacy agent writes must have a named home. */



  /** Every typed write help, concatenated: the agent-facing write surface. */
  const WRITE_SURFACE = [GOAL_HELP, SCOPE_HELP, CRITERION_HELP, GATE_HELP, NEL_HELP, CHECKPOINT_HELP, ASSIGN_HELP].join('\n');

  type Mapping = readonly [legacyMutation: string, replacement: string, authority: 'px' | 'existing' | 'unsupported'];

  /**
   * Every brief field, read off a real value rather than restated. A field added
   * to the domain with no parity row fails here, which is what keeps this audit
   * from decaying into a list someone once wrote.
   */
  const BRIEF_FIELDS = Object.keys(missionBrief({
    goal: 'g', why: 'w', scope: 's', outOfScope: [],
  })).sort();

  /** Which parity row owns each brief field. */
  const FIELD_OWNER: Readonly<Record<string, string>> = {
    goal: 'goal and why',
    why: 'goal and why',
    scope: 'scope and out-of-scope',
    outOfScope: 'scope and out-of-scope',
  };

  const MUTATION_PARITY: readonly Mapping[] = [
    ['task creation/title/description/labels', 'existing px draft Mission intake: the Mission aggregate is the only task record (TASK-2521.04)', 'existing'],
    ['task priority', 'unsupported: the Mission aggregate carries no priority and no consumer orders work by it', 'unsupported'],
    ['assignment/unassignment', 'px assign / px unassign', 'px'],
    ['dependency addition/removal', 'unsupported: Mission-to-Mission references, TASK-2521.04', 'unsupported'],
    ['goal and why', 'px goal set', 'px'],
    ['scope and out-of-scope', 'px scope set', 'px'],
    ['predicted NEL bucket', 'px nel set', 'px'],
    ['confidence/selection note/drivers', 'unsupported: no consumer reads them; the predicted NEL bucket is the sizing signal handoff calibrates', 'unsupported'],
    ['success criteria', 'px criterion add / px criterion remove', 'px'],
    ['checkpoint plan', 'px checkpoint plan / px checkpoint unplan', 'px'],
    ['mission gates', 'px gate add / px gate remove', 'px'],
    ['mission activation/state transitions', 'existing px active / px review / px integrate transitions', 'existing'],
    ['checkpoint creation/correction/Goal Check evidence', 'px checkpoint record', 'px'],
    ['review findings/decisions', 'existing px review workflow', 'existing'],
    ['implementer finding resolutions', 'existing px review workflow', 'existing'],
    ['review intervention/escalation', 'existing review workflow; no generic review patch', 'existing'],
    ['mission closeout', 'existing px integrate', 'existing'],
    ['follow-up/bug task creation', 'existing px draft Mission intake of a new Mission', 'existing'],
  ];

  /**
   * Pull `px <command>` tokens out of a text. Anchored on KNOWN_COMMANDS so a
   * parity row or a help line naming a command the CLI does not dispatch fails
   * here rather than rotting silently.
   */
  function pxCommands(text: string): Set<string> {
    const seen = new Set<string>();
    const re = /px ([a-z-]+)\b/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text))) { seen.add(match[1] as string); }
    return seen;
  }

  test('task-2521.03: every command the write helps name is actually dispatchable', () => {
    for (const command of pxCommands(WRITE_SURFACE)) {
      assert.ok(
        KNOWN_COMMANDS.includes(command),
        `write help names \`px ${command}\`, which is not in KNOWN_COMMANDS`,
      );
    }
  });

  test('task-2521.03: mutation-parity audit gives every legacy write a reachable authority', () => {
    for (const [legacy, replacement, authority] of MUTATION_PARITY) {
      assert.ok(legacy && replacement, `${legacy} needs a replacement`);
      assert.ok(['px', 'existing', 'unsupported'].includes(authority));
      // AC #3: an unsupported mutation must state the architectural reason, not just decline.
      if (authority === 'unsupported') { assert.match(replacement, /^unsupported: \S/, `${legacy} must give an architectural reason`); }
      // A row claiming a `px` command must name one the CLI dispatches.
      for (const command of pxCommands(replacement)) {
        assert.ok(
          KNOWN_COMMANDS.includes(command),
          `parity row "${legacy}" references unknown command: px ${command}`,
        );
      }
    }
  });

  test('task-2521.03: every typed write verb appears in the parity audit', () => {
    // Bidirectional: a write command that no parity row claims is an unaudited
    // mutation path, which is exactly what the audit exists to prevent.
    const claimed = new Set(MUTATION_PARITY.flatMap(([, replacement]) => [...pxCommands(replacement)]));
    for (const command of ['goal', 'scope', 'criterion', 'gate', 'nel', 'checkpoint', 'assign', 'unassign']) {
      assert.ok(claimed.has(command), `px ${command} is dispatchable but no parity row claims it`);
    }
  });

  test('task-2521.03: the write surface exposes no SQL, blob or patch-anything path', () => {
    assert.doesNotMatch(WRITE_SURFACE, /sql|patch-anything|db set/i);
    // AC #11/#13: typed flags only — a JSON request blob is the shape this
    // mission replaced, so its reappearance is a regression.
    assert.doesNotMatch(WRITE_SURFACE, /--data\b|--data-stdin/);
  });

  test('task-2521.03: every brief field is owned by a parity row', () => {
    const rows = new Set(MUTATION_PARITY.map(([legacy]) => legacy));
    for (const field of BRIEF_FIELDS) {
      const owner = FIELD_OWNER[field];
      assert.ok(owner, `execution-context field \`${field}\` has no parity row; add one or state why it is unsupported`);
      assert.ok(rows.has(owner), `parity row "${owner}" named by field \`${field}\` no longer exists`);
    }
  });
});

// TASK-2521.04 (was test/task-2521.04-mission-dependencies.test.ts)
describe('Mission dependency value', () => {
  /**
   * TASK-2521.04 — Mission dependencies as a domain value and a reported field.
   *
   * The end-to-end `px depends` round trip through a real database lives in
   * `test/mission-adhoc-and-context-cli-contract.test.ts` (Mission dependencies CLI section). This suite
   * covers the rules and the two reads that show them.
   */



  const OWNER = missionId('task-2521.04');

  function status(dependencies: readonly string[] | undefined): StatusResult {
    const missionData = {
      backlogStatus: 'active',
      assignee: 'claude',
      reviewHistory: [],
      dependencies,
    } as unknown as StatusMissionData;
    return {
      slug: 'task-2521.04',
      branch: 'mission/task-2521.04',
      missionData,
      staleWorktrees: [],
      agents: [],
      lastThreeCommits: [],
      uncommittedCount: 0,
    } as unknown as StatusResult;
  }

  describe('Mission dependencies', () => {
    it('records an ordered, distinct list of mission ids', () => {
      assert.deepEqual(
        missionDependencies(['task-2521.01', 'task-2521.03'], OWNER),
        ['task-2521.01', 'task-2521.03'],
      );
    });

    it('rejects a self-reference', () => {
      assert.throws(
        () => missionDependencies(['task-2521.01', 'task-2521.04'], OWNER),
        (error: unknown) => error instanceof MissionDependencyViolation
          && /cannot depend on itself/.test(error.message),
      );
    });

    it('rejects a duplicate and an id that is not a mission slug', () => {
      assert.throws(
        () => missionDependencies(['task-2521.01', 'task-2521.01'], OWNER),
        /already declared/,
      );
      assert.throws(
        () => missionDependencies(['TASK-2521.01'], OWNER),
        /is not a mission slug/,
      );
    });

    it('px status reports the recorded dependencies', () => {
      const lines: string[] = [];
      renderStatus(status(['task-2521.01', 'task-2521.03']), (message) => lines.push(message));
      assert.ok(
        lines.includes('Depends on: task-2521.01, task-2521.03'),
        `status output names the dependencies: ${lines.join(' | ')}`,
      );
    });

    it('px status says so when nothing is recorded', () => {
      const lines: string[] = [];
      renderStatus(status(undefined), (message) => lines.push(message));
      assert.ok(lines.includes('Depends on: nothing recorded'));
    });

    it('px status --json reports the recorded dependencies', () => {
      assert.deepEqual(
        JSON.parse(statusJson(status(['task-2521.01']))).dependencies,
        ['task-2521.01'],
      );
      assert.deepEqual(JSON.parse(statusJson(status(undefined))).dependencies, []);
    });
  });
});

// no task ID in the legacy file (was test/backlog-mission-materialization.test.ts)
describe('Backlog Mission materialization', () => {
  const codex = agentFamily('codex');
  const custom = agentFamily('custom');

  test('Backlog adapter maps persisted and virtual queue vocabulary to domain states', () => {
    assert.deepEqual(
      ['ready', 'refined', 'approved', 'ready-for-integration', 'integration']
        .map(missionStatusFromBacklog),
      ['refined', 'refined', 'integration', 'integration', 'integration'],
    );
    assert.equal(missionStatusFromBacklog('not-a-state'), null);
  });

  test('missionStatusFromBacklog maps "open" to "backlog"', () => {
    assert.equal(missionStatusFromBacklog('open'), 'backlog');
    assert.equal(missionStatusFromBacklog('OPEN'), 'backlog');
    assert.equal(missionStatusFromBacklog(' Open '), 'backlog');
  });

  function record(overrides: Partial<BacklogMissionRecord> = {}): BacklogMissionRecord {
    return {
      id: missionId('task-2294'),
      repositoryId: repositoryId('parallix'),
      title: 'base title',
      labels: missionLabels(['user_value']),
      status: 'active',
      assignee: codex,
      checkpoints: [],
      review: null,
      netEngineeringLines: null,
      ...overrides,
    };
  }

  function snapshot(
    overrides: Partial<BacklogMissionSnapshot> = {},
  ): BacklogMissionSnapshot {
    return {
      integrationBase: { kind: 'found', mission: record(), completionRecorded: false },
      missionWorktree: { kind: 'absent' },
      closedAt: null,
      ...overrides,
    };
  }

  test('integration base owns lifecycle while an open worktree supplies mission content', () => {
    const result = materializeBacklogMission(snapshot({
      integrationBase: {
        kind: 'found',
        mission: record({ status: 'integration', assignee: codex }),
        completionRecorded: false,
      },
      missionWorktree: {
        kind: 'found',
        mission: record({
          title: 'new worktree title',
          labels: missionLabels(['ai_sdlc', 'bug']),
          status: 'review',
          assignee: custom,
          netEngineeringLines: 42,
        }),
      },
    }));
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') { return; }
    assert.equal(result.contentSource, 'mission-worktree');
    assert.equal(result.mission.status, 'integration');
    assert.equal(result.mission.assignee, codex);
    assert.equal(result.mission.title, 'new worktree title');
    assert.deepEqual(result.mission.labels, ['ai_sdlc', 'bug']);
    assert.equal(result.mission.netEngineeringLines, 42);
    assert.equal(result.mission.closedAt, null);
  });

  test('integrated mission remains open while its worktree still exists', () => {
    const result = materializeBacklogMission(snapshot({
      integrationBase: {
        kind: 'found',
        mission: record({ status: 'done', title: 'merged content' }),
        completionRecorded: true,
      },
      missionWorktree: { kind: 'unreadable' },
      closedAt: null,
    }));
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') { return; }
    assert.equal(result.contentSource, 'integration-base');
    assert.equal(result.mission.status, 'done');
    assert.equal(result.mission.closedAt, null);
  });

  test('worktree or uncommitted closeout state cannot outrank the committed integration base', () => {
    const result = materializeBacklogMission(snapshot({
      integrationBase: {
        kind: 'found',
        mission: record({ status: 'integration' }),
        completionRecorded: false,
      },
      missionWorktree: {
        kind: 'found',
        mission: record({ status: 'done', title: 'uncommitted closeout content' }),
      },
    }));
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') { return; }
    assert.equal(result.mission.status, 'integration');
    assert.equal(result.mission.closedAt, null);
  });

  test('mission closes only after integration is recorded and the worktree is absent', () => {
    const result = materializeBacklogMission(snapshot({
      integrationBase: {
        kind: 'found',
        mission: record({ status: 'done', title: 'merged content' }),
        completionRecorded: true,
      },
      missionWorktree: { kind: 'absent' },
      closedAt: '2026-07-23T10:00:00Z',
    }));
    assert.equal(result.kind, 'found');
    if (result.kind !== 'found') { return; }
    assert.equal(result.mission.status, 'done');
    assert.equal(result.mission.closedAt, '2026-07-23T10:00:00Z');
  });

  test('task-authority disagreements never materialize a mission', () => {
    const cases: readonly [string, BacklogMissionSnapshot, string][] = [
      ['base missing despite a worktree copy', snapshot({
        integrationBase: { kind: 'missing' },
        missionWorktree: { kind: 'found', mission: record() },
      }), 'integration-base-missing'],
      ['duplicate or ambiguous base task', snapshot({ integrationBase: { kind: 'conflict' } }), 'integration-base-conflict'],
      ['completed placement before done status', snapshot({
        integrationBase: { kind: 'found', mission: record({ status: 'review' }), completionRecorded: true },
      }), 'completion-conflict'],
      ['done status outside completed placement', snapshot({
        integrationBase: { kind: 'found', mission: record({ status: 'done' }), completionRecorded: false },
      }), 'completion-conflict'],
      ['open worktree cannot be read', snapshot({
        missionWorktree: { kind: 'unreadable' },
      }), 'worktree-unreadable'],
      ['closed mission lacks a closure time', snapshot({
        integrationBase: { kind: 'found', mission: record({ status: 'done' }), completionRecorded: true },
      }), 'closure-time-missing'],
      ['closure is recorded before worktree removal', snapshot({
        integrationBase: { kind: 'found', mission: record({ status: 'done' }), completionRecorded: true },
        missionWorktree: { kind: 'found', mission: record({ status: 'done' }) },
        closedAt: '2026-07-23T10:00:00Z',
      }), 'closure-before-worktree-removal'],
      ['worktree belongs to another mission', snapshot({
        missionWorktree: {
          kind: 'found',
          mission: record({ id: missionId('task-other') }),
        },
      }), 'identity-conflict'],
    ];

    for (const [label, input, reason] of cases) {
      assert.deepEqual(materializeBacklogMission(input), { kind: 'unavailable', reason }, label);
    }
  });
});
