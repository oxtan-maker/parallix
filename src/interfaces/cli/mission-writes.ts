/**
 * Typed Mission write verbs.
 *
 * Typed flags author the complete draft atomically with mission author, or edit
 * individual concepts with the existing single-mutation commands.
 *
 * The slug is inferred from the branch or worktree; `--slug` is only needed
 * outside the mission worktree. Every write accepts an otherwise valid
 * invocation without `--expected-version`: when the flag is omitted the command
 * resolves the current stored version itself and the store's compare-and-swap
 * save still refuses a competing write, so a stale write changes nothing
 * without a preceding `px status` read. Supplying `--expected-version` keeps
 * the earlier explicit guard. Classification set is a second command that
 * never takes the flag at all.
 */

import { AUTHOR_HELP, parseMissionAuthoring } from './mission-authoring.js';
import * as fmt from '../../application/presentation/cli-format.js';
import type { MissionCheckpointService } from '../../application/mission-checkpoint-service.js';
import type { MissionBriefService } from '../../application/mission-brief-service.js';
import type { MissionAssignmentService } from '../../application/mission-assignment-service.js';
import { missionId } from '../../domain/mission.js';
import { agentFamily } from '../../domain/agents.js';
import { missionVersion } from '../../application/domain-ports.js';
import type { GoalCheckRow } from '../../domain/checkpoint.js';

export interface MissionWriteServices {
  readonly brief: MissionBriefService;
  readonly checkpoints: MissionCheckpointService;
  readonly assignment: MissionAssignmentService;
  /**
   * Resolves `--slug`, or infers it from the branch/worktree when omitted.
   * Injected so this interface module never reaches into an adapter.
   */
  readonly resolveSlug: (_explicit?: string) => string | null;
}

/** Last value for a flag, or null. */
function flag(args: readonly string[], name: string): string | null {
  const index = args.lastIndexOf(name);
  return index < 0 ? null : args[index + 1] ?? null;
}

/** Every value for a repeatable flag, in the order given. */
function flags(args: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (const [index, arg] of args.entries()) {
    if (arg === name) {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) { fail(`${name} needs a value`); }
      values.push(value);
    }
  }
  return values;
}

function fail(message: string): never { throw new Error(message); }
function requireOperator(direct: boolean): void {
  if (!direct) { fail('Checkpoint correction requires a direct operator invocation'); }
}

function required(args: readonly string[], name: string): string {
  const value = flag(args, name);
  if (value === null || value.startsWith('--')) { fail(`${name} <value> is required`); }
  return value;
}

function output(value: unknown): void { fmt.log.plain(JSON.stringify(value, null, 2)); }

/**
 * Shared request preamble: slug resolution plus the mandatory version. Each
 * command grants only the capability its service checks, so a checkpoint write
 * cannot pass as a brief write or the reverse.
 */
function request(
  args: readonly string[],
  operation: string,
  resolveSlug: (_explicit?: string) => string | null,
  capability: 'mission:context' | 'checkpoint:record' | 'checkpoint:correct' = 'mission:context',
) {
  const slug = resolveSlug(flag(args, '--slug') ?? undefined);
  if (!slug) { fail('no mission slug: run inside the mission worktree or pass --slug <slug>'); }
  // `--expected-version` is optional. When omitted, `expectedVersion` is left
  // undefined so `loadForCommand` skips its pre-check and the command writes
  // against the revision it just loaded; the store's compare-and-swap save then
  // refuses a competing write, so a stale write still changes nothing. Supplying
  // the flag keeps the earlier explicit guard and validation. A present flag
  // with no value is a malformed pin and is refused, never an automatic write.
  const expectedVersion = (() => {
    if (!args.includes('--expected-version')) { return undefined; }
    const raw = flag(args, '--expected-version');
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 1) { fail('--expected-version must be a positive integer'); }
    return missionVersion(parsed);
  })();
  return {
    operationId: `px-${operation}-${slug}`,
    missionId: missionId(slug),
    expectedVersion,
    capabilities: new Set([capability]),
  };
}


/** Fail on the application outcome rather than letting a failure read as success. */
function unwrap<T>(outcome: { status: string; error?: { message?: string }; value?: T }, what: string): T {
  if (outcome.status !== 'completed') { fail(outcome.error?.message ?? `${what} failed`); }
  return outcome.value as T;
}

export const GOAL_HELP = `
Usage: px goal set [--slug <slug>] --goal <text> --why <text>

Set the Mission's goal and why. Both are required together: a goal with no
stated reason is not a brief. This is also the first write for a Mission that
has no brief yet; \`px scope set\` refines one that exists.
`.trimStart();

export const SCOPE_HELP = `
Usage: px scope set [--slug <slug>] --scope <text> [--out-of-scope <text> ...]

Bound a Mission that already has a goal: --scope is what it covers and each
--out-of-scope is something it deliberately leaves alone. Passing no
--out-of-scope clears the recorded entries; repeat the flag for each one.
`.trimStart();

export const GATE_HELP = `
Usage:
  px gate add    [--slug <slug>] --command <command>
  px gate remove [--slug <slug>] --command <command>

Add or remove one declared verification gate. The command must be the exact
runnable command; read the current gates back with \`px status --json\`.
`.trimStart();

export const CRITERION_HELP = `
Usage:
  px criterion add    [--slug <slug>] --text <criterion>
  px criterion remove [--slug <slug>] --text <criterion>

Add or remove one success criterion: something that must be true for the
Mission to be done, specific enough to check. Checkpoint Goal Check rows and
review verify against these; read them back with \`px status\`.
`.trimStart();

export const MISSION_HELP = `
Usage:${AUTHOR_HELP}
  px mission mark-complete [--slug <slug>] (--criterion <n> | --all)

Mark one success criterion, by the index \`px status\` lists it with, or every
criterion complete. Handoff requires every criterion complete and evidenced by
a verifiable Goal Check row in the final checkpoint.
`.trimStart();

export const DEPENDS_HELP = `
Usage:
  px depends add    [--slug <slug>] --on <slug>
  px depends remove [--slug <slug>] --on <slug>

Record or drop one Mission-to-Mission dependency: \`--on\` is the Mission this
one depends on, and it must already be a Mission. A self-reference and a
duplicate are refused. Nothing enforces a dependency — no lifecycle,
activation or scheduling rule reads it — so it is recorded for whoever reads
\`px status\` next.
`.trimStart();

export const NEL_HELP = `
Usage: px nel set [--slug <slug>] --predicted <Small|Medium|Large>

Record the draft's predicted net-engineering-lines bucket: Small (0-80),
Medium (81-235) or Large (235+). Handoff compares it with the measured bucket.
`.trimStart();

export const CHECKPOINT_HELP = `
Usage: px checkpoint check  [--slug <slug>] [--json]
       px checkpoint plan   [--slug <slug>] --name <CP-N> --text <what it delivers>
       px checkpoint history [--slug <slug>] [--name <CP-N>]
       px checkpoint round   [--slug <slug>] --round <n>
       px checkpoint read    [--slug <slug>] [--name <CP-N>]
       px checkpoint unplan [--slug <slug>] --name <CP-N>
       px checkpoint record [--slug <slug>] --name <CP-N> --next <text>
                            --criterion <text> --evidence <text> [--criterion ... --evidence ...]
                            [--force]

Correct a false or resolved blocker, or reconcile legacy corrected criteria:
  px checkpoint correct-invalid-contract --name <CP-N> --operator <name>
    --decision <explicit correction> --evidence <verifiable reference>

Report an invalid locked contract: px checkpoint report-invalid-contract --name <CP-N>
  --command <exact failing command> --diagnostic <text> --authority-reason <text>
  --proposed-correction <text>

A checkpoint is planned at draft and evidenced during execution. \`plan\` adds
one with no evidence yet; \`unplan\` drops one that still has none. \`record\`
appends an immutable version of a checkpoint's Goal Check evidence, replacing
the planned entry of the same --name (or earlier evidence for it) and keeping
what it was planned to deliver. --criterion and --evidence are repeatable and
pair up in the order given, so the counts must match. Each row must cite a
repository-relative path, a quoted test name, a recognized command or an ADR,
and the final planned checkpoint needs one row per success criterion; handoff
applies the same checks. \`px status\` shows which checkpoints have evidence;
the first without is where a relaunched agent resumes. A direct operator may
use \`correct-invalid-contract\` with their identity, decision and a verifiable
reference; retained correction history also permits reconciling stale criteria
authority without a blocker, provided required checks are unchanged. Already-current
replays are refused. Nested or automatic invocations cannot correct a blocker. The write
checks the current Mission version and retains every original blocker and
correction in \`checkpoint read\` and \`status --json\`. It supplies no Goal Check
rows, completion or verification, so unfinished checkpoints and repair checks
remain required. An operator may also use
\`record --force\` to clear a reported invalid-contract blocker while recording
corrected evidence. It retains unrelated proof and still validates evidence and
the write version; it does not mark the repair verified or skip its required check.

Read-only \`check\` reports evidence readiness as JSON: ready, version, findings,
primaryStopReason and nextCommands. It lists all missing checkpoints, incomplete
and uncovered criteria, invalid references and stale repair rows. A recorded
human-only contract blocker takes priority: stop for an operator even if evidence
is incomplete. Check never runs gates, publishes, writes evidence or clears a
blocker. Exit 0 means the read succeeded; inspect ready before declaring completion.
Read-only \`history\` shows all versions (optionally by name), \`round --round <n>\`
replays the exact checkpoint state at review start, and \`read\` shows latest state.
Round replay includes criterion IDs and text at review start, plus uncovered IDs.
Criterion IDs are backend-allocated and survive text edits; legacy unmatched
evidence has a null criterion ID. Earlier round-time criteria remain unknown.
Versions include recording time, recording review round (null before review),
and Mission aggregate revision. Legacy recording metadata is null; known row
rounds remain intact. Legacy round snapshots were not captured and are reported
as unknown. Missing rounds are reported separately. These reads never mutate state.
`.trimStart();

export const REPRO_HELP = `
Usage: px repro set [--slug <slug>] --test <path>
       px repro clear [--slug <slug>]

Record the red-to-green reproduction test a bug mission declares, so a reviewer
reads it from \`px status\` instead of a line in a mission document. Recording a
path says which test it is; it does not assert that the test has run.
`.trimStart();
export const CLASSIFICATION_HELP = `
Usage: px classification set [--slug <slug>] --value <ai_sdlc|user_value|unknown>

Set the Mission-owned classification without editing a provider task. Exactly one
classification is retained and unrelated labels are preserved. No --expected-version:
the current version is discovered from stored mission state for the write.
`.trimStart();

export const ASSIGN_HELP = `
Usage:
  px assign   [--slug <slug>] --agent <family>
  px unassign [--slug <slug>]

Set or clear the Mission's assignee.
`.trimStart();

function helped(args: readonly string[], help: string): boolean {
  if (args.includes('--help') || args.includes('-h')) { fmt.log.plain(help); return true; }
  return false;
}

/** `px goal set` */
export function createGoalCommand(services: Pick<MissionWriteServices, 'resolveSlug'> & { brief: Pick<MissionBriefService, 'update'> }) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, GOAL_HELP)) { return; }
    if (args[0] !== 'set') { fail(GOAL_HELP); }
    const req = request(args, 'goal-set', services.resolveSlug);
    const outcome = await services.brief.update({ ...req, patch: { goal: required(args, '--goal'), why: required(args, '--why') } });
    output(unwrap(outcome, 'goal set'));
  };
}

/** `px scope set` */
export function createScopeCommand(services: MissionWriteServices) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, SCOPE_HELP)) { return; }
    if (args[0] !== 'set') { fail(SCOPE_HELP); }
    const req = request(args, 'scope-set', services.resolveSlug);
    const outcome = await services.brief.update({ ...req, patch: { scope: required(args, '--scope'), outOfScope: flags(args, '--out-of-scope') } });
    output(unwrap(outcome, 'scope set'));
  };
}

/**
 * `px gate add|remove` — one gate per call, so no list is ever silently replaced.
 * `validateGate` returns why a command cannot run as a gate, or null. Handoff
 * runs each recorded gate with `bash -c`, so a gate is refused here, while the
 * drafting agent can still fix it, rather than only when handoff runs it.
 */
export function createGateCommand(services: Pick<MissionWriteServices, 'resolveSlug'> & { brief: Pick<MissionBriefService, 'readGates' | 'setGates'> }, validateGate: (_command: string) => string | null = () => null) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, GATE_HELP)) { return; }
    const action = args[0];
    if (action !== 'add' && action !== 'remove') { fail(GATE_HELP); }
    const command = required(args, '--command');
    const req = request(args, `gate-${action}`, services.resolveSlug);
    const current = unwrap(await services.brief.readGates(req), 'gate read').declaredGates;
    if (action === 'remove' && !current.includes(command)) { fail(`gate is not declared: ${command}`); }
    const invalid = action === 'add' ? validateGate(command) : null;
    if (invalid) { fail(invalid); }
    // `add` of an already-declared gate is rejected by the domain, so the
    // duplicate rule lives in one place rather than being restated here.
    const gates = action === 'add' ? [...current, command] : current.filter((gate) => gate !== command);
    output(unwrap(await services.brief.setGates({ ...req, gates }), `gate ${action}`));
  };
}

/** `px criterion add|remove` — one criterion per call, like `px gate`. */
export function createCriterionCommand(services: MissionWriteServices) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, CRITERION_HELP)) { return; }
    const action = args[0];
    if (action !== 'add' && action !== 'remove') { fail(CRITERION_HELP); }
    const text = required(args, '--text');
    const req = request(args, `criterion-${action}`, services.resolveSlug);
    const current = unwrap(await services.brief.readSuccessCriteria(req), 'criteria read').successCriteria;
    if (action === 'remove' && !current.includes(text)) { fail(`success criterion is not recorded: ${text}`); }
    // A duplicate `add` is rejected by the domain, as for gates.
    const criteria = action === 'add' ? [...current, text] : current.filter((entry) => entry !== text);
    output(unwrap(await services.brief.setSuccessCriteria({ ...req, criteria }), `criterion ${action}`));
  };
}

/** `px mission mark-complete (--criterion <n> | --all)` */
export function createMissionCommand(services: Pick<MissionWriteServices, 'resolveSlug'> & { brief: Pick<MissionBriefService, 'author' | 'markSuccessCriteriaComplete'> }, validateGate: (_command: string) => string | null = () => null) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, MISSION_HELP)) { return; }
    if (args[0] === 'author') {
      const fields = parseMissionAuthoring(args, validateGate);
      const req = request(args, 'mission-author', services.resolveSlug);
      output(unwrap(await services.brief.author({ ...req, ...fields }), 'mission author'));
      return;
    }
    if (args[0] !== 'mark-complete') { fail(MISSION_HELP); }
    const index = flag(args, '--criterion');
    const all = args.includes('--all');
    if (all === (index !== null)) { fail('give exactly one of --criterion <n> or --all'); }
    const criterion = all ? 'all' : Number(index);
    if (criterion !== 'all' && !/^\d+$/.test(index ?? '')) { fail(`--criterion must be a criterion number, got: ${index}`); }
    const req = request(args, 'mission-mark-complete', services.resolveSlug);
    output(unwrap(await services.brief.markSuccessCriteriaComplete({ ...req, criterion }), 'mark-complete'));
  };
}

/** `px nel set --predicted <bucket>` */
export function createDependsCommand(services: MissionWriteServices) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, DEPENDS_HELP)) { return; }
    const action = args[0];
    if (action !== 'add' && action !== 'remove') { fail(DEPENDS_HELP); }
    const on = required(args, '--on');
    const req = request(args, `depends-${action}`, services.resolveSlug);
    const current = unwrap(await services.brief.readDependencies(req), 'dependencies read').dependencies;
    if (action === 'remove' && !current.includes(missionId(on))) { fail(`mission dependency is not recorded: ${on}`); }
    // A duplicate `add`, a self-reference and an id that is not a Mission are
    // all refused below the CLI: by the domain value and by the service's
    // existence check.
    const dependencies = action === 'add' ? [...current, on] : current.filter((entry) => entry !== on);
    output(unwrap(await services.brief.setDependencies({ ...req, dependencies }), `depends ${action}`));
  };
}

export function createNelCommand(services: MissionWriteServices) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, NEL_HELP)) { return; }
    if (args[0] !== 'set') { fail(NEL_HELP); }
    const bucket = required(args, '--predicted');
    if (bucket !== 'Small' && bucket !== 'Medium' && bucket !== 'Large') { fail('--predicted must be Small, Medium or Large'); }
    const req = request(args, 'nel-set', services.resolveSlug);
    output(unwrap(await services.brief.setPredictedNelBucket({ ...req, bucket }), 'nel set'));
  };
}

/** Read command dispatch shares slug resolution but cannot call a writer. */
async function readCheckpointCommand(services: MissionCheckpointService, resolveSlug: (_explicit?: string) => string | null, args: string[]) {
  const req = request(args, `checkpoint-${args[0]}`, resolveSlug, 'checkpoint:record');
  const name = flag(args, '--name') ?? undefined;
  const outcome = args[0] === 'history' ? await services.history({ ...req, name })
    : args[0] === 'round' ? await services.round({ ...req, round: Number(required(args, '--round')) })
      : await services.read({ ...req, name });
  output(unwrap(outcome, `checkpoint ${args[0]}`));
}

/** Checkpoint reads, planning, evidence writes and explicit operator corrections. */
export function createCheckpointCommand(services: MissionCheckpointService, resolveSlug: (_explicit?: string) => string | null, checkoutRoot?: string, operatorInvocation = false) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, CHECKPOINT_HELP)) { return; }
    if (args[0] === 'check') {
      output(unwrap(await services.check(request(args, 'checkpoint-check', resolveSlug), checkoutRoot), 'checkpoint check'));
      return;
    }
    if (['history', 'round', 'read'].includes(args[0] ?? '')) {
      await readCheckpointCommand(services, resolveSlug, args);
      return;
    }
    if (args[0] === 'plan' || args[0] === 'unplan') {
      const req = request(args, `checkpoint-${args[0]}`, resolveSlug);
      const name = required(args, '--name');
      const outcome = args[0] === 'plan'
        ? await services.plan({ ...req, name, description: required(args, '--text') })
        : await services.unplan({ ...req, name });
      output(unwrap(outcome, `checkpoint ${args[0]}`));
      return;
    }
    if (args[0] === 'correct-invalid-contract') {
      requireOperator(operatorInvocation);
      const req = request(args, 'checkpoint-correct', resolveSlug, 'checkpoint:correct');
      output(unwrap(await services.correctInvalidContract({ ...req, name: required(args, '--name'),
        operator: required(args, '--operator'), decision: required(args, '--decision'), evidence: required(args, '--evidence'),
      }), 'checkpoint correct-invalid-contract'));
      return;
    }
    if (args[0] === 'report-invalid-contract') {
      const req = request(args, 'checkpoint-invalid-contract', resolveSlug, 'checkpoint:record');
      output(unwrap(await services.reportInvalidContract({ ...req, name: required(args, '--name'), blocker: {
        command: required(args, '--command'), diagnostic: required(args, '--diagnostic'),
        authorityReason: required(args, '--authority-reason'), proposedCorrection: required(args, '--proposed-correction'),
      } }), 'checkpoint report-invalid-contract'));
      return;
    }
    if (args[0] !== 'record') { fail(CHECKPOINT_HELP); }
    const criteria = flags(args, '--criterion');
    const evidence = flags(args, '--evidence');
    if (criteria.length === 0) { fail('--criterion <text> is required at least once'); }
    if (criteria.length !== evidence.length) {
      fail(`--criterion and --evidence must pair up: got ${criteria.length} criteria and ${evidence.length} evidence values`);
    }
    const req = request(args, 'checkpoint-record', resolveSlug, 'checkpoint:record');
    if (args.includes('--force')) {
      requireOperator(operatorInvocation);
      req.capabilities.add('checkpoint:correct');
    }
    const goalCheck: GoalCheckRow[] = criteria.map((criterion, index) => ({
      criterion, evidence: evidence[index] as string,
    }));
    const outcome = await services.record({
      ...req,
      force: args.includes('--force'),
      checkpoint: {
        missionId: req.missionId,
        name: required(args, '--name'),
        goalCheck,
        nextActionText: required(args, '--next'),
      },
    });
    const value = unwrap(outcome, 'checkpoint record');
    output({ checkpoint: value.checkpoint, replaced: value.replaced, version: value.version });
  };
}

/** `px repro set|clear` */
export function createReproCommand(services: MissionWriteServices) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, REPRO_HELP)) { return; }
    const action = args[0];
    if (action !== 'set' && action !== 'clear') { fail(REPRO_HELP); }
    const req = request(args, `repro-${action}`, services.resolveSlug);
    const outcome = await services.brief.setReproductionTest({
      ...req,
      testPath: action === 'clear' ? null : required(args, '--test'),
    });
    output(unwrap(outcome, `repro ${action}`));
  };
}

/**
 * `px classification set` — the only write that does not take `--expected-version`.
 *
 * The version is discovered from stored mission state: slug is resolved, the
 * request carries no expectedVersion, and `setClassification` loads the current
 * revision and writes it back through the store's own optimistic-concurrency
 * guard. The flag is dropped from the command, its help, and its call path only;
 * `request()` and every other verb keep their mandatory guard untouched.
 */
export function createClassificationCommand(services: MissionWriteServices) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, CLASSIFICATION_HELP)) { return; }
    if (args[0] !== 'set') { fail(CLASSIFICATION_HELP); }
    const slug = services.resolveSlug(flag(args, '--slug') ?? undefined);
    if (!slug) { fail('no mission slug: run inside the mission worktree or pass --slug <slug>'); }
    const req = {
      operationId: `px-classification-set-${slug}`,
      missionId: missionId(slug),
      capabilities: new Set(['mission:context'] as const),
    };
    output(unwrap(await services.brief.setClassification({ ...req, classification: required(args, '--value') }), 'classification set'));
  };
}

/** `px assign` / `px unassign` */
export function createAssignCommand(services: MissionWriteServices, clear: boolean) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, ASSIGN_HELP)) { return; }
    const req = request(args, clear ? 'unassign' : 'assign', services.resolveSlug);
    const outcome = await services.assignment.set({
      ...req,
      assignee: clear ? null : agentFamily(required(args, '--agent')),
    });
    output(unwrap(outcome, clear ? 'unassign' : 'assign'));
  };
}
