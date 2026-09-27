import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../src/adapters/agents/agents.js';

setCommandPathProbe(() => '/fixture-agent');
setLauncherHealthProbe(() => ({ ok: true }));

setWorkflowLaunchPort(({ prompt, worktree }: { prompt: string; worktree?: string }) => ({
  invocation: { command: 'fixture-agent', args: [], options: { cwd: worktree } },
  resultPromise: (async () => {
    await new Promise(resolve => setImmediate(resolve));
    const slug = process.env.TASK_2582_SLUG!;
    const cli = process.env.PARALLIX_CLI_COMMAND!;
    const command = (args: string[]): Promise<string> => new Promise((resolve, reject) => {
      execFile(cli, args, { cwd: worktree, env: process.env, timeout: 30_000 }, (error, stdout, stderr) => {
        if (error) { reject(new Error(`child CLI failed: ${stdout}\n${stderr}`)); }
        else { resolve(stdout); }
      });
    });
    const status = JSON.parse(await command(['status', slug, '--json']));
    const isReviewer = /^Mode: review\./m.test(prompt);
    const phase = isReviewer ? 'review' : 'repair';
    if (status.missionStatus !== (isReviewer ? 'review' : 'active')) { throw new Error(`${phase} started in ${status.missionStatus}`); }
    fs.appendFileSync(process.env.TASK_2582_TRACE!, JSON.stringify({ phase, status: status.missionStatus, entry: process.env.PARALLIX_CLI_ENTRYPOINT, cli }) + '\n');
    if (isReviewer && !fs.existsSync(process.env.TASK_2582_REVIEWED!)) {
      fs.writeFileSync(process.env.TASK_2582_REVIEWED!, 'requested changes');
      await command(['verdict', 'request-changes', '--slug', slug, '--actor', 'codex', '--expected-version', String(status.version),
        '--finding', 'F1', '--summary', 'Repair the fixture deliverable', '--comment', 'Request one fixture fix']);
    } else if (isReviewer) {
      await command(['verdict', 'approve', '--slug', slug, '--actor', 'codex', '--expected-version', String(status.version), '--comment', 'Fixture repair verified']);
    } else {
      await command(['resolve', '--slug', slug, '--actor', 'custom', '--expected-version', String(status.version), '--finding', 'F1', '--fixed', 'Fixture repair recorded']);
    }
    const after = JSON.parse(await command(['status', slug, '--json']));
    fs.appendFileSync(process.env.TASK_2582_TRACE!, JSON.stringify({ phase: `${phase}-complete`, status: after.missionStatus }) + '\n');
    return { status: 0, stdout: '', stderr: '' };
  })(),
}));
