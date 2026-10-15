import { describeLaunchFailure, launchFailureOf } from '../../domain/launch-failure.js';
import type { AgentProcessResult, AgentInvocation } from "./agent-process-types.js";
import * as fmt from "../../application/presentation/cli-format.js";
import { isSpuriousCodexExit } from "./codex.js";
import { isSpuriousVibeExit } from "./vibe.js";
import { isSpuriousOpencodeExit } from "./opencode.js";
import { isSpuriousQwenExit } from "./qwen.js";
import { detectLimitHit, formatBlockUntil, DEFAULT_FALLBACK_HOURS, type DetectedLimitHit } from "../../application/services/agent-limit.js";
import { AgentPoolExhaustedError } from "../../domain/agents.js";
import type { LaunchResultLike, AgentFailureDetails, AgentBlockWriter, AgentLog, StartAgentLoopState, StartAgentLoopDeps, LaunchVerdict } from './agent-launch-context.js';


export const NON_BLOCKING_CREDENTIAL_ERROR_PATTERNS = Object.freeze([
  /\bauth(?:entication)?\b/i,
  /\bunauthorized\b/i,
  /\bforbidden\b/i,
  /\bapi\s+key\b/i,
]);


export const CREDENTIAL_REFRESH_ERROR_PATTERNS = Object.freeze([
  ...NON_BLOCKING_CREDENTIAL_ERROR_PATTERNS,
  /\b(?:access\s+)?(?:token|credential)s?\b.*\bexpired\b|\bexpired\b.*\b(?:access\s+)?(?:token|credential)s?\b/i,
]);


export const NON_BLOCKING_LAUNCH_ERROR_PATTERNS = Object.freeze([
  // task-2380: Claude missing-session resume error (also recovered per-family
  // in claude.ts). Deterministic, agent-specific — never poison the blocklist.
  /no conversation found with session id:/i,
  /\b(?:invalid|unknown|unsupported|unrecognized)\s+model\b/i,
  /\bmodel\s+(?:identifier|id)\s+(?:is\s+)?invalid\b/i,
  /\b(?:model\s+not\s+found|no\s+such\s+model)\b/i,
  /\bunknown\s+option\b/i,
  /\bunsupported\s+(flag|option)\b/i,
  ...NON_BLOCKING_CREDENTIAL_ERROR_PATTERNS,
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
// unsupported CLI flags, home/bootstrap failures, missing-session resume) are
// per-invocation and repeat on every retry, so they must never poison the
// persistent blocklist. Custom agents are never blocked.
//
// Beyond those deterministic errors, a family-wide block is persisted ONLY when
// the failure is positively classified as a genuine provider-wide availability
// or quota condition. The decision routes through the same `detectLimitHit`
// classifier the limit-hit branch uses (task-2536) so both block-persistence
// sites agree on one bar: an ambiguous non-zero exit with no quota/429/
// resource_exhausted signal (e.g. a bare `exit 1` / "generic crash") stays local
// to the failing launch instead of becoming a three-hour family block while the
// family is live. A process-kill signal is still caught by detectLimitHit's
// short-block path and preserved.
export function shouldPersistLaunchFailureBlock(agent: string, result: LaunchResultLike | null | undefined) {
  if (!result || agent === 'custom') {return false;}
  const combined = [
    result.stderr || '',
    result.stdout || '',
    (result.error as { message?: string } | null | undefined)?.message || '',
    launchErrorCode(result.error) || ''
  ].join('\n');
  if (NON_BLOCKING_LAUNCH_ERROR_PATTERNS.some(pattern => pattern.test(combined))) {return false;}
  const hit = detectLimitHit({
    agent,
    stdout: result.stdout,
    stderr: result.stderr,
    // detectLimitHit's `status` is number|undefined; normalise the null that a
    // spawned-but-closed child emits (spawn-tee close event) to undefined so the
    // classifier's `typeof status === 'number'` gate behaves as intended.
    status: result.status ?? undefined,
    signal: result.signal,
    error: result.error ?? null
  });
  return !!hit && !hit.reroute;
}


export function needsCredentialRefresh(result: LaunchResultLike): boolean {
  return CREDENTIAL_REFRESH_ERROR_PATTERNS.some(pattern => pattern.test([
    result.stderr || '', result.stdout || '', (result.error as { message?: string } | null | undefined)?.message || '', launchErrorCode(result.error) || ''
  ].join('\n')));
}


/** One line per family that actually launched, naming how it ended. */
export function agentPoolExhaustedError(step: string, launched: Set<string>, agentErrors: Map<string, AgentFailureDetails>): AgentPoolExhaustedError {
  const errorDetails = [...agentErrors.entries()].map(([agent, details]) => {
    const status = details.exitInfo === 'stalled'
      ? 'stalled (no output)'
      : (details.status !== undefined && details.status !== null
        ? `exit ${details.status}`
        : (details.signal ? `signal ${details.signal}` : 'unknown'));
    const stderrSnippet = details.stderr ? ` (${details.stderr.trim().split('\n')[0]})` : '';
    return `${agent}: ${status}${stderrSnippet}`;
  }).join('; ');
  return new AgentPoolExhaustedError(step,
    `All eligible agents exhausted for step "${step}". ` +
    `Tried: ${[...launched].join(', ')}. Errors: ${errorDetails}.`
  );
}


export function launchErrorCode(error: unknown): string | undefined { return (error as { code?: string } | null | undefined)?.code; }


/** How a launch failure reads in the blocklist entry. */
export function launchFailureBlockReason(result: AgentProcessResult | null | undefined): string {
  if (result?.signal) { return `signal ${result.signal}`; }
  const errorCode = launchErrorCode(result?.error);
  if (errorCode) { return errorCode; }
  if (result?.status !== null && result?.status !== 0) {
    return result?.stderr ? `exit ${result.status}: ${result.stderr.trim().split('\n')[0]}` : `exit ${result?.status}`;
  }
  return 'transient crash';
}


/**
 * Block retry candidates only on a positive availability/quota classification
 * (task-2536). Deterministic setup/config errors and every ambiguous non-zero
 * exit fall through to the next family without poisoning agents.local.json.
 * This is the second of two block-persistence sites; both agree on one bar via
 * shouldPersistLaunchFailureBlock.
 *
 * NOTE (task-2536 round-1 F2): under default wiring this is unreachable —
 * startAgent's limit-hit check uses the same detectLimitHit classifier, so a
 * positive classification is caught and persisted there first. It is retained
 * as defence-in-depth for callers that inject a non-default detectLimitHitFn;
 * do not read it as a live production block path.
 */
export async function persistLaunchFailureBlock(agent: string, result: AgentProcessResult | null | undefined, updateAgentBlockFn: AgentBlockWriter, log: AgentLog): Promise<void> {
  if (!shouldPersistLaunchFailureBlock(agent, result)) {
    log(fmt.status('INFO', `Skipping blocklist write for ${fmt.agent(agent)}; failure not positively classified as a provider availability/quota block.`));
    return;
  }
  const blockReason = launchFailureBlockReason(result);
  const blockUntil = formatBlockUntil(new Date(Date.now() + DEFAULT_FALLBACK_HOURS * 60 * 60 * 1000));
  try {
    const blockResult = await updateAgentBlockFn(agent, blockUntil, { reason: blockReason });
    log(fmt.status('INFO', `Wrote checked AgentBlock for ${fmt.agent(agent)} (${DEFAULT_FALLBACK_HOURS}h block, ${blockResult.reason || blockReason})`));
  } catch (err) {
    log(fmt.status('WARN', `Could not persist blocklist entry for ${fmt.agent(agent)}: ${(err as Error & { code?: string }).message}`));
  }
}



/** Recognized agent-pool exhaustion signals (real selectAgent and test mocks). */
export function isAgentPoolExhaustionError(err: unknown): boolean {
  return err instanceof AgentPoolExhaustedError;
}


function reportSpawnFailure(chosen: string, result: AgentProcessResult, log: AgentLog): void {
  const launchFailure = result && result.status === null && result.error ? launchFailureOf(result) : null;
  if (launchFailure) {
    log(fmt.status('WARN', `Launcher for "${chosen}" did not start or report an exit status: ${describeLaunchFailure(launchFailure)}`));
  }
}

/**
 * Classify the launch outcome: limit hits (reroute or block), launcher
 * spawn failures, and launch failures (reroute, or return for the caller to
 * report when pinned). Returns kind 'return' when the loop ends.
 */
export async function classifyLaunchOutcome(state: StartAgentLoopState, deps: StartAgentLoopDeps, chosen: string, invocation: AgentInvocation | null | undefined, result: AgentProcessResult): Promise<LaunchVerdict> {
  const { log } = deps;
  if (result && launchErrorCode(result.error) === 'NO_OUTPUT_TIMEOUT') {
    deps.refuseFallbackWhenPinned('reviewer produced no output before configured liveness deadline');
    log(fmt.status('WARN', `No output from ${fmt.agent(chosen)} before the configured liveness deadline; rerouting without block.`));
    state.agentErrors.set(chosen, { exitInfo: 'stalled', stderr: result.stderr, stdout: result.stdout });
    state.tried.add(chosen);
    state.launched.add(chosen);
    state.chosen = undefined;
    return { kind: 'continue' };
  }
  // Pass exit metadata so detectLimitHit only treats matching transcript text
  // as a real limit hit when the launcher actually failed. A successful run
  // (status === 0) that happens to contain limit-hit phrases — for example,
  // an agent reviewing code or logs that quote those phrases — must not block
  // the healthy agent.
  const limitHit = deps.detectLimitHitFn({
    agent: chosen,
    stdout: result?.stdout,
    stderr: result?.stderr,
    status: result && result.status,
    signal: result && result.signal,
    error: result && result.error
  });

  if (limitHit) { return handleLimitHit(state, deps, chosen, limitHit); }

  // Reroute if the launcher binary could not be started (ENOENT = not found, EACCES = not executable).
  if (result && result.error && (launchErrorCode(result.error) === 'ENOENT' || launchErrorCode(result.error) === 'EACCES')) {
    deps.refuseFallbackWhenPinned(`launcher could not be started (${launchErrorCode(result.error)})`);
    log(fmt.status('WARN', `Launcher for "${chosen}" could not be started (${launchErrorCode(result.error)}); rerouting.`));
    state.tried.add(chosen);
    state.chosen = undefined;
    return { kind: 'continue' };
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
  reportSpawnFailure(chosen, result, log);

  const launchFailed = failedProcess(result) && !completedDespiteExit(chosen, result);
  if (launchFailed) { return handleFailedLaunch(state, deps, chosen, invocation, result); }
  return { kind: 'return', invocation, result };
}

async function handleLimitHit(state: StartAgentLoopState, deps: StartAgentLoopDeps, chosen: string, limitHit: DetectedLimitHit): Promise<LaunchVerdict> {
  const { log } = deps;
    // Reroute signal: transient limit (e.g. qwen rate-limit) — exclude from
    // current retry cycle without persisting a long block to blocklist.
    if (limitHit.reroute) {
      const label = limitHit.kind === 'entitlement' ? 'Model entitlement failure' : 'Transient limit';
      const action = limitHit.kind === 'entitlement'
        ? `Check the configured Qwen model and account entitlement, then retry.`
        : 'Rerouting without block.';
      log(fmt.status('WARN', `${label} for ${fmt.agent(chosen)}; ${limitHit.reason}. ${action}`));
      state.tried.add(chosen);
      state.chosen = undefined;
      return { kind: 'continue' };
    }

    log(fmt.status('WARN', `Limit hit detected for ${fmt.agent(chosen)}; reset estimate "${limitHit.until}" (${limitHit.source}). Blocking and retrying.`));
    try {
      const blockResult = await deps.updateAgentBlockFn(chosen, limitHit.until, { reason: limitHit.reason });
      log(fmt.status('INFO', `Wrote checked AgentBlock for ${fmt.agent(chosen)} (${blockResult.reason || 'limit'})`));
    } catch (err) {
      log(fmt.status('WARN', `Could not persist blocklist entry for ${fmt.agent(chosen)}: ${(err as Error & { code?: string }).message}`));
    }
    if (typeof deps.onLimitHit === 'function') {
      deps.onLimitHit({ agent: chosen, until: limitHit.until, source: limitHit.source });
    }
    deps.refuseFallbackWhenPinned(`usage limit hit; blocked until ${limitHit.until}`);
    // A pinned agent fails loudly above; everything else reselects next round.
    state.chosen = undefined;
    return { kind: 'continue' };
}

function completedDespiteExit(chosen: string, result: AgentProcessResult): boolean {
  if (isSpuriousOpencodeExit(result)) { return true; }
  switch (chosen) {
    case "codex": return isSpuriousCodexExit(result);
    case "vibe": return isSpuriousVibeExit(result);
    case "qwen": return isSpuriousQwenExit(result);
    default: return false;
  }
}

async function handleFailedLaunch(state: StartAgentLoopState, deps: StartAgentLoopDeps, chosen: string, invocation: AgentInvocation | null | undefined, result: AgentProcessResult): Promise<LaunchVerdict> {
  const { log } = deps;
    const exitInfo = result.signal
      ? `signal ${result.signal}`
      : `exit ${result?.status}`;
    const stderrSnippet = result && result.stderr
      ? ` (${result.stderr.trim().split('\n')[0]})`
      : '';
    if (needsCredentialRefresh(result)) {
      log(fmt.status('WARN', `Agent ${fmt.agent(chosen)} credentials need refreshing; re-authenticate the ${chosen} launcher before retrying.`));
    }
    // Pinned work has no next eligible agent: hand the failed result back so
    // the caller reports the owner's own exit status (TASK-2294.01).
    if (deps.pinnedAgent && deps.agentOverride) {
      log(fmt.status('WARN', `Pinned agent ${fmt.agent(chosen)} failed to complete (${exitInfo}${stderrSnippet}); no fallback is permitted for this step.`));
      return { kind: 'return', invocation, result };
    }
    log(fmt.status('WARN', `Agent ${fmt.agent(chosen)} failed to complete (${exitInfo}${stderrSnippet}); retrying with next eligible agent.`));
    state.agentErrors.set(chosen, {
      exitInfo,
      stderr: result.stderr,
      stdout: result.stdout,
      signal: result.signal,
      status: result.status,
    });
    state.tried.add(chosen);
    state.launched.add(chosen);
    // Block retry candidates only on a positive availability/quota
    // classification (task-2536). Deterministic setup/config errors and every
    // ambiguous non-zero exit fall through to the next family without
    // poisoning agents.local.json. This is the second of two block-persistence
    // sites; both now agree on one bar via shouldPersistLaunchFailureBlock.
    //
    // NOTE (task-2536 round-1 F2): under default wiring this branch is
    // unreachable — startAgent's site-1 limit-hit check (L653) uses the same
    // detectLimitHit classifier this helper calls, so a positive availability/
    // quota classification is caught and persisted at site 1 first, and this
    // helper only runs after a falsy site-1 result. It is retained solely as
    // defence-in-depth for callers that inject a non-default detectLimitHitFn;
    // do not read it as a live production block path.
    await persistLaunchFailureBlock(chosen, result, deps.updateAgentBlockFn, log);
    state.chosen = undefined;
    return { kind: 'continue' };
}

function failedProcess(result: AgentProcessResult): boolean {
  return (result.status !== null && result.status !== 0) || Boolean(result.signal && !result.error);
}
