import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface CaptureOpencodeExportOptions {
  worktree?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  /** Retain only this invocation's owned capture directory for diagnosis. */
  retainTemp?: boolean;
  /** Injectable temporary root for deterministic tests. */
  tmpDir?: string;
  spawn?: typeof childProcess.spawn;
}

function opencodeCommandCandidates() {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate?: string | null) => {
    if (!candidate || seen.has(candidate)) {return;}
    seen.add(candidate);
    candidates.push(candidate);
  };

  pushCandidate(process.env.OPENCODE_BIN);
  pushCandidate('opencode');
  pushCandidate(path.join(os.homedir(), '.opencode', 'bin', 'opencode'));
  pushCandidate(path.join(os.homedir(), '.local', 'bin', 'opencode'));

  return candidates;
}

function resolveExistingCommand(candidate: string) {
  if (!candidate) {return null;}
  if (candidate.includes(path.sep)) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) {
      return null;
    }
  }

  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) {continue;}
    const commandPath = path.join(dir, candidate);
    try {
      fs.accessSync(commandPath, fs.constants.X_OK);
      return candidate;
    } catch (_) { /* keep looking */ }
  }
  return null;
}

function resolveOpencodeCommand() {
  for (const candidate of opencodeCommandCandidates()) {
    const resolved = resolveExistingCommand(candidate);
    if (resolved) {return resolved;}
  }
  return 'opencode';
}

/**
 * Capture the complete `opencode export <sessionId>` JSON document.
 *
 * Unlike the limit-hit tail buffer in spawn-tee.js, telemetry needs the WHOLE
 * export document (it is a single JSON object beginning with `{`), so a tail
 * buffer would discard the prefix and yield invalid JSON. This collector keeps
 * the full stdout in memory up to an explicit cap and, critically:
 *
 *   - Enforces a timeout that kills a hung/non-exiting export child so the
 *     launcher can never block on it (mission risk + stop rule).
 *   - Fails explicitly (resolves null) when output exceeds `maxBytes` rather
 *     than silently truncating into unparseable JSON.
 *
 * Uses a temp-file fd for stdout to avoid pipe-buffer data loss that occurs
 * with large (>100 KB) child-process output.  The child writes directly to
 * the fd; after exit we read the file back as a string.
 *
 * Never rejects: any error/timeout/oversize resolves to null so telemetry
 * capture stays best-effort and cannot break the launch.
 *
 * @param {string} sessionId - opencode session id (e.g. ses_...)
 * @param {object} opts
 * @param {string} [opts.worktree] - cwd for the export process
 * @param {object} [opts.env] - extra env vars
 * @param {number} [opts.timeoutMs] - hard timeout before the child is killed
 * @param {number} [opts.maxBytes] - explicit byte cap; exceeding it fails
 * @param {Function} [opts.spawn] - injectable spawn (defaults to child_process.spawn)
 * @returns {Promise<string|null>} Full JSON string, or null on failure
 */
function captureOpencodeExport(sessionId: string, opts: CaptureOpencodeExportOptions = {}) {
  const {
    worktree,
    env,
    timeoutMs = 30000,
    maxBytes = 32 * 1024 * 1024,
    retainTemp = process.env.PARALLIX_KEEP_TEMP_ARTIFACTS === '1',
    tmpDir = os.tmpdir(),
    spawn = childProcess.spawn,
  } = opts;

  return new Promise<string | null>((resolve) => {
    if (!sessionId) {
      resolve(null);
      return;
    }

    let settled = false;
    let timer: NodeJS.Timeout | null = null;
    let size = 0;
    let tmpFd: number | null = null;
    let tmpPath: string | null = null;
    let tmpRoot: string | null = null;

    const finish = (value: string | null) => {
      if (settled) {return;}
      settled = true;
      if (timer) {clearTimeout(timer);}
      // Clean up temp file
      if (tmpFd !== null) {
        try { fs.closeSync(tmpFd); } catch (_) { /* already closed */ }
      }
      if (tmpRoot && !retainTemp) {
        // tmpRoot is created by this invocation with mkdtempSync, so this
        // never reaches an operator path or another export's active capture.
        try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) { /* best effort */ }
      }
      resolve(value);
    };

    const killChild = (child: childProcess.ChildProcess | undefined) => {
      try { if (child) { child.kill('SIGKILL'); } } catch (_) { /* already gone */ }
    };

    // Create a temp file for stdout to avoid pipe-buffer truncation
    let tmpFileError = null;
    try {
      tmpRoot = fs.mkdtempSync(path.join(tmpDir, 'opencode-export-'));
      tmpPath = path.join(tmpRoot, 'stdout.json');
      tmpFd = fs.openSync(tmpPath, 'w');
    } catch (e) {
      tmpFileError = e;
    }

    let child;
    try {
      child = spawn(resolveOpencodeCommand(), ['export', sessionId], {
        cwd: worktree,
        env: { ...process.env, ...(env || {}) },
        stdio: ['ignore', tmpFd !== null ? tmpFd : 'pipe', 'pipe'],
      });
    } catch (_) {
      finish(null);
      return;
    }

    if (tmpFileError) {
      killChild(child);
      finish(null);
      return;
    }

    timer = setTimeout(() => {
      // Hung or slow export: kill it and degrade to null. Do not block.
      killChild(child);
      finish(null);
    }, timeoutMs);
    // Intentionally NOT unref'd: the caller always awaits this Promise, and the
    // timer is cleared via finish() the moment the export resolves. Leaving it
    // ref'd keeps the timeout deterministic under Node's test runner (an unref'd
    // timer can be skipped when the loop is otherwise idle, cancelling the test).

    // Consume stderr to prevent pipe-buffer issues with the opencode binary
    if (child.stderr) {
      child.stderr.on('data', () => { /* drain stderr */ });
    }

    child.on('error', () => finish(null));

    child.on('close', () => {
      if (settled) {return;}
      if (tmpFd === null) {
        finish(null);
        return;
      }

      try {
        fs.closeSync(tmpFd);
      } catch (_) { /* already closed */ }
      tmpFd = null;

      let content;
      if (!tmpPath) { finish(null); return; }
      try {
        content = fs.readFileSync(tmpPath, 'utf8');
      } catch (_) {
        finish(null);
        return;
      }

      size = Buffer.byteLength(content);
      if (size > maxBytes) {
        // Explicit failure rather than silent truncation: a partial JSON
        // document would parse to null/garbage and fabricate zero telemetry.
        finish(null);
        return;
      }

      finish(content);
    });
  });
}

export { captureOpencodeExport };
