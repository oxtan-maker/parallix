import { spawnAndTee } from '../core/spawn-tee.js';

interface MistralInvocationOptions {
  prompt: string;
  worktree: string;
  env?: Record<string, string>;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
}

interface StartMistralAgentOptions extends MistralInvocationOptions {
  teeOptions?: object;
}

// Mistral Vibe in programmatic mode (-p/--prompt) does NOT output a resume
// hint to stdout/stderr like other agents do. Session IDs are stored in
// ~/.vibe/logs/session/session_<timestamp>_<short_id>/meta.json with UUID format,
// but there is no reliable stdout pattern to extract. Therefore, Mistral is
// NOT marked as RESUME_CAPABLE in agents.js. If future Vibe versions add
// a resume hint, update this regex and add 'mistral' to RESUME_CAPABLE.
// Current session ID format in meta.json: UUID like "a3dd3d4d-f97d-d57d-4942-a1f694e3a922"
// Directory naming uses first 8 chars: session_20260521_162703_a3dd3d4d
// No stdout marker detected in testing, so we leave this as null.
// Telemetry: mistral/vibe does not expose token-usage data. See mistral-telemetry.ts
// for the honest-zero stub. Stats hooks in active.js and review-loop.js call
// recordStageStats which defaults to '0' for tokens when telemetry is null.


function extractMistralSessionId(stdout: string) {
  void stdout;
  // Vibe does not currently emit a resume hint in programmatic mode.
  // Return null to indicate no resume capability via stdout parsing.
  return null;
}

function resolveMistralCommand() {
  return 'vibe';
}

function buildMistralInvocation({ prompt, worktree, env, resume, sessionId, model = null }: MistralInvocationOptions) {
  void resume;
  void sessionId;
  // --trust only bypasses the working-directory trust prompt; tool-call
  // approval is a separate gate that vibe --help documents as controlled by
  // --auto-approve/--yolo. Without it, any prompt that needs a tool call
  // blocks on interactive approval outside a TTY and fails with a generic
  // error, which then gets misread as a real launch failure and persisted
  // to the blocklist (claude/opencode/codex all pass their own equivalent
  // non-interactive bypass already).
  const args = ['--prompt', prompt, '--trust', '--yolo', '--output', 'text'];

  // Vibe programmatic mode does not support --resume flag in the same way
  // as other agents. The --resume flag exists but requires interactive selection
  // or a session picker. Since we cannot reliably pass a session ID via
  // programmatic mode, we do not add resume flags here.
  // If resume capability is proven in a future version, update this.

  // Vibe has no CLI model flag in programmatic mode; the active model is
  // selected via the VIBE_ACTIVE_MODEL env var (verified from `vibe --help`).
  const modelEnv = model ? { VIBE_ACTIVE_MODEL: model } : {};

  return {
    command: resolveMistralCommand(),
    args,
    options: {
      stdio: 'inherit',
      cwd: worktree,
      env: { ...process.env, ...env, ...modelEnv }
    }
  };
}

function startMistralAgent({ prompt, worktree, env, resume = false, sessionId = null, model = null, teeOptions = {} }: StartMistralAgentOptions) {
  const invocation = buildMistralInvocation({ prompt, worktree, env, resume, sessionId, model });
  const resultPromise = spawnAndTee(invocation.command, invocation.args, { ...invocation.options, ...teeOptions } as any).then((result: any) => {
    if (result && result.stdout) {
      result.sessionId = extractMistralSessionId(result.stdout);
    }
    return result;
  });

  return { invocation, resultPromise };
}

export {
  buildMistralInvocation,
  extractMistralSessionId,
  resolveMistralCommand,
  startMistralAgent
};
