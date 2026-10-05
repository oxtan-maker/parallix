/**
 * Recovery-evidence filesystem: the one place the production tree touches the
 * host filesystem for the recovery store.
 *
 * ADR 0051 keeps the application layer off `node:fs`; the application layer
 * declares the `RecoveryFileSystem` port it needs and composition binds this
 * adapter to it. This adapter is the sole owner of the `node:fs` import so the
 * application-layer boundary stays intact (TASK-2642 boundary decision).
 */

import fs from 'node:fs';

import type { RecoveryFileSystem } from '../../application/recovery-evidence.js';

/** The `node:fs` surface the recovery store needs, adapted to the port shape. */
export const recoveryEvidenceFileSystem: RecoveryFileSystem = {
  realpathSync: (target: string): string => fs.realpathSync(target),
  mkdirSync: (target: string, options: { recursive: boolean }) => fs.mkdirSync(target, { recursive: options.recursive }),
  writeFileSync: (target: string, data: string, options: { encoding: 'utf8' }) => fs.writeFileSync(target, data, { encoding: options.encoding }),
  readFileSync: (target: string, options: { encoding: 'utf8' }): string => fs.readFileSync(target, { encoding: options.encoding }),
  readdirSync: (target: string, options: { withFileTypes: true }): Array<{ name: string; isDirectory(): boolean }> =>
    fs.readdirSync(target, { withFileTypes: options.withFileTypes }) as Array<{ name: string; isDirectory(): boolean }>,
  statSync: (target: string): { mtimeMs: number } => fs.statSync(target),
  rmSync: (target: string, options: { recursive: boolean; force: boolean }): void => fs.rmSync(target, { recursive: options.recursive, force: options.force }),
  renameSync: (target: string, replacement: string): void => fs.renameSync(target, replacement),
};
