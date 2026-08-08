import fs from 'node:fs';
import path from 'node:path';

import type { MissionId } from '../../domain/mission.js';
import type { GateReadAdapter } from '../../application/projections/board-readers.js';
import { findMissionDir, resolveWorktree } from '../filesystem/mission-utils.js';

// ---------------------------------------------------------------------------
// Parse-primitive types
// ---------------------------------------------------------------------------

type FindMissionDirFn = (_slug: string, _rootDir?: string, _options?: { missionPath?: string }) => string | null;

type ResolveWorktreeFn = (_slug: string, _options?: { cwd?: string }) => string | null;

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
  /** Resolve the mission's own worktree, where lifecycle commands leave gate artifacts. */
  readonly resolveWorktree?: ResolveWorktreeFn;
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
  private readonly resolveWorktree: ResolveWorktreeFn;

  constructor(options: ConcreteGateReadAdapterOptions) {
    this.rootDir = options.rootDir;
    this.findMissionDir = options.findMissionDir ?? defaultFindMissionDir();
    this.readGateFile = options.readGateFile ?? defaultReadGateFile;
    this.resolveWorktree = options.resolveWorktree ?? (resolveWorktree as ResolveWorktreeFn);
  }

  // -----------------------------------------------------------------------
  // GateReadAdapter port
  // -----------------------------------------------------------------------

  async loadGateStatus(_missionId: MissionId): Promise<'passed' | 'failed' | 'running' | 'unknown'> {
    for (const root of this.searchRoots(_missionId)) {
      const missionDir = this.findMissionDir(_missionId, root);
      if (!missionDir) {
        continue;
      }

      const content = this.readGateFile(missionDir);
      if (content) {
        return this.parseGateStatus(content);
      }
    }

    return 'unknown';
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Roots to look for the gate artifact in, most specific first.
   *
   * A lifecycle command runs inside the mission's own worktree and writes the
   * gate result there; `.workflow/` is gitignored, so it never reaches the
   * checkout the board is composed from. Resolve the mission worktree first and
   * fall back to this adapter's root for missions without one (or when the
   * worktree has been removed).
   */
  private searchRoots(missionId: MissionId): string[] {
    let worktreeDir: string | null = null;
    try {
      worktreeDir = this.resolveWorktree(missionId, { cwd: this.rootDir });
    } catch {
      worktreeDir = null;
    }

    return worktreeDir && worktreeDir !== this.rootDir
      ? [worktreeDir, this.rootDir]
      : [this.rootDir];
  }

  private parseGateStatus(content: string): 'passed' | 'failed' | 'running' | 'unknown' {
    const recorded = this.recordedGateStatus(content);
    if (recorded) {
      return recorded;
    }

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

  /**
   * Read the status a lifecycle command recorded from a real gate exit code
   * (`recordGateResult`). An explicit exit code outranks the text heuristic
   * below: ADR 0048 treats anything short of the deterministic gate result as
   * an unverifiable claim.
   */
  private recordedGateStatus(content: string): 'passed' | 'failed' | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    const exitCode = (parsed as { exitCode?: unknown }).exitCode;
    if (typeof exitCode === 'number') {
      return exitCode === 0 ? 'passed' : 'failed';
    }
    const status = (parsed as { status?: unknown }).status;
    if (status === 'passed' || status === 'failed') {
      return status;
    }
    return null;
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
