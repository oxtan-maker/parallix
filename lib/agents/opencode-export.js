'use strict';

const childProcess = require('child_process');

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
function captureOpencodeExport(sessionId, opts = {}) {
  const {
    worktree,
    env,
    timeoutMs = 30000,
    maxBytes = 32 * 1024 * 1024,
    spawn = childProcess.spawn,
  } = opts;

  return new Promise((resolve) => {
    if (!sessionId) {
      resolve(null);
      return;
    }

    let settled = false;
    let timer = null;
    const chunks = [];
    let size = 0;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };

    const killChild = (child) => {
      try { child.kill('SIGKILL'); } catch (_) { /* already gone */ }
    };

    let child;
    try {
      child = spawn('opencode', ['export', sessionId], {
        cwd: worktree,
        env: { ...process.env, ...(env || {}) },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (_) {
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

    if (!child || !child.stdout) {
      finish(null);
      return;
    }

    child.stdout.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        // Explicit failure rather than silent truncation: a partial JSON
        // document would parse to null/garbage and fabricate zero telemetry.
        killChild(child);
        finish(null);
        return;
      }
      chunks.push(chunk);
    });

    child.on('error', () => finish(null));

    child.on('close', () => {
      if (settled) return;
      finish(Buffer.concat(chunks).toString('utf8'));
    });
  });
}

module.exports = { captureOpencodeExport };
