import fs from 'node:fs';
import type { StatsMeasurementRecoveryTarget } from '../../../application/stats-backfill-service.js';

/** Read the exact one-time recovery population at the CLI adapter boundary. */
export function readStatsRecoveryInventory(file: string): readonly StatsMeasurementRecoveryTarget[] {
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  const values = Array.isArray(parsed) ? parsed : (parsed as { measurements?: unknown })?.measurements;
  if (!Array.isArray(values)) {
    throw new Error('recovery inventory must be a JSON array or an object with a measurements array');
  }
  const seen = new Set<string>();
  return values.map((value, index) => {
    if (!value || typeof value !== 'object') { throw new Error(`recovery target ${index + 1} must be an object`); }
    const target = value as { mission?: unknown; actorKey?: unknown };
    if (typeof target.mission !== 'string' || !target.mission.trim() || typeof target.actorKey !== 'string'
      || !target.actorKey.trim()) {
      throw new Error(`recovery target ${index + 1} requires mission and actorKey`);
    }
    const result = { mission: target.mission.trim(), actorKey: target.actorKey };
    const identity = `${result.mission}\u001f${result.actorKey}`;
    if (seen.has(identity)) { throw new Error(`duplicate recovery target ${result.mission}/${JSON.stringify(result.actorKey)}`); }
    seen.add(identity);
    return result;
  });
}
