/**
 * Typed Mission write verbs.
 *
 * One command per domain concept, every argument a typed flag. There is no JSON
 * request blob and no generic patch: `px goal set` writes the brief's goal and
 * reason, `px scope set` bounds it, `px gate add` declares one gate. A caller
 * that wants to change two concepts runs two commands, each validated by its
 * own domain rule.
 *
 * The slug is inferred from the branch or worktree; `--slug` is only needed
 * outside the mission worktree. Every write takes `--expected-version`, whose
 * value comes from `px status --json`, so a stale write is rejected instead of
 * silently winning.
 */

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
  capability: 'mission:context' | 'checkpoint:record' = 'mission:context',
) {
  const slug = resolveSlug(flag(args, '--slug') ?? undefined);
  if (!slug) { fail('no mission slug: run inside the mission worktree or pass --slug <slug>'); }
  const raw = flag(args, '--expected-version');
  if (raw === null) { fail('--expected-version <n> is required; read it from `px status --json`'); }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) { fail('--expected-version must be a positive integer'); }
  return {
    operationId: `px-${operation}-${slug}`,
    missionId: missionId(slug),
    expectedVersion: missionVersion(parsed),
    capabilities: new Set([capability]),
  };
}


/** Fail on the application outcome rather than letting a failure read as success. */
function unwrap<T>(outcome: { status: string; error?: { message?: string }; value?: T }, what: string): T {
  if (outcome.status !== 'completed') { fail(outcome.error?.message ?? `${what} failed`); }
  return outcome.value as T;
}

export const GOAL_HELP = `
Usage: px goal set [--slug <slug>] --goal <text> --why <text> --expected-version <n>

Set the Mission's goal and why. Both are required together: a goal with no
stated reason is not a brief. This is also the first write for a Mission that
has no brief yet; \`px scope set\` refines one that exists.
`.trimStart();

export const SCOPE_HELP = `
Usage: px scope set [--slug <slug>] --scope <text> [--out-of-scope <text> ...] --expected-version <n>

Bound a Mission that already has a goal: --scope is what it covers and each
--out-of-scope is something it deliberately leaves alone. Passing no
--out-of-scope clears the recorded entries; repeat the flag for each one.
`.trimStart();

export const GATE_HELP = `
Usage:
  px gate add    [--slug <slug>] --command <command> --expected-version <n>
  px gate remove [--slug <slug>] --command <command> --expected-version <n>

Add or remove one declared verification gate. The command must be the exact
runnable command; read the current gates back with \`px status --json\`.
`.trimStart();

export const CRITERION_HELP = `
Usage:
  px criterion add    [--slug <slug>] --text <criterion> --expected-version <n>
  px criterion remove [--slug <slug>] --text <criterion> --expected-version <n>

Add or remove one success criterion: something that must be true for the
Mission to be done, specific enough to check. Checkpoint Goal Check rows and
review verify against these; read them back with \`px status\`.
`.trimStart();

export const DEPENDS_HELP = `
Usage:
  px depends add    [--slug <slug>] --on <slug> --expected-version <n>
  px depends remove [--slug <slug>] --on <slug> --expected-version <n>

Record or drop one Mission-to-Mission dependency: \`--on\` is the Mission this
one depends on, and it must already be a Mission. A self-reference and a
duplicate are refused. Nothing enforces a dependency — no lifecycle,
activation or scheduling rule reads it — so it is recorded for whoever reads
\`px status\` next.
`.trimStart();

export const NEL_HELP = `
Usage: px nel set [--slug <slug>] --predicted <Small|Medium|Large> --expected-version <n>

Record the draft's predicted net-engineering-lines bucket: Small (0-80),
Medium (81-235) or Large (235+). Handoff compares it with the measured bucket.
`.trimStart();

export const CHECKPOINT_HELP = `
Usage: px checkpoint plan   [--slug <slug>] --name <CP-N> --text <what it delivers> --expected-version <n>
       px checkpoint unplan [--slug <slug>] --name <CP-N> --expected-version <n>
       px checkpoint record [--slug <slug>] --name <CP-N> --next <text>
                            --criterion <text> --evidence <text> [--criterion ... --evidence ...]
                            --expected-version <n>

A checkpoint is planned at draft and evidenced during execution. \`plan\` adds
one with no evidence yet; \`unplan\` drops one that still has none. \`record\`
writes a checkpoint's Goal Check evidence as durable Mission state, replacing
the planned entry of the same --name (or earlier evidence for it) and keeping
what it was planned to deliver. --criterion and --evidence are repeatable and
pair up in the order given, so the counts must match. \`px status\` shows which
checkpoints have evidence; the first without is where a relaunched agent
resumes.
`.trimStart();

export const REPRO_HELP = `
Usage: px repro set [--slug <slug>] --test <path> --expected-version <n>
       px repro clear [--slug <slug>] --expected-version <n>

Record the red-to-green reproduction test a bug mission declares, so a reviewer
reads it from \`px status\` instead of a line in a mission document. Recording a
path says which test it is; it does not assert that the test has run.
`.trimStart();

export const ASSIGN_HELP = `
Usage:
  px assign   [--slug <slug>] --agent <family> --expected-version <n>
  px unassign [--slug <slug>] --expected-version <n>

Set or clear the Mission's assignee.
`.trimStart();

function helped(args: readonly string[], help: string): boolean {
  if (args.includes('--help') || args.includes('-h')) { fmt.log.plain(help); return true; }
  return false;
}

/** `px goal set` */
export function createGoalCommand(services: MissionWriteServices) {
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

/** `px gate add|remove` — one gate per call, so no list is ever silently replaced. */
export function createGateCommand(services: MissionWriteServices) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, GATE_HELP)) { return; }
    const action = args[0];
    if (action !== 'add' && action !== 'remove') { fail(GATE_HELP); }
    const command = required(args, '--command');
    const req = request(args, `gate-${action}`, services.resolveSlug);
    const current = unwrap(await services.brief.readGates(req), 'gate read').declaredGates;
    if (action === 'remove' && !current.includes(command)) { fail(`gate is not declared: ${command}`); }
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

/**
 * `px checkpoint record`. TASK-2482 removed an earlier `px checkpoint` because
 * it was unused and could be mistaken for verification. It returns here as the
 * agent's only durable evidence path once the workflow files are retired, and
 * it records evidence only — it runs no gate and asserts no verification.
 */
export function createCheckpointCommand(services: MissionCheckpointService, resolveSlug: (_explicit?: string) => string | null) {
  return async (args: string[] = []): Promise<void> => {
    if (helped(args, CHECKPOINT_HELP)) { return; }
    if (args[0] === 'plan' || args[0] === 'unplan') {
      const req = request(args, `checkpoint-${args[0]}`, resolveSlug);
      const name = required(args, '--name');
      const outcome = args[0] === 'plan'
        ? await services.plan({ ...req, name, description: required(args, '--text') })
        : await services.unplan({ ...req, name });
      output(unwrap(outcome, `checkpoint ${args[0]}`));
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
    const goalCheck: GoalCheckRow[] = criteria.map((criterion, index) => ({
      criterion, evidence: evidence[index] as string,
    }));
    const outcome = await services.record({
      ...req,
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
