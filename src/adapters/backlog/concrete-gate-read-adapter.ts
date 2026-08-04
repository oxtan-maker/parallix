import fs from 'node:fs';
import path from 'node:path';

import type { MissionId } from '../../domain/mission.js';
import type { GateReadAdapter } from '../../application/projections/board-readers.js';
import { findMissionDir } from '../filesystem/mission-utils.js';

// ---------------------------------------------------------------------------
// Parse-primitive types
// ---------------------------------------------------------------------------

type FindMissionDirFn = (_slug: string, _rootDir?: string, _options?: { missionPath?: string }) => string | null;

// ---------------------------------------------------------------------------
// Defaults — static imports (no circular deps)
// ---------------------------------------------------------------------------

function defaultFindMissionDir(): FindMissionDirFn {
  return findMissionDir as FindMissionDirFn;
}

// ---------------------------------------------------------------------------
// Concrete GateReadAdapter
// ---------------------------------------------------------------------------

export interface ConcreteGateReadAdapterOptions {
  readonly rootDir: string;
  /** Find mission directory for a slug. */
  readonly findMissionDir?: FindMissionDirFn;
  /** Optional: read gate result file content. Defaults to checking for gate artifacts. */
  readonly readGateFile?: (_missionDir: string) => string | null;
}

/**
 * Concrete `GateReadAdapter` that materialises latest gate status from
 * integration pipeline results.
 *
 * Returns `'unknown'` when no gate artifacts exist (R2: gate results may have
 * no existing file structure). Handles missing gate artifacts gracefully.
 */
export class ConcreteGateReadAdapter implements GateReadAdapter {
  private readonly rootDir: string;
  private readonly findMissionDir: FindMissionDirFn;
  private readonly readGateFile: (_missionDir: string) => string | null;

  constructor(options: ConcreteGateReadAdapterOptions) {
    this.rootDir = options.rootDir;
    this.findMissionDir = options.findMissionDir ?? defaultFindMissionDir();
    this.readGateFile = options.readGateFile ?? defaultReadGateFile;
  }

  // -----------------------------------------------------------------------
  // GateReadAdapter port
  // -----------------------------------------------------------------------

  async loadGateStatus(_missionId: MissionId): Promise<'passed' | 'failed' | 'running' | 'unknown'> {
    const missionDir = this.findMissionDir(_missionId, this.rootDir);
    if (!missionDir) {
      return 'unknown';
    }

    const content = this.readGateFile(missionDir);
    if (!content) {
      return 'unknown';
    }

    return this.parseGateStatus(content);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private parseGateStatus(content: string): 'passed' | 'failed' | 'running' | 'unknown' {
    const normalized = content.trim().toLowerCase();

    if (normalized.includes('passed') || normalized.includes('success') || normalized === 'true') {
      return 'passed';
    }
    if (normalized.includes('failed') || normalized.includes('failure') || normalized === 'false') {
      return 'failed';
    }
    if (normalized.includes('running') || normalized.includes('in-progress') || normalized.includes('pending')) {
      return 'running';
    }

    return 'unknown';
  }
}

/** Default gate file reader: checks for .workflow/gate-result.json or gate-status.txt */
function defaultReadGateFile(missionDir: string): string | null {
  const candidates = [
    path.join(missionDir, '.workflow', 'gate-result.json'),
    path.join(missionDir, 'gate-status.txt'),
    path.join(missionDir, '.gate-status'),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        return fs.readFileSync(candidate, 'utf8');
      } catch {
        // continue to next candidate
      }
    }
  }

  return null;
}
