// Agent fixture setup for the ad hoc lifecycle integration contract.
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { run } from '../../src/composition/create-cli.js';

const [slug, serializedWrites] = process.argv.slice(2);
const writes = JSON.parse(serializedWrites) as string[][];
for (const args of writes) {
  const database = new DatabaseSync(path.join(process.env.PARALLIX_HOME!, 'parallix.db'), { readOnly: true });
  let version: number;
  try {
    const row = database.prepare('SELECT version FROM missions WHERE id = ?').get(slug) as { version: number };
    version = row.version;
  } finally { database.close(); }
  const code = await run([...args, '--slug', slug, '--expected-version', String(version)], { baseCwd: process.cwd() });
  if (code !== 0) { process.exitCode = code; break; }
}
