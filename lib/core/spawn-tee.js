"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TailBuffer = exports.DEFAULT_MAX_TAIL_BYTES = void 0;
exports.spawnAndTee = spawnAndTee;
const node_child_process_1 = __importDefault(require("node:child_process"));
const node_path_1 = __importDefault(require("node:path"));
exports.DEFAULT_MAX_TAIL_BYTES = 64 * 1024;
class TailBuffer {
    maxBytes;
    chunks;
    size;
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
            }
            else {
                if (Buffer.isBuffer(head)) {
                    this.chunks[0] = head.subarray(overflow);
                }
                else {
                    this.chunks.shift();
                    this.size -= head.length;
                }
                this.size -= overflow;
            }
        }
    }
    toString() {
        if (this.chunks.length === 0) {
            return '';
        }
        return Buffer.concat(this.chunks).toString('utf8');
    }
}
exports.TailBuffer = TailBuffer;
function spawnAndTee(command, args, options = {}) {
    const { stdoutSink = process.stdout, stderrSink = process.stderr, maxTailBytes = exports.DEFAULT_MAX_TAIL_BYTES, noOutputWatchdog = null, ...spawnOptions } = options;
    return new Promise((resolve) => {
        const stdoutTail = new TailBuffer(maxTailBytes);
        const stderrTail = new TailBuffer(maxTailBytes);
        let settled = false;
        let sawOutput = false;
        let watchdogTimer = null;
        const startTime = Date.now();
        const resolvedCwd = node_path_1.default.resolve(spawnOptions.cwd || process.cwd());
        const env = {
            ...process.env,
            ...(spawnOptions.env || {}),
            PWD: resolvedCwd
        };
        let child;
        try {
            child = node_child_process_1.default.spawn(command, args, {
                ...spawnOptions,
                env,
                stdio: ['inherit', 'pipe', 'pipe']
            });
        }
        catch (err) {
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
            if (settled) {
                return;
            }
            settled = true;
            clearWatchdog();
            payload.startedAt = new Date(startTime).toISOString();
            payload.endedAt = new Date().toISOString();
            resolve(payload);
        };
        const scheduleWatchdog = (delayMs) => {
            if (!noOutputWatchdog || typeof noOutputWatchdog.onNoOutput !== 'function') {
                return;
            }
            const delay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 0;
            watchdogTimer = setTimeout(() => {
                watchdogTimer = null;
                if (settled || sawOutput) {
                    return;
                }
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
        child.stdout?.on('data', (chunk) => {
            noteOutput();
            stdoutTail.push(chunk);
            if (stdoutSink && typeof stdoutSink.write === 'function') {
                stdoutSink.write(chunk);
            }
        });
        child.stderr?.on('data', (chunk) => {
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
                error: err,
            });
        });
        child.on('close', (code, signal) => {
            finish({
                status: code,
                signal,
                stdout: stdoutTail.toString(),
                stderr: stderrTail.toString(),
                error: null,
            });
        });
    });
}
