// review cli dispatch contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
  createResolveCommand,
  createVerdictCommand,
  type ReviewVerbPorts,
} from '../../../../src/interfaces/cli/review-verbs.js';
import { ReviewCommandUseCase } from '../../../../src/application/review-command-use-case.js';
import { parseReviewCliRequest } from '../../../../src/interfaces/cli/review.js';

// Regression provenance: TASK-2521-03.
describe("review verbs", { concurrency: false }, () => {
  /**
   * TASK-2521.03 — `px verdict` / `px resolve`.
   *
   * The verbs add no review logic: they turn typed flags into the same calls the
   * review workflow already makes. These tests pin the part that is genuinely new
   * — the left-to-right flag pairing — and prove the verbs delegate rather than
   * reimplement, by asserting what reaches the injected recorders.
   */

  type ReviewerOutput = Parameters<ReviewVerbPorts['consumeReviewerOutput']>[2];
  type ImplementerOutput = Parameters<ReviewVerbPorts['consumeImplementerOutput']>[2];

  interface Recorded {
    reviewerOutputs: { slug: string; reviewer: string; output: ReviewerOutput; expectedVersion: number }[];
    implementerOutputs: { slug: string; implementer: string; output: ImplementerOutput; expectedVersion: number }[];
  }

  function ports(overrides: Partial<ReviewVerbPorts> = {}): { ports: ReviewVerbPorts; recorded: Recorded } {
    const recorded: Recorded = { reviewerOutputs: [], implementerOutputs: [] };
    return {
      recorded,
      ports: {
        resolveSlug: (explicit) => explicit ?? 'task-2521.03',
        resolveWorktree: () => '/tmp/worktree',
        readReviewState: async () => ({ round: 2, phase: 'reviewing' }),
        consumeReviewerOutput: async (slug, reviewer, output, _worktree, expectedVersion) => {
          recorded.reviewerOutputs.push({ slug, reviewer, output, expectedVersion });
          return { consumed: true, ok: true };
        },
        consumeImplementerOutput: async (slug, implementer, output, _worktree, expectedVersion) => {
          recorded.implementerOutputs.push({ slug, implementer, output, expectedVersion });
          return { consumed: true, ok: true };
        },
        ...overrides,
      },
    };
  }

  test('px verdict request-changes pairs each finding with the summary that follows it', async () => {
    const { ports: p, recorded } = ports();
    await createVerdictCommand(p)([
      'request-changes', '--actor', 'codex', '--expected-version', '7',
      '--finding', 'F1', '--summary', 'first problem', '--location', 'src/a.ts:1',
      '--finding', 'F2', '--summary', 'second problem',
    ]);
    // Order is the contract: F2 must not pick up F1's summary or location. The
    // findings reach the consumer as domain values, not as prose to re-parse.
    assert.deepEqual(recorded.reviewerOutputs[0]?.output.findings, [
      { id: 'F1', summary: 'first problem', location: 'src/a.ts:1' },
      { id: 'F2', summary: 'second problem', location: null },
    ]);
  });

  test('px verdict delegates typed output to the existing reviewer consumer', async () => {
    const { ports: p, recorded } = ports();
    await createVerdictCommand(p)(['approve', '--actor', 'codex', '--expected-version', '7', '--comment', 'looks good']);
    assert.deepEqual(recorded.reviewerOutputs, [{
      slug: 'task-2521.03', reviewer: 'codex',
      output: { findings: [], comment: 'looks good', verdict: 'approve' },
      expectedVersion: 7,
    }]);
    assert.equal(recorded.implementerOutputs.length, 0);
  });

  test('px verdict refuses to approve while naming findings', async () => {
    const { ports: p, recorded } = ports();
    await assert.rejects(
      () => createVerdictCommand(p)(['approve', '--actor', 'codex', '--expected-version', '7', '--finding', 'F1', '--summary', 'still broken']),
      /approve takes no --finding/,
    );
    assert.equal(recorded.reviewerOutputs.length, 0);
  });

  test('px verdict refuses to fabricate a round when no review state exists', async () => {
    const { ports: p } = ports({ readReviewState: async () => null });
    await assert.rejects(
      () => createVerdictCommand(p)(['approve', '--actor', 'codex', '--expected-version', '7']),
      /no review state/,
    );
  });

  test('px verdict rejects a finding with no summary rather than recording a partial decision', async () => {
    const { ports: p, recorded } = ports();
    await assert.rejects(
      () => createVerdictCommand(p)(['request-changes', '--actor', 'codex', '--expected-version', '7', '--finding', 'F1']),
      /--finding F1 needs a --summary/,
    );
    assert.equal(recorded.reviewerOutputs.length, 0, 'nothing is submitted when parsing fails');
  });

  test('px resolve pairs each finding with its fixed or disputed answer', async () => {
    const { ports: p, recorded } = ports();
    await createResolveCommand(p)([
      '--actor', 'codex', '--expected-version', '7', '--revision', 'abc1234',
      '--finding', 'F1', '--fixed', 'test/a.test.ts',
      '--finding', 'F2', '--disputed', 'out of scope',
    ]);
    const [output] = recorded.implementerOutputs;
    assert.ok(output, 'the resolution must reach the existing implementer consumer');
    assert.equal(output.output.resultingRevision, 'abc1234');
    assert.equal(output.output.disposition, 'CHANGES_MADE');
    assert.deepEqual(output.output.items, [
      { kind: 'fixed', findingId: 'F1' },
      { kind: 'pushed_back', findingId: 'F2' },
    ]);
    assert.deepEqual(output.output.evidence, [
      'F1: fixed — test/a.test.ts',
      'F2: disputed — out of scope',
    ]);
    assert.equal(output.output.blockedReason, null);
  });

  test('px resolve rejects a finding left without an answer', async () => {
    const { ports: p, recorded } = ports();
    await assert.rejects(
      () => createResolveCommand(p)(['--actor', 'codex', '--expected-version', '7', '--revision', 'abc1234', '--finding', 'F1', '--finding', 'F2', '--fixed', 'x']),
      /--finding F1 needs a --fixed or --disputed answer/,
    );
    assert.equal(recorded.implementerOutputs.length, 0, 'nothing is recorded when parsing fails');
  });

  test('px resolve reports PUSHBACK_ALL when every finding is disputed', async () => {
    const { ports: p, recorded } = ports();
    await createResolveCommand(p)(['--actor', 'codex', '--expected-version', '7', '--revision', 'abc', '--finding', 'F1', '--disputed', 'wrong']);
    assert.equal(recorded.implementerOutputs[0]?.output.disposition, 'PUSHBACK_ALL');
  });

  test('px resolve offers no park answer, so a finding is delivered or argued with', async () => {
    // A park button is an escape hatch: an agent that can file a follow-up instead
    // of doing the work will, and the round closes with the finding unaddressed.
    const { ports: p, recorded } = ports();
    await assert.rejects(
      () => createResolveCommand(p)(['--actor', 'codex', '--expected-version', '7', '--revision', 'abc', '--finding', 'F1', '--park', 'task-3000']),
      /--finding F1 needs a --fixed or --disputed answer/,
    );
    assert.equal(recorded.implementerOutputs.length, 0, 'a parked finding records nothing');
  });

  test('px resolve carries a blocked outcome to the existing consumer', async () => {
    const { ports: p, recorded } = ports();
    await createResolveCommand(p)(['--actor', 'codex', '--expected-version', '7', '--blocked', 'provider unavailable']);
    assert.equal(recorded.implementerOutputs[0]?.output.disposition, 'BLOCKED');
    assert.equal(recorded.implementerOutputs[0]?.output.blockedReason, 'provider unavailable');
    assert.deepEqual(recorded.implementerOutputs[0]?.output.items, []);
  });

  test('both verbs print help instead of writing when asked', async () => {
    const { ports: p, recorded } = ports();
    await createVerdictCommand(p)(['--help']);
    await createResolveCommand(p)(['--help']);
    assert.equal(recorded.reviewerOutputs.length, 0);
    assert.equal(recorded.implementerOutputs.length, 0);
  });

  test('both verbs require the version the caller read', async () => {
    // AC #10: a review decision is a Mission write like any other. Without this
    // an agent that read version N could land a verdict after another mutation
    // reached N+1 and never be told.
    const { ports: p, recorded } = ports();
    await assert.rejects(
      () => createVerdictCommand(p)(['approve', '--actor', 'codex']),
      /--expected-version <n> is required/,
    );
    await assert.rejects(
      () => createResolveCommand(p)(['--actor', 'codex', '--finding', 'F1', '--fixed', 'done']),
      /--expected-version <n> is required/,
    );
    await assert.rejects(
      () => createVerdictCommand(p)(['approve', '--actor', 'codex', '--expected-version', 'nope']),
      /--expected-version must be a positive integer/,
    );
    assert.equal(recorded.reviewerOutputs.length, 0);
    assert.equal(recorded.implementerOutputs.length, 0);
  });

  test('the version reaches the recorder so a stale decision can be refused', async () => {
    const { ports: p, recorded } = ports();
    await createVerdictCommand(p)(['approve', '--actor', 'codex', '--expected-version', '42']);
    assert.equal(recorded.reviewerOutputs[0]?.expectedVersion, 42);
    await createResolveCommand(p)(['--actor', 'codex', '--expected-version', '43', '--finding', 'F1', '--fixed', 'done']);
    assert.equal(recorded.implementerOutputs[0]?.expectedVersion, 43);
  });

  test('px resolve refuses to default the actor the review loop matches on', async () => {
    const { ports: p, recorded } = ports();
    await assert.rejects(
      () => createResolveCommand(p)(['--expected-version', '7', '--finding', 'F1', '--fixed', 'done']),
      /--actor <value> is required/,
    );
    assert.equal(recorded.implementerOutputs.length, 0);
  });

  /**
   * Every `px verdict` / `px resolve` invocation the runtime prompts document is
   * run through the real parser with its placeholders filled. A prompt that
   * drops a required flag, or spells the slug another way, fails here instead of
   * failing the first real review round.
   */
  test('every review-verb invocation documented in the prompts parses', async () => {
    const invocations = ['prompts/review-core.md', 'prompts/act-on-review-core.md']
      .flatMap((file) => [...fs.readFileSync(file, 'utf8').matchAll(/`(px (?:verdict|resolve) [^`]+)`/g)].map((match) => match[1] as string));
    assert.ok(invocations.length >= 4, `expected the prompts to document the review verbs, found ${invocations.length}`);
    for (const invocation of invocations) {
      const filled = invocation
        .replace(/\{\{slug\}\}/g, 'task-9').replace(/\{\{(?:reviewer|implementer)\}\}/g, 'codex')
        .replace(/<n>/g, '7').replace(/<finding-id>/g, 'F1')
        .replace(/\s*\[[^\]]*\]/g, '').replace(/\s\.\.\./g, '');
      const [, verb, ...args] = (filled.match(/"[^"]*"|\S+/g) ?? []).map((token) => token.replace(/^"|"$/g, ''));
      const { ports: p, recorded } = ports();
      await (verb === 'verdict' ? createVerdictCommand(p) : createResolveCommand(p))(args);
      const [call] = verb === 'verdict' ? recorded.reviewerOutputs : recorded.implementerOutputs;
      assert.ok(call, `${invocation} did not reach its recorder`);
      assert.equal(call.slug, 'task-9', `${invocation} must pass the slug with --slug`);
      assert.equal(call.expectedVersion, 7, `${invocation} must pass --expected-version`);
    }
  });
});

// Regression provenance: TASK-2428.
describe("review board characterization", { concurrency: false }, () => {
  type Operation = 'submit' | 'submitReview';

  function workflow(calls: Operation[]) {
    const record = (operation: Operation) => async () => { calls.push(operation); };
    return {
      preflight: async (args: string[], options: Record<string, unknown> = {}) => ({ slug: 'task-2428', args, options }),
      verify: async () => {}, submit: record('submit'), push: async () => {}, start: async () => {}, continue: async () => {}, resume: async () => {},
      comment: async () => {}, readComments: async () => {}, submitReview: record('submitReview'),
      close: async () => {}, status: async () => {}, createEvent: async () => {}, backfillReview: async () => {},
      reconcileReview: async () => {}, importLegacy: async () => {},
    };
  }

  test('task-2428 characterization: review:submit CLI selects submit-for-review, not a reviewer decision', async () => {
    const calls: Operation[] = [];
    await new ReviewCommandUseCase(workflow(calls)).execute(['task-2428', '--submit']);

    assert.deepEqual(calls, ['submit']);
  });

  test('task-2428 characterization: review:act-on-findings CLI rejects retired artifact consumption', async () => {
    assert.throws(() => parseReviewCliRequest(['task-2428', '--consume-artifacts']), /Unknown flag/);
  });

  test('task-2428 characterization: approve:review CLI selects reviewer verdict submission and remains unavailable', async () => {
    const calls: Operation[] = [];
    await new ReviewCommandUseCase(workflow(calls)).execute(['task-2428', '--submit-review', 'approve', '--message', 'approved']);

    assert.deepEqual(calls, ['submitReview']);
  });
});

// Regression provenance: TASK-2332.14.
describe("review use case", { concurrency: false }, () => {
  function mockedPort(calls: Array<{ operation: string; args: string[] }>) {
    const record = (operation: string) => async (context: { args: string[] }) => { calls.push({ operation, args: context.args }); };
    return {
      preflight: async (args: string[], options: Record<string, unknown> = {}) => ({ slug: 'task-2332.14', args, options }),
      verify: record('verify'), submit: record('submit'), push: record('push'), start: record('start'), continue: record('continue'), resume: record('resume'),
      comment: record('comment'), readComments: record('readComments'), submitReview: record('submitReview'), consumeArtifacts: record('consumeArtifacts'),
      close: record('close'), status: record('status'), createEvent: record('createEvent'), backfillReview: record('backfillReview'),
      reconcileReview: record('reconcileReview'), importLegacy: record('importLegacy'),
    };
  }

  test('ReviewCommandUseCase dispatches approval path to mocked port', async () => {
    const calls: Array<{ operation: string; args: string[] }> = [];
    await new ReviewCommandUseCase(mockedPort(calls)).execute(['task-2332.14', '--submit-review', 'approve']);
    assert.deepEqual(calls, [{ operation: 'submitReview', args: ['task-2332.14', '--submit-review', 'approve'] }]);
  });

  test('ReviewCommandUseCase dispatches requested-changes path to mocked port', async () => {
    const calls: Array<{ operation: string; args: string[] }> = [];
    await new ReviewCommandUseCase(mockedPort(calls)).execute(['task-2332.14', '--submit-review', 'request-changes']);
    assert.equal(calls[0].operation, 'submitReview');
    assert.ok(calls[0].args.includes('request-changes'));
  });

  test('ReviewCommandUseCase delegates Forgejo-unavailable submit handling to mocked port', async () => {
    const calls: Array<{ operation: string; args: string[] }> = [];
    const port = mockedPort(calls);
    port.submit = async context => { calls.push({ operation: 'forgejo-unavailable', args: context.args }); };
    await new ReviewCommandUseCase(port).execute(['task-2332.14', '--submit']);
    assert.equal(calls[0].operation, 'forgejo-unavailable');
  });

  test('ReviewCommandUseCase dispatches retry-after-failure continuation to mocked port', async () => {
    const calls: Array<{ operation: string; args: string[] }> = [];
    await new ReviewCommandUseCase(mockedPort(calls)).execute(['task-2332.14', '--continue', '--max-attempts', '2']);
    assert.deepEqual(calls.map(call => call.operation), ['continue']);
  });

  test('ReviewCommandUseCase preserves reviewer selection on mocked start path', async () => {
    const calls: Array<{ operation: string; args: string[] }> = [];
    await new ReviewCommandUseCase(mockedPort(calls)).execute(['task-2332.14', '--start', '--reviewer', 'codex']);
    assert.equal(calls[0].operation, 'start');
    assert.deepEqual(calls[0].args.slice(-2), ['--reviewer', 'codex']);
  });
});
