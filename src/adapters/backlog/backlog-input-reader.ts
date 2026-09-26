import fs from 'node:fs';
import path from 'node:path';
import { missionId, missionLabels, type Mission } from '../../domain/mission.js';
import type { RepositoryId } from '../../domain/repository.js';
import { getTaskStorage, parseTaskFrontmatterValue } from './task-file-io.js';
import { parseTaskLabels } from './task-metadata.js';

/** Uningested inputs only: never reconstruct a started Mission or its evidence. */
export function readBacklogInputs(rootDir: string, repositoryId: RepositoryId, recordedIds: ReadonlySet<string>): Mission[] {
  const { tasksDir } = getTaskStorage(rootDir);
  if (!fs.existsSync(tasksDir)) { return []; }
  const inputs: Mission[] = [];
  for (const name of fs.readdirSync(tasksDir).filter(name => name.endsWith('.md'))) {
    const filenameId = name.match(/^(task-\d+(?:\.\d+)?)(?:\s|\.md$)/i)?.[1].toLowerCase();
    if (filenameId && recordedIds.has(filenameId)) { continue; }
    const content = fs.readFileSync(path.join(tasksDir, name), 'utf8');
    const id = parseTaskFrontmatterValue(content, 'id')?.trim().toLowerCase();
    const status = parseTaskFrontmatterValue(content, 'status')?.trim().toLowerCase();
    if (!id || recordedIds.has(id) || !['backlog', 'open', 'to do', 'todo'].includes(status ?? '')) { continue; }
    const title = parseTaskFrontmatterValue(content, 'title')?.trim();
    if (!title) { throw new Error(`Backlog input ${name} has no title`); }
    inputs.push({ id: missionId(id), repositoryId, title, labels: missionLabels(parseTaskLabels(content)),
      status: 'backlog', closedAt: null, assignee: null, checkpoints: [], review: null, netEngineeringLines: null });
  }
  return inputs;
}
