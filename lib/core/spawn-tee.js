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

class TailBuffer {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.chunks = [];
    this.size = 0;
  }

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
        this.chunks[0] = head.subarray(overflow);
        this.size -= overflow;
      }
    }
  }

  toString() {
    if (this.chunks.length === 0) {return '';}
    return Buffer.concat(this.chunks).toString('utf8');
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
    let settled = false;
    let sawOutput = false;
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

    const finish = (payload) => {
      if (settled) {return;}
      settled = true;
      clearWatchdog();
      payload.startedAt = new Date(startTime).toISOString();
      payload.endedAt = new Date().toISOString();
      resolve(payload);
    };

    const scheduleWatchdog = (delayMs) => {
      if (!noOutputWatchdog || typeof noOutputWatchdog.onNoOutput !== 'function') {return;}
      const delay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 0;
      watchdogTimer = setTimeout(() => {
        watchdogTimer = null;
        if (settled || sawOutput) {return;}
        noOutputWatchdog.onNoOutput({
          command,
          args,
          pid: child.pid,
          elapsedMs: Date.now() - startTime
        });
        scheduleWatchdog(noOutputWatchdog.intervalMs);
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
      scheduleWatchdog(noOutputWatchdog.initialDelayMs);
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

    child.on('error', (err) => {
      finish({
        status: null,
        signal: null,
        stdout: stdoutTail.toString(),
        stderr: stderrTail.toString(),
        error: err
      });
    });

    child.on('close', (code, signal) => {
      finish({
        status: code,
        signal,
        stdout: stdoutTail.toString(),
        stderr: stderrTail.toString(),
        error: null
      });
    });
  });
}

module.exports = { spawnAndTee, DEFAULT_MAX_TAIL_BYTES };
