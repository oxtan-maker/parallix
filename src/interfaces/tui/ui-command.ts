import { basename, join } from 'node:path';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import type { AgentBlockEntry, AgentBlocklistRepository, BoardLaneEventEntry, BoardLaneEventRepository, OperationalHistoryEntry, OperationalHistoryRepository, UsageRecord, UsageRepository } from '../../adapters/sqlite/ports.js';
import type { AgentFamily } from '../../domain/agents.js';
import type { RepositoryId } from '../../domain/repository.js';
import { createBoardProjectionBuilder } from '../../application/projections/create-board-projection-builder.js';
import { BoardShell } from './shell.js';

// ---------------------------------------------------------------------------
// In-memory stub repositories for read-only TUI shell
// ---------------------------------------------------------------------------

/**
 * Minimal in-memory AgentBlocklistRepository for read-only TUI use.
 * Returns empty blocklist — sufficient for the static shell projection.
 */
class EmptyBlocklistRepository implements AgentBlocklistRepository {
  async findAll(): Promise<readonly AgentBlockEntry[]> { return []; }
  async findByAgent(): Promise<AgentBlockEntry | undefined> { return undefined; }
  async save(_entry: AgentBlockEntry): Promise<void> {}
  async deleteByAgent(_agent: string): Promise<void> {}
  async clear(): Promise<void> {}
}

/**
 * Minimal in-memory OperationalHistoryRepository for read-only TUI use.
 * Returns empty history — sufficient for the static shell projection.
 */
class EmptyHistoryRepository implements OperationalHistoryRepository {
  async findAll(): Promise<readonly OperationalHistoryEntry[]> { return []; }
  async findByType(_type: string): Promise<readonly OperationalHistoryEntry[]> { return []; }
  async append(_entry: OperationalHistoryEntry): Promise<void> {}
  async clear(): Promise<void> {}
}

/**
 * Minimal in-memory BoardLaneEventRepository for read-only TUI use.
 * Returns empty lane-event log — sufficient for the static shell projection.
 * Lane events are used by Wave 3 flow panel (TASK-2304+).
 */
class EmptyLaneEventRepository implements BoardLaneEventRepository {
  async append(_entry: BoardLaneEventEntry): Promise<boolean> { return false; }
  async findByMissionId(_missionId: string): Promise<readonly BoardLaneEventEntry[]> { return []; }
  async findAll(): Promise<readonly BoardLaneEventEntry[]> { return []; }
  async clear(): Promise<void> {}
}

/**
 * Minimal in-memory UsageRepository for read-only TUI use.
 * Returns empty usage records — sufficient for the static shell projection.
 * Usage records are used by Wave 3 metrics (TASK-2304+).
 */
class EmptyUsageRepository implements UsageRepository {
  async findAll(): Promise<readonly UsageRecord[]> { return []; }
  async findWhere(_predicate: (_record: UsageRecord) => boolean): Promise<readonly UsageRecord[]> { return []; }
  async save(_record: UsageRecord): Promise<void> {}
  async saveAll(_records: readonly UsageRecord[]): Promise<void> {}
  async clear(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Resolve repository identity from the target directory
// ---------------------------------------------------------------------------

function resolveRepositoryId(rootDir: string): RepositoryId {
  const name = basename(rootDir);
  if (!name) {
    throw new Error('Cannot determine repository identity from path');
  }
  return name as RepositoryId;
}

// ---------------------------------------------------------------------------
// Resolve known agent families from agents.json config
// ---------------------------------------------------------------------------

function resolveKnownAgentFamilies(rootDir: string): readonly AgentFamily[] {
  const agentsPath = join(rootDir, 'config', 'agents.json');
  try {
    const raw = readFileSync(agentsPath, 'utf8');
    const config = JSON.parse(raw);
    if (Array.isArray(config?.families)) {
      return config.families.filter((f: unknown): f is string => typeof f === 'string')
        .map((f: string) => f as AgentFamily);
    }
  } catch {
    // Config file missing or malformed — return empty list
  }
  return [];
}

// ---------------------------------------------------------------------------
// px ui — render static BoardProjection shell
// ---------------------------------------------------------------------------

/**
 * Render the static Ink TUI shell.
 *
 * Obtains one BoardProjection from the composition root using concrete read
 * adapters, renders it with the BoardShell component, and exits cleanly on
 * 'q' keypress or Ctrl+C.
 *
 * Called by the command dispatcher. Uses process.cwd() as the target
 * repository root (set by the px.ts entry before dispatch).
 */
export async function runUiCommand(_args: string[] = []): Promise<number> {
  void _args; // intentionally unused — part of public API signature
  const rootDir = process.cwd();

  const repositoryId = resolveRepositoryId(rootDir);
  const knownAgentFamilies = resolveKnownAgentFamilies(rootDir);

  const builder = createBoardProjectionBuilder({
    rootDir,
    repositoryId,
    blocklistRepo: new EmptyBlocklistRepository(),
    historyRepo: new EmptyHistoryRepository(),
    laneEventRepo: new EmptyLaneEventRepository(),
    usageRepo: new EmptyUsageRepository(),
    knownAgentFamilies,
  });

  const projection = await builder.build();

  const { waitUntilExit } = render(
    React.createElement(BoardShell, { projection }),
    {
      exitOnCtrlC: true,
    },
  );

  const exitCode = await waitUntilExit();
  return typeof exitCode === 'number' ? exitCode : 0;
}
