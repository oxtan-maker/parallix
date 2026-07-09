import * as fmt from '../core/fmt.js';
import { isSpuriousCodexExit } from './codex.js';
import { isSpuriousVibeExit } from './vibe.js';
import { isSpuriousOpencodeExit } from './opencode.js';
import { detectLimitHit, formatBlockUntil, DEFAULT_FALLBACK_HOURS } from './limit-hit.js';
import { resolveAgentModel } from '../core/product-config.js';
import { createRequire } from 'node:module';
import {
  CONFIG_PATH,
  readAgentConfig,
  readAgentConfigOrExit,
  parseBlockUntil,
  isAgentBlocked,
  isInvalidAgentConfigError,
  updateAgentBlock,
  resolveBlocklistTargetPath
} from './agent-config.js';
import {
  KNOWN_AGENT_NAMES,
  WORKFLOW_AGENT_NAMES,
  RESUME_CAPABLE,
  LAUNCHERS,
  DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS,
  DRAFT_NO_OUTPUT_INITIAL_DELAY_MS,
  workflowLauncherStatus,
  setCommandPathProbe,
  eligibleAgentsForStep,
  selectAgent,
  assertAgentSupported,
  resolveNoOutputWatchdogConfig
} from './launcher-selection.js';
// Compatibility breadcrumb for tests that inspect compiled agents.js directly:
// RESUME_CAPABLE = new Set(['claude', 'codex', 'custom'])
// tools/sessions is still CJS (not converted in this wave); require keeps it
// untyped (any) without pulling a non-included .js into the typecheck program.
const _require = createRequire(__filename);
const sessions = _require('../tools/sessions');

interface LaunchResultLike {
  stdout?: string;
  stderr?: string;
  status?: number | null;
  signal?: string | null;
  error?: {code?: string, message?: string} | null;
}

interface StartAgentOptions {
  prompt: string | Function;
  worktree?: string;
  agent?: string;
  env?: {[key: string]: string};
  exclude?: any;
  onLimitHit?: Function;
  onLaunch?: Function;
  slug?: string | null;
  role?: string | null;
  detectLimitHitFn?: Function;
  updateAgentBlockFn?: Function;
  selectAgentFn?: Function;
  resolveAgentModelFn?: Function;
  isAgentBlockedFn?: Function;
  sessionsModule?: any;
  log?: Function;
  noOutputWatchdog?: {initialDelayMs?: number, intervalMs?: number} | boolean;
}

const NON_BLOCKING_LAUNCH_ERROR_PATTERNS = Object.freeze([
  /\b(?:invalid|unknown|unsupported|unrecognized)\s+model\b/i,
  /\bmodel\s+(?:identifier|id)\s+(?:is\s+)?invalid\b/i,
  /\b(?:model\s+not\s+found|no\s+such\s+model)\b/i,
  /\bunknown\s+option\b/i,
  /\bunsupported\s+(flag|option)\b/i,
  /\bauth(?:entication)?\b/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\bapi\s+key\b/i,
  /\bread-only file system\b/i,
  /\b(home|bootstrap)\s+(error|failed|cannot|denied|not\s+found)\b/i,
  /\bpermission\s+denied\b/i,
  // (a) websocket / connection failures — transient infrastructure issues
  /failed to connect to websocket/i,
  /\bconnection refused\b/i,
  /\bECONNREFUSED\b/i,
  /\bos error 1\b/i,
  // (b) provider reachability errors — provider endpoints unreachable
  /provider endpoints are unreachable/i,
  /\breachability\b/i,
  /\bendpoint unreachable\b/i,
    // (c) generic os-error / transient runtime failures (non-quota)
    /\bos error \d+\b/i,
    // (d) timeout errors — transient waits exceeded
    /\btimeout\b/i,
    /\btimed\s+out\b/i,
    /\bdeadline\s+exceeded\b/i,
    /\brequest\s+timed\s+out\b/i,
    // (e) sandbox / permission-denial errors that are not auth-related
    /\bsandbox\s+violation\b/i,
    /\bsandbox\s+denied\b/i,
    /\btool\s+call\s+denied\b/i,
    /\baction\s+denied\b/i,
    /\bapproval\s+denied\b/i,
    // (f) provider reachability / connectivity errors not already covered
    /\bEPIPE\b/i,
    /\bETIMEDOUT\b/i,
    /\bENETUNREACH\b/i,
    /\bENOTFOUND\b/i,
    /\bEAI_AGAIN\b/i,
    /\bsocket\s+hang\s+up\b/i,
    /\bfetch\s+failed\b/i,
    /\bservice\s+unavailable\b/i,
    /\bgateway\s+timeout\b/i,
    /\boverloaded\b/i,
    /\btemporarily\s+unavailable\b/i,
    /\bplease\s+try\s+again\b/i,
    /\bretry\s+after\b/i,
    // (g) prompt rejection errors
    /\bprompt\s+rejected\b/i,
    /\bprompt\s+blocked\b/i,
    /\bcontent\s+policy\b/i,
    /\bcontent\s+filter\b/i,
    /\bsafety\s+filter\b/i,
    // (h) invocation argument errors
    /\binvalid\s+argument\b/i,
    /\binvalid\s+option\b/i,
    /\binvalid\s+parameter\b/i,
    /\bmissing\s+required\b/i,
    /\bargument\s+error\b/i,
    // (i) resource exhaustion not rate-limit related
    /\b(out of memory|OOM)\b/i,
    /\bmemory\s+limit\b/i,
    /\bcontext\s+window\s+exceeded\b/i,
    /\btoken\s+limit\s+exceeded\b/i
]);

// Deterministic config/setup errors (invalid model IDs, auth failures,
// unsupported CLI flags, home/bootstrap failures) must not poison the
// persistent blocklist — only transient failures (runtime crashes, network
// errors) deserve a block. Custom agents are never blocked.
function shouldPersistLaunchFailureBlock(agent: string, result: LaunchResultLike | null | undefined) {
  if (!result || agent === 'custom') {return false;}
  const combined = [
    result.stderr || '',
    result.stdout || '',
    result.error?.message || '',
    result.error?.code || ''
  ].join('\n');
  if (!combined.trim()) {return true;}
  return !NON_BLOCKING_LAUNCH_ERROR_PATTERNS.some(pattern => pattern.test(combined));
}

function defaultIsAgentBlockedNow(agent: string) {
  try {
    const config = readAgentConfig(CONFIG_PATH, {});
    return isAgentBlocked(agent, config);
  } catch (_err) {
    // If the config is malformed, surface that through the launcher path
    // (assertAgentSupported / launch) instead of silently rerouting. Treat as
    // not-blocked here so the existing error path runs.
    return false;
  }
}

function formatElapsed(elapsedMs: number) {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) {return `${seconds}s`;}
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

async function startAgent(step: string, opts: StartAgentOptions = { prompt: '' }) {
  const {
    prompt,
    worktree,
    agent: agentOverride,
    env = {},
    exclude = [],
    onLimitHit,
    onLaunch,
    slug = null,
    role = null,
    detectLimitHitFn = detectLimitHit,
    updateAgentBlockFn = updateAgentBlock,
    selectAgentFn = selectAgent,
    resolveAgentModelFn = resolveAgentModel,
    isAgentBlockedFn = defaultIsAgentBlockedNow,
    sessionsModule = sessions,
    log = fmt.log.plain,
    noOutputWatchdog = {}
  } = opts;

  // `exclude` seeds the tried-set so callers can reserve agents (e.g. exclude
  // the current implementer from reviewer fallback to preserve family separation).
  const excludeIterable = exclude instanceof Set ? exclude : exclude;
  const tried = new Set(excludeIterable);
  // Track per-agent failure details for accurate exhaustion diagnostics (SC 3)
  const agentErrors = new Map();
  // Track agents actually launched (not just pre-excluded) for accurate reporting
  const launched = new Set();
  let iteration = 0;
  let chosen = agentOverride;

  while (true) {
    iteration += 1;
    if (!chosen) {
      try {
        chosen = selectAgentFn(step, { exclude: tried });
      } catch (err) {
        // Only catch pool exhaustion errors from selectAgent.
        // Configuration errors (no eligible agents, no working launcher) must
        // propagate unchanged to preserve diagnostics (SC 3).
        // Exhaustion is indicated by:
        // - "exhausted" from real selectAgent pool exhaustion ("are exhausted")
        // - "No agents available" from test mocks simulating exhaustion
        if (!((err as any).message || '').includes('exhausted') &&
          !((err as any).message || '').includes('No agents available')
        ) {
          throw err;
        }
        // Pool exhausted; build clear exhaustion diagnostics with per-agent errors (SC 3)
        const errorDetails = [...agentErrors.entries()].map(([agent, details]) => {
          const status = details.exitInfo === 'stalled'
            ? 'stalled (no output)'
            : (details.status !== undefined && details.status !== null
              ? `exit ${details.status}`
              : (details.signal ? `signal ${details.signal}` : 'unknown'));
          const stderrSnippet = details.stderr ? ` (${details.stderr.trim().split('\n')[0]})` : '';
          return `${agent}: ${status}${stderrSnippet}`;
        }).join('; ');
        const launchedList = [...launched].join(', ');
        throw new Error(
          `All eligible agents exhausted for step "${step}". ` +
          `Tried: ${launchedList}. Errors: ${errorDetails}.`
        );
      }
    } else if (isAgentBlockedFn(chosen)) {
      // Pre-launch blocklist gate. An explicit `agent:` override (e.g. a pinned
      // reviewer/implementer carried over from review-state.json) bypasses
      // selectAgent's blocklist filter. Without this check, a known-blocked
      // family is relaunched immediately and the harness wastes a retry hitting
      // the same limit. Reroute through normal selection on the next iteration.
      log(fmt.status('WARN', `Pinned agent "${fmt.agent(chosen)}" is currently blocked in agents.local.json; rerouting via selectAgent for step "${step}".`));
      tried.add(chosen);
      chosen = undefined;
      continue;
    }

    try {
      assertAgentSupported(chosen || '');
    } catch (err) {
      /** @type {Error & {code?: string}} */
      const e = (err as any);
      if (e.code !== 'LAUNCHER_UNAVAILABLE') {
        throw err;
      }
      log(fmt.status('WARN', (err as any).message));
      // Only reroute for launcher-availability failures (missing or probe-failed).
      tried.add(chosen || '');
      // If the caller pinned a specific agent, allow one retry that ignores
      // the override and falls back to normal selection (matches limit-hit logic).
      if (agentOverride && agentOverride === chosen && iteration === 1) {
        chosen = undefined;
        continue;
      }
      chosen = undefined;
      continue;
    }
    tried.add(chosen || '');
    launched.add(chosen || '');

    const launcher = LAUNCHERS[chosen || ''];
    log(fmt.status('INFO', `Selected agent for step "${step}": ${fmt.agent(chosen || '')}${iteration > 1 ? ` (attempt ${iteration})` : ''}`));

    // Enforce the agent family as the Forgejo identity (ADR 0029 / task-095).
    // FORGEJO_USER is set last so the harness-selected identity always wins;
    // a caller-supplied env.FORGEJO_USER cannot override it.
    const agentEnv = { ...env, FORGEJO_USER: chosen };

    // Decide whether to resume the agent's prior session for this (slug, role).
    // Only honored when the caller passed slug+role+worktree AND the previous
    // marker matches the chosen agent family (a fallback to a different family
    // invalidates the prior session).
    const resume = Boolean(
      worktree && slug && role &&
      RESUME_CAPABLE.has(chosen || '') &&
      ((sessionsModule as any)).shouldResume(worktree, slug, role, chosen || '')
    );
    const sessionId = ((sessionsModule as any)).getSessionId(worktree, slug, role);
    if (slug && role) {
      if (resume) {
        log(fmt.status('INFO', `Resuming ${fmt.agent(chosen || '')} session for ${fmt.slug(slug)} (${role}).${sessionId ? ` Session: ${sessionId}` : ''}`));
      } else if (RESUME_CAPABLE.has(chosen || '')) {
        log(fmt.status('INFO', `No prior ${fmt.agent(chosen || '')} session for ${fmt.slug(slug)} (${role}); launching fresh.`));
      }
    }

    // Resolve the prompt string. If a function was provided, call it with the
    // currently chosen agent name (TASK-1051). This ensures that if startAgent
    // falls back to a different family after a limit hit, the fallback agent
    // receives a prompt tailored to its own identity.
    const actualPrompt = typeof prompt === 'function' ? prompt(chosen) : prompt;

    // Resolve the per-family model override (adapters.agents.models[chosen]).
    // null when the family is not configured, in which case the launcher omits
    // the model flag entirely and the agent uses its own default.
    const model = resolveAgentModelFn(chosen || '', worktree || process.cwd());
    if (model) {
      log(fmt.status('INFO', `Using configured model for ${fmt.agent(chosen || '')}: ${model}`));
    }

    const watchdogConfig = resolveNoOutputWatchdogConfig(noOutputWatchdog, step);
    const launchResult = launcher({
      prompt: actualPrompt,
      worktree,
      env: agentEnv,
      resume,
      sessionId,
      model,
      slug,
      role,
      teeOptions: watchdogConfig ? {
        noOutputWatchdog: {
          ...watchdogConfig,
          onNoOutput: (evt: {pid: number, elapsedMs: number}) => {
            const stage = evt.elapsedMs < (step === 'draft' ? DRAFT_NO_OUTPUT_INITIAL_DELAY_MS : DEFAULT_NO_OUTPUT_INITIAL_DELAY_MS)
              ? 'starting up'
              : 'running';
            log(fmt.status(
              'INFO',
              `No output yet from ${fmt.agent(chosen || '')} for step "${step}" after ${formatElapsed(evt.elapsedMs)} ` +
              `(pid ${evt.pid || 'unknown'}, agent ${stage}). ` +
              `Launcher is still running; stdout/stderr have not produced visible output.`
            ));
          }
        }
      } : {}
    });
    const { invocation, resultPromise } = launchResult;
    if (invocation) {
      log(fmt.status('INFO', `Launching: ${fmt.command(`${invocation.command} ${invocation.args.join(' ')}`)}`));
      if (invocation.options && invocation.options.cwd) {
        log(fmt.status('INFO', `Working directory: ${fmt.path(invocation.options.cwd)}`));
      }
    }

    if (onLaunch) {
      await onLaunch({ agent: chosen, invocation });
    }

    const result = resultPromise ? await resultPromise : launchResult.result;

    // Pass exit metadata so detectLimitHit only treats matching transcript text
    // as a real limit hit when the launcher actually failed. A successful run
    // (status === 0) that happens to contain limit-hit phrases — for example,
    // an agent reviewing code or logs that quote those phrases — must not block
    // the healthy agent.
    const limitHit = detectLimitHitFn({
      agent: chosen,
      stdout: result && result.stdout,
      stderr: result && result.stderr,
      status: result && result.status,
      signal: result && result.signal,
      error: result && result.error
    });

    if (limitHit) {
      log(fmt.status('WARN', `Limit hit detected for ${fmt.agent(chosen || '')}; reset estimate "${limitHit.until}" (${limitHit.source}). Blocking and retrying.`));
      try {
        const blockResult = updateAgentBlockFn(chosen || '', limitHit.until, { reason: limitHit.reason });
        log(fmt.status('INFO', `Wrote blocklist entry for ${fmt.agent(chosen || '')} -> ${fmt.path(blockResult.path)}`));
      } catch (err) {
        log(fmt.status('WARN', `Could not persist blocklist entry for ${fmt.agent(chosen || '')}: ${(err as any).message}`));
      }
      if (typeof onLimitHit === 'function') {
        onLimitHit({ agent: chosen, until: limitHit.until, source: limitHit.source });
      }
      // Reset chosen so next iteration reselects, but only when no explicit override.
      // If the caller pinned a specific agent, fail loudly — there is no fallback.
      if (agentOverride && agentOverride === chosen && iteration === 1) {
        // Allow one retry that ignores the override.
        chosen = undefined;
        continue;
      }
      chosen = undefined;
      continue;
    }

    // Reroute if the launcher binary could not be started (ENOENT = not found, EACCES = not executable).
    if (result && result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) {
      log(fmt.status('WARN', `Launcher for "${chosen || ''}" could not be started (${result.error.code}); rerouting.`));
      tried.add(chosen || '');
      if (agentOverride && agentOverride === chosen && iteration === 1) {
        chosen = undefined;
        continue;
      }
      chosen = undefined;
      continue;
    }

    // Detect launch failure: agent started but exited with non-zero status and
    // no limit-hit was detected. This catches errors like "Model not found" in
    // opencode that cause the launcher to exit immediately with an error code.
    // Retry with the next eligible agent instead of returning the failure.
    // Only treat `status !== null && status !== 0` or `signal` (with no spawn
    // error) as a launch failure; `status: null` without signal is ambiguous
    // (spawn-tee close event can emit null code) and should not trigger a retry.
    // Spurious opencode v2.0.0 JSON-mode exits (exit 1 after a valid
    // "reason":"stop" completion) are excluded — the agent completed, the
    // non-zero code is a post-run cleanup race. Codex and Vibe get the
    // same treatment via their own family-specific telemetry evidence
    // (result.telemetry carrying real, non-zero token usage) rather than an
    // opencode-specific stdout pattern — see isSpuriousCodexExit (codex.ts)
    // and isSpuriousVibeExit (vibe.ts).
    const launchFailed = result &&
      ((result.status !== null && result.status !== 0) || (result.signal && !result.error)) &&
      !limitHit &&
      !isSpuriousOpencodeExit(result) &&
      !(chosen === 'codex' && isSpuriousCodexExit(result)) &&
      !(chosen === 'vibe' && isSpuriousVibeExit(result));
    if (launchFailed) {
      const exitInfo = result.signal
        ? `signal ${result.signal}`
        : `exit ${result.status}`;
      const stderrSnippet = result && result.stderr
        ? ` (${result.stderr.trim().split('\n')[0]})`
        : '';
      log(fmt.status('WARN', `Agent ${fmt.agent(chosen || '')} failed to complete (${exitInfo}${stderrSnippet}); retrying with next eligible agent.`));
      agentErrors.set(chosen || '', {
        exitInfo,
        stderr: result.stderr,
        stdout: result.stdout,
        signal: result.signal,
        status: result.status,
      });
      tried.add(chosen || '');
      launched.add(chosen || '');
      // Block retry candidates only when the failure looks transient. Deterministic
      // setup/config errors (invalid model id, auth failure, read-only HOME, etc.)
      // should fall through to the next family without poisoning agents.local.json.
       if (shouldPersistLaunchFailureBlock(chosen || '', result)) {
         let blockReason = 'transient crash';
         if (result?.signal) { blockReason = `signal ${result.signal}`; }
         else if (result?.error?.code) { blockReason = result.error.code; }
          else if (result?.status !== null && result?.status !== 0) {
            blockReason = result?.stderr
              ? `exit ${result.status}: ${result.stderr.trim().split('\n')[0]}`
              : `exit ${result.status}`;
          }
         const blockUntil = formatBlockUntil(new Date(Date.now() + DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000));
         try {
           const blockResult = updateAgentBlockFn(chosen || '', blockUntil, { reason: blockReason });
           log(fmt.status('INFO', `Wrote blocklist entry for ${fmt.agent(chosen || '')} -> ${fmt.path(blockResult.path)} (${DEFAULT_FALLBACK_HOURS}h block, ${blockReason})`));
         } catch (err) {
          log(fmt.status('WARN', `Could not persist blocklist entry for ${fmt.agent(chosen || '')}: ${(err as any).message}`));
          }
       } else {
        log(fmt.status('INFO', `Skipping blocklist write for ${fmt.agent(chosen || '')}; launch failure looks like a deterministic config/setup error.`));
      }
      chosen = undefined;
      continue;
    }
    // Record the marker so a subsequent same-(slug, role) launch knows which
    // family last ran here. We only persist when the run exited cleanly
    // (status 0 and no spawn error); a failed launch should not overwrite
    // the canonical session marker with a stale transcript.
    if (worktree && slug && role && result && result.status === 0 && !result.error) {
      try {
        const sessionId = result && result.sessionId ? result.sessionId : null;
        ((sessionsModule as any)).writeSession(worktree, slug, role, { agent: chosen || '', sessionId });
      } catch (err) {
        log(fmt.status('WARN', `Could not persist session marker for ${fmt.slug(slug)} (${role}): ${(err as any).message}`));
      }
    }

    return { agent: chosen, invocation, result };
  }
}

// Legacy alias kept for backwards compatibility — draft.js calls this directly.
// Returns { agent, invocation, result } so callers can log which agent ran.
async function startDraftAgent(opts: StartAgentOptions = { prompt: '' }) {
  return startAgent('draft', opts);
}

export {
  KNOWN_AGENT_NAMES,
  WORKFLOW_AGENT_NAMES,
  startAgent,
  startDraftAgent,
  selectAgent,
  eligibleAgentsForStep,
  readAgentConfig,
  readAgentConfigOrExit,
  assertAgentSupported,
  workflowLauncherStatus,
  setCommandPathProbe,
  isAgentBlocked,
  parseBlockUntil,
  isInvalidAgentConfigError,
  updateAgentBlock,
  resolveBlocklistTargetPath,
  resolveNoOutputWatchdogConfig,
  shouldPersistLaunchFailureBlock
};
