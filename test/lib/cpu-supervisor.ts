import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export interface CpuReport { userUs: number; systemUs: number }

export function cpuSupervisor(executionRoot: string): string {
  if (process.platform !== 'linux' && process.platform !== 'darwin') {
    throw new Error(`CPU test supervisor requires Linux or macOS, found ${process.platform}`);
  }
  const source = path.join(executionRoot, 'test', 'lib', 'cpu-supervisor.c');
  const hash = createHash('sha256').update(fs.readFileSync(source)).update(process.platform).update(process.arch).digest('hex').slice(0, 16);
  const directory = path.join(executionRoot, 'tmp', 'cpu-supervisor');
  const binary = path.join(directory, `cpu-supervisor-${hash}`);
  if (fs.existsSync(binary)) { return binary; }
  fs.mkdirSync(directory, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(directory, 'compile-'));
  try {
    const candidate = path.join(temporary, 'cpu-supervisor');
    const compile = spawnSync(process.env.CC || 'cc', ['-O2', '-std=c11', '-D_DEFAULT_SOURCE', '-D_DARWIN_C_SOURCE', source, '-o', candidate], { encoding: 'utf8' });
    if (compile.status !== 0) {
      throw new Error(`CPU supervisor compilation failed: ${compile.stderr || compile.error?.message || compile.status}`);
    }
    fs.renameSync(candidate, binary);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  return binary;
}

export function readCpuReport(report: string): CpuReport {
  const value = JSON.parse(fs.readFileSync(report, 'utf8')) as Partial<CpuReport>;
  if (!Number.isSafeInteger(value.userUs) || !Number.isSafeInteger(value.systemUs)
      || (value.userUs ?? -1) < 0 || (value.systemUs ?? -1) < 0) {
    throw new Error('invalid CPU supervisor report');
  }
  return value as CpuReport;
}
