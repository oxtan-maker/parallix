// Repository-configured lifecycle gates.
//
// Generic, language-neutral gate execution for the pre-handoff, pre-review,
// and pre-integration phases. Gates are declared per repository in
// `workflow.config.json` under `adapters.gates`; they are disabled by default,
// so a repository that does not declare them runs no lifecycle gate.
//
// This module intentionally knows nothing about Node, npm, tsx,
// `scripts/verify-local.sh`, or any Parallix directory layout. It runs the
// configured shell commands from the supplied checkout with a fixed environment
// contract. The selection policy ("which gates run") is owned by the
// repository configuration, never inferred from the repository layout.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as fmt from '../../application/presentation/cli-format.js';
import { loadEffectiveConfig } from './product-config.js';

/** Ordered lifecycle phases that may carry configured gates. */
export const GATE_PHASES = ['handoff', 'review', 'integration'] as const;
export type GatePhase = (typeof GATE_PHASES)[number];

/** Environment keys shared by every configured gate command. */
export const GATE_ENV = {
  SLUG: 'PARALLIX_MISSION_SLUG',
  CHECKOUT: 'PARALLIX_CHECKOUT_PATH',
  PHASE: 'PARALLIX_PHASE',
} as const;

/** A single ordered gate command for one phase. */
export interface RepositoryGate {
  key: string;
  command: string;
  order: number;
}

/** The complete declared gate surface for a repository. */
export interface RepositoryGates {
  preHandoff: RepositoryGate[];
  preReview: RepositoryGate[];
  preIntegration: RepositoryGate[];
}

const EMPTY_GATES: RepositoryGates = {
  preHandoff: [],
  preReview: [],
  preIntegration: [],
};

/**
 * Read the declared gates for a single phase from the effective workflow
 * configuration. Omitted configuration yields an empty list, so an
 * unconfigured repository runs no gate for that phase.
 */
/** @param {'preHandoff'|'preReview'|'preIntegration'} phase */
export function loadPhaseGates(rootDir: string, phase: 'preHandoff' | 'preReview' | 'preIntegration'): RepositoryGate[] {
  const config = loadEffectiveConfig(rootDir || process.cwd());
  const gates = (config.adapters as any)?.gates;
  if (!gates || typeof gates !== 'object' || !Array.isArray(gates[phase])) {
    return [];
  }
  return normalizeGates(gates[phase]);
}

/**
 * Whether the repository opts into the TASK-2300 mandatory-gate invariant at
 * the integration boundary. Defaults to false so an unconfigured repository
 * completes the integration path with no lifecycle gate (mission task-2457
 * success criterion 1). A repository that wants fail-closed sets
 * `adapters.gates.requirePreIntegration: true` in its workflow.config.json.
 */
export function loadRequirePreIntegration(rootDir: string): boolean {
  const config = loadEffectiveConfig(rootDir || process.cwd());
  const gates = (config.adapters as any)?.gates;
  return typeof gates === 'object' && gates !== null && gates.requirePreIntegration === true;
}

/** Load all three phase gate lists at once. */
export function loadRepositoryGates(rootDir: string): RepositoryGates {
  const config = loadEffectiveConfig(rootDir || process.cwd());
  const gates = (config.adapters as any)?.gates;
  if (!gates || typeof gates !== 'object') {
    return { ...EMPTY_GATES };
  }
  return {
    preHandoff: Array.isArray(gates.preHandoff) ? normalizeGates(gates.preHandoff) : [],
    preReview: Array.isArray(gates.preReview) ? normalizeGates(gates.preReview) : [],
    preIntegration: Array.isArray(gates.preIntegration) ? normalizeGates(gates.preIntegration) : [],
  };
}

/** @param {unknown} raw */
function normalizeGates(raw: unknown): RepositoryGate[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  /** @type {RepositoryGate[]} */
  const gates = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const key = (entry as any).key;
    const command = (entry as any).command;
    if (typeof key !== 'string' || !key) {
      continue;
    }
    if (typeof command !== 'string' || !command.trim()) {
      continue;
    }
    const order = typeof (entry as any).order === 'number' ? (entry as any).order : 0;
    gates.push({ key, command, order });
  }
  return gates.sort((a, b) => a.order - b.order);
}

/**
 * Structural validation for the `adapters.gates` object. Returns a list of
 * human-readable issues; an empty list means the shape is acceptable.
 * @param {unknown} adapters
 */
export function validateRepositoryGates(adapters: unknown): string[] {
  const issues: string[] = [];
  if (!adapters || typeof adapters !== 'object') {
    return issues;
  }
  const gates = (adapters as any).gates;
  if (gates === undefined) {
    return issues;
  }
  if (typeof gates !== 'object' || Array.isArray(gates)) {
    return ['adapters.gates must be an object'];
  }
  // adapters.gates declares additionalProperties:false in the workflow schema;
  // reject any key it does not recognise so a typo (e.g. requireIntegration)
  // fails validation instead of silently disappearing.
  const KNOWN_GATE_KEYS = new Set(['requirePreIntegration', 'preHandoff', 'preReview', 'preIntegration']);
  for (const key of Object.keys(gates)) {
    if (!KNOWN_GATE_KEYS.has(key)) {
      issues.push(`adapters.gates.${key} is not a recognised key (allowed: ${[...KNOWN_GATE_KEYS].join(', ')})`);
    }
  }
  if (gates.requirePreIntegration !== undefined && typeof gates.requirePreIntegration !== 'boolean') {
    issues.push('adapters.gates.requirePreIntegration must be a boolean');
  }
  const PHASE_LABELS = {
    preHandoff: 'pre-handoff',
    preReview: 'pre-review',
    preIntegration: 'pre-integration',
  } as const;
  for (const [phase, expected] of Object.entries(PHASE_LABELS)) {
    const value = gates[phase];
    if (value === undefined) {
      continue;
    }
    if (!Array.isArray(value)) {
      issues.push(`adapters.gates.${phase} must be an array (${expected} gates)`);
      continue;
    }
    value.forEach((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        issues.push(`adapters.gates.${phase}[${index}] must be an object`);
        return;
      }
      if (typeof entry.key !== 'string' || !entry.key) {
        issues.push(`adapters.gates.${phase}[${index}].key must be a non-empty string`);
      }
      if (typeof entry.command !== 'string' || !entry.command.trim()) {
        issues.push(`adapters.gates.${phase}[${index}].command must be a non-empty string`);
      }
      if (entry.order !== undefined && typeof entry.order !== 'number') {
        issues.push(`adapters.gates.${phase}[${index}].order must be a number`);
      }
    });
  }
  return issues;
}

/** Result of running a configured gate. */
export interface GateRunOutcome {
  key: string;
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Result of running a phase's gates. */
export interface PhaseGateRunResult {
  /** True when every configured gate passed (or no gates were configured). */
  ok: boolean;
  phase: GatePhase;
  /** Gates that were configured for this phase. */
  gates: RepositoryGate[];
  /** Number of gates actually executed. */
  executed: number;
  /** True when no gates were configured (nothing ran). */
  skipped: boolean;
  /** True when the run was a plan-only dry run that executed nothing. */
  dryRun: boolean;
  /** The first failing gate, if any. */
  failedGate: GateRunOutcome | null;
  error: string | null;
}

/** Injectable command runner. Mirrors `spawnSync` return shape. */
export type GateCommandRunner = (
  _command: string,
  _args: string[],
  _options: { cwd: string, env: NodeJS.ProcessEnv, stdio: string },
) => { status: number | null, stdout: string, stderr: string };

/**
 * Build the fixed environment every configured gate receives. The three
 * contract values are the mission slug, the resolved checkout path, and the
 * exact phase identifier. The invoking process environment is inherited so the
 * command can find its own toolchain.
 *
 * `BASH_ENV` is scrubbed: the runner invokes `bash -c`, which honours it for
 * non-interactive shells, so an inherited startup hook could otherwise alter
 * `PATH` or the gate result. The removed node driver in `scripts/verify-local.sh`
 * did the same delete (TASK-2300 hardening).
 *
 * Inherited `PARALLIX_REAL_AGENT` / `PARALLIX_REAL_AGENT_MODEL` are deleted
 * first, then set only when both a real agent and its model are supplied. The
 * removed driver did the same scrub-and-set (F10): leaving an inherited value
 * unscrubbed would make the `agent-smoke` gate run against an ambient
 * `PARALLIX_REAL_AGENT=codex` from an earlier session.
 */
/** @param {GatePhase} phase @param {string} slug @param {string} checkoutPath */
export function buildGateEnv(phase: GatePhase, slug: string, checkoutPath: string, inheritEnv: NodeJS.ProcessEnv = process.env, extraEnv: { realAgent?: string | null, realAgentModel?: string | null } = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...inheritEnv,
    [GATE_ENV.SLUG]: slug,
    [GATE_ENV.CHECKOUT]: path.resolve(checkoutPath),
    [GATE_ENV.PHASE]: phase,
  };
  delete env['BASH_ENV'];
  delete env['PARALLIX_REAL_AGENT'];
  delete env['PARALLIX_REAL_AGENT_MODEL'];
  if (extraEnv.realAgent && extraEnv.realAgentModel) {
    env['PARALLIX_REAL_AGENT'] = extraEnv.realAgent;
    env['PARALLIX_REAL_AGENT_MODEL'] = extraEnv.realAgentModel;
  }
  return env;
}

/**
 * Run a phase's configured gates from the supplied checkout. Gates execute in
 * declared order; the first non-zero exit aborts and is reported. An empty
 * gate list (unconfigured phase) is a successful no-op and never invokes the
 * command runner.
 */
/**
 * @param {GatePhase} phase
 * @param {{slug: string, checkoutPath: string, gates?: RepositoryGate[], commandRunner?: GateCommandRunner, log?: Function, error?: Function}} opts
 */
export async function runPhaseGates(
  phase: GatePhase,
  opts: {
    slug: string;
    checkoutPath: string;
    gates?: RepositoryGate[];
    commandRunner?: GateCommandRunner;
    log?: Function;
    error?: Function;
    /** Plan-only: resolve and print the gate list without executing it. */
    dryRun?: boolean;
    /** Optional self-development integration agent selection (F4 / TASK-2269). */
    realAgent?: string | null;
    realAgentModel?: string | null;
  },
): Promise<PhaseGateRunResult> {
  const { slug, checkoutPath } = opts;
  const gates = opts.gates ?? loadPhaseGates(checkoutPath, toConfigPhase(phase));
  const log = opts.log || fmt.log.plain;
  const error = opts.error || fmt.log.plainError;
  const dryRun = opts.dryRun === true;

  // Plan-only dry run: resolve and print the gate list, execute nothing.
  // `px integrate --dry-run` previously short-circuited here; this restores
  // that boundary now that the generic runner owns the live path (F3).
  if (dryRun) {
    if (gates.length === 0) {
      log(`Repository gates (${phase}): none configured — dry run, nothing to plan.`);
    } else {
      log(`Repository gates (${phase}): dry run — resolved plan (nothing executes):`);
      for (const gate of gates) { log(`  [${gate.order}] ${gate.key}: ${gate.command}`); }
    }
    return { ok: true, phase, gates, executed: 0, skipped: true, dryRun: true, failedGate: null, error: null };
  }

  if (gates.length === 0) {
    log(`Repository gates (${phase}): none configured — skipping.`);
    return { ok: true, phase, gates: [], executed: 0, skipped: true, dryRun: false, failedGate: null, error: null };
  }

  // Execute through `bash -c`, the same shell mechanism the handoff declared
  // gate runner and the integration gate use, so configured commands may be
  // arbitrary shell (pipelines, redirects, `./scripts/...`), not just bare
  // executables. No new runner or shell language is introduced. The default
  // runner streams live output (stdio inherit) so long gates (builds, test
  // suites) show progress; a large maxBuffer guards any captured path from
  // spawnSync's 1 MiB default, which otherwise kills the child with ENOBUFS
  // and reports an unexplained `unknown` exit code (F2).
  const runner = opts.commandRunner || ((command: string, _args: string[], runOpts: { cwd: string, env: NodeJS.ProcessEnv, stdio: string }) =>
    spawnSync('bash', ['-c', command], { cwd: runOpts.cwd, env: runOpts.env, stdio: 'inherit', maxBuffer: 256 * 1024 * 1024 }));
  const env = buildGateEnv(phase, slug, checkoutPath, process.env, { realAgent: opts.realAgent, realAgentModel: opts.realAgentModel });

  let failedGate: GateRunOutcome | null = null;
  let errorText: string | null = null;
  let executed = 0;

  for (const gate of gates) {
    log(`Repository gate (${phase}): running ${gate.key}...`);
    log(`  Command: ${gate.command}`);
    log(`  Checkout: ${path.resolve(checkoutPath)}`);
    const result = runner(gate.command, [], {
      cwd: path.resolve(checkoutPath),
      env,
      stdio: 'inherit',
    });
    executed++;
    const exitCode = typeof result.status === 'number' ? result.status : null;
    const stdout = String(result.stdout || '');
    const stderr = String(result.stderr || '');

    if (exitCode !== 0) {
      failedGate = { key: gate.key, command: gate.command, exitCode, stdout, stderr };
      errorText = `Repository gate "${gate.key}" exited with code ${exitCode ?? 'unknown'} for ${phase}.`;
      error(errorText);
      // Echo both streams on failure: a test runner that reports failures on
      // stdout would otherwise produce a gate failure with no diagnostic.
      if (stderr) { error(stderr); }
      if (stdout) { error(stdout); }
      break;
    }

    log(`Repository gate (${phase}): ${gate.key} passed.`);
  }

  return {
    ok: failedGate === null,
    phase,
    gates,
    executed,
    skipped: false,
    dryRun: false,
    failedGate,
    error: errorText,
  };
}

/** @param {GatePhase} phase */
function toConfigPhase(phase: GatePhase): 'preHandoff' | 'preReview' | 'preIntegration' {
  return `pre${phase.charAt(0).toUpperCase() + phase.slice(1)}` as any;
}
