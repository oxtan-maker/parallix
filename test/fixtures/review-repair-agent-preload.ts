// Regression provenance: TASK-2582.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { setCommandPathProbe, setLauncherHealthProbe } from '../../src/adapters/agents/launcher-probes.js';

function installLauncherProbes(): void {
  setCommandPathProbe(() => '/fixture-agent');
  setLauncherHealthProbe(() => ({ ok: true as const }));
}

// Only the review process launches the fixture agent. Its pinned verdict and
// resolve children exercise real CLI persistence without loading unused agents.
export async function installReviewRepairAgent(): Promise<void> {
  installLauncherProbes();
  const { setWorkflowLaunchPort } = await import('../../src/adapters/agents/agents.js');

  setWorkflowLaunchPort(({ prompt, worktree, env, configuration }) => ({
    invocation: { command: 'fixture-agent', args: [], options: { cwd: worktree } },
    resultPromise: (async () => {
      await new Promise(resolve => setImmediate(resolve));
      if (!configuration) { throw new Error('Review repair fixture requires resolved configuration'); }
      const childEnvironment = { ...configuration.forwardedEnvironment, ...env };
      const slug = childEnvironment.TASK_2582_SLUG!;
      const cli = childEnvironment.PARALLIX_CLI_COMMAND!;
      const command = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
        execFile(cli, args, { cwd: worktree, env: childEnvironment, timeout: 30_000 }, (error, stdout, stderr) => {
          if (error) { reject(new Error(`child CLI failed: ${stdout}\n${stderr}`)); }
          else { resolve(stdout); }
        });
      });
      // Observe the real persisted state without launching a full source CLI
      // for each read. Verdict and resolve still cross the pinned child CLI.
      const readStatus = () => {
        const database = new DatabaseSync(path.join(configuration.storage.parallixHome!, 'parallix.db'), { readOnly: true });
        try {
          const row = database.prepare('SELECT status, version FROM missions WHERE id = ?').get(slug) as { status: string; version: number };
          return { missionStatus: row.status, version: row.version };
        } finally { database.close(); }
      };
      const status = readStatus();
      const isReviewer = /^Mode: review\./m.test(prompt);
      const phase = isReviewer ? 'review' : 'repair';
      if (status.missionStatus !== (isReviewer ? 'review' : 'active')) { throw new Error(`${phase} started in ${status.missionStatus}`); }
      fs.appendFileSync(childEnvironment.TASK_2582_TRACE!, JSON.stringify({ phase, status: status.missionStatus, entry: childEnvironment.PARALLIX_CLI_ENTRYPOINT, cli }) + '\n');
      if (isReviewer && !fs.existsSync(childEnvironment.TASK_2582_REVIEWED!)) {
        fs.writeFileSync(childEnvironment.TASK_2582_REVIEWED!, 'requested changes');
        await command(['verdict', 'request-changes', '--slug', slug, '--actor', 'codex', '--expected-version', String(status.version),
          '--finding', 'F1', '--summary', 'Repair the fixture deliverable', '--comment', 'Request one fixture fix']);
      } else if (isReviewer) {
        await command(['verdict', 'approve', '--slug', slug, '--actor', 'codex', '--expected-version', String(status.version), '--comment', 'Fixture repair verified']);
      } else {
        await command(['resolve', '--slug', slug, '--actor', 'custom', '--expected-version', String(status.version), '--finding', 'F1', '--fixed', 'Fixture repair recorded']);
      }
      const after = readStatus();
      fs.appendFileSync(childEnvironment.TASK_2582_TRACE!, JSON.stringify({ phase: `${phase}-complete`, status: after.missionStatus }) + '\n');
      return { status: 0, stdout: '', stderr: '' };
    })(),
  }));

}

if (process.argv[2] === 'review') { await installReviewRepairAgent(); }
else if (process.argv[2] === 'verdict' || process.argv[2] === 'resolve') { installLauncherProbes(); }
