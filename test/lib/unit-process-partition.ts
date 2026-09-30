import fs from 'node:fs';
import path from 'node:path';
import { selectTierFiles } from './test-tier-selection.js';

interface SharedFilePolicy { files: string[] }

// The reviewed trial population is an allowlist. A new unit file defaults to
// per-file isolation, and newly introduced stateful markers remove a file from
// the shared group without changing the tier-selection authority.
const sharedStateMarker = /mockModule|mock\.module|mock\.method|mock\.timers|mock\.fn|process\.(env|chdir|exit)|globalThis\.|before\(|after\(|beforeEach\(|afterEach\(/;

export function unitProcessPartition(root: string) {
  const policyPath = path.join(root, 'test', 'lib', 'shared-unit-files.json');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8')) as SharedFilePolicy;
  if (!Array.isArray(policy.files) || !policy.files.every(file => typeof file === 'string')) {
    throw new Error('invalid shared unit file policy');
  }
  const allowed = new Set(policy.files);
  if (allowed.size !== policy.files.length) { throw new Error('duplicate shared unit file policy entry'); }
  const unit = selectTierFiles(root).unit;
  const testRoot = path.join(root, 'test');
  const safe: string[] = [];
  const isolated: string[] = [];
  for (const file of unit) {
    const relative = path.relative(testRoot, file);
    if (allowed.has(relative) && !sharedStateMarker.test(fs.readFileSync(file, 'utf8'))) {
      safe.push(file);
    } else {
      isolated.push(file);
    }
  }
  if (safe.length === 0 || isolated.length === 0 || safe.length + isolated.length !== unit.length) {
    throw new Error('unit process partition is empty or incomplete');
  }
  return { unit, safe, isolated };
}
