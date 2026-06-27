'use strict';

const childProcess = require('child_process');
const path = require('path');

// Bound the in-memory transcript so a noisy or long-running agent cannot
// turn the harness into an O(total-output) memory hog. Detection only needs
// a recent window to find limit-hit phrases (limit-hit.js clips ~200 chars
// around the match), so a tail buffer is sufficient. The cap is generous
// enough that a real limit-hit message and its surrounding reset-time
// context land in the buffer even if the agent printed a lot before exiting.
const DEFAULT_MAX_TAIL_BYTES = 64 * 1024;

/** @typedef {Buffer|string} ChunkType */
class TailBuffer {
  /** @param {number} maxBytes */
  constructor(maxBytes) {
    /** @type {number} */
    this.maxBytes = maxBytes;
    /** @type {ChunkType[]} */
    this.chunks = [];
    /** @type {number} */
    this.size = 0;
  }

  /** @param {ChunkType} chunk */
  push(chunk) {
    this.chunks.push(chunk);
    this.size += chunk.length;
    while (this.size > this.maxBytes && this.chunks.length > 0) {
      const head = this.chunks[0];
      const overflow = this.size - this.maxBytes;
      if (head.length <= overflow) {
        this.chunks.shift();
        this.size -= head.length;
      } else {
        if (Buffer.isBuffer(head)) {
          this.chunks[0] = head.subarray(overflow);
        } else {
          this.chunks.shift();
          this.size -= head.length;
        }
        this.size -= overflow;
      }
    }
  }

  toString() {
    if (this.chunks.length === 0) {return '';}
    return Buffer.concat(/** @type {Buffer[]} */(this.chunks)).toString('utf8');
  }
}

/**
 * Spawn a child process and tee its stdout/stderr to the parent's streams
 * while keeping a bounded tail of the output in memory. Returns a Promise
 * resolving with a result shaped like `spawnSync` (status, signal, stdout,
 * stderr, error) but with stdout/stderr as utf-8 strings populated even
 * when stdio:'inherit' is requested. Forces stdio to ['inherit', 'pipe',
 * 'pipe'] internally so the parent's stdin is preserved while child output
 * remains capturable.
 *
 * Pure I/O wrapper: no policy, no retry, no agent knowledge.
 */
/**
 * @param {string} command
 * @param {string[]} args
 * @param {{stdoutSink?: NodeJS.WriteStream, stderrSink?: NodeJS.WriteStream, maxTailBytes?: number, noOutputWatchdog?: {onNoOutput?: Function, initialDelayMs?: number, intervalMs?: number}, cwd?: string, env?: Record<string, string>, [key: string]: any}} [options]
 */
function spawnAndTee(command, args, options = {}) {
  const {
    stdoutSink = process.stdout,
    stderrSink = process.stderr,
    maxTailBytes = DEFAULT_MAX_TAIL_BYTES,
    noOutputWatchdog = null,
    ...spawnOptions
  } = options;

  return new Promise((resolve) => {
    const stdoutTail = new TailBuffer(maxTailBytes);
    const stderrTail = new TailBuffer(maxTailBytes);
    /** @type {boolean} */
    let settled = false;
    /** @type {boolean} */
    let sawOutput = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let watchdogTimer = null;
    const startTime = Date.now();
    const resolvedCwd = path.resolve(spawnOptions.cwd || process.cwd());
    const env = {
      ...process.env,
      ...(spawnOptions.env || {}),
      PWD: resolvedCwd
    };

    let child;
    try {
      child = childProcess.spawn(command, args, {
        ...spawnOptions,
        env,
        stdio: ['inherit', 'pipe', 'pipe']
      });
    } catch (err) {
      resolve({
        status: null, signal: null, stdout: '', stderr: '', error: err,
        startedAt: new Date(startTime).toISOString(), endedAt: new Date().toISOString()
      });
      return;
    }

    const clearWatchdog = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    /** @param {{status: number|null, signal: string|null, stdout: string, stderr: string, error: any, startedAt: string, endedAt: string}} payload */
    const finish = (payload) => {
      if (settled) {return;}
      settled = true;
      clearWatchdog();
      payload.startedAt = new Date(startTime).toISOString();
      payload.endedAt = new Date().toISOString();
      resolve(payload);
    };

    /** @param {number} delayMs */
    const scheduleWatchdog = (delayMs) => {
      if (!noOutputWatchdog || typeof noOutputWatchdog.onNoOutput !== 'function') {return;}
      const delay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 0;
      watchdogTimer = setTimeout(() => {
        watchdogTimer = null;
        if (settled || sawOutput) {return;}
        if (typeof noOutputWatchdog.onNoOutput === 'function') {
          noOutputWatchdog.onNoOutput({
          command,
          args,
          pid: child.pid,
          elapsedMs: Date.now() - startTime
        });
      }
        scheduleWatchdog(noOutputWatchdog.intervalMs ?? 0);
      }, delay);
      if (typeof watchdogTimer.unref === 'function') {
        watchdogTimer.unref();
      }
    };

    const noteOutput = () => {
      sawOutput = true;
      clearWatchdog();
    };

    if (noOutputWatchdog) {
      scheduleWatchdog(noOutputWatchdog.initialDelayMs ?? 0);
    }

    child.stdout.on('data', (chunk) => {
      noteOutput();
      stdoutTail.push(chunk);
      if (stdoutSink && typeof stdoutSink.write === 'function') {
        stdoutSink.write(chunk);
      }
    });
    child.stderr.on('data', (chunk) => {
      noteOutput();
      stderrTail.push(chunk);
      if (stderrSink && typeof stderrSink.write === 'function') {
        stderrSink.write(chunk);
      }
    });

    child.on('error', (/** @type {Error} */ err) => {
      finish({
        status: null,
        signal: null,
        stdout: stdoutTail.toString(),
        stderr: stderrTail.toString(),
        error: err,
        startedAt: new Date(startTime).toISOString(),
        endedAt: new Date().toISOString()
      });
    });

    child.on('close', (/** @type {number|null} */ code, /** @type {string|null} */ signal) => {
      finish({
        status: code,
        signal,
        stdout: stdoutTail.toString(),
        stderr: stderrTail.toString(),
        error: null,
        startedAt: new Date(startTime).toISOString(),
        endedAt: new Date().toISOString()
      });
    });
  });
}

module.exports = { spawnAndTee, DEFAULT_MAX_TAIL_BYTES };
