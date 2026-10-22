/** Runnable public-CLI interruption exercise; only disposable state and controlled children. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { bundleWorkflowChild } from './workflow-bundle.js';
import { workflowBoard, until } from './workflow-board.js';
import { missionId } from '../../src/domain/mission.js';
import { WorkflowProcessAdapter } from '../../src/adapters/process/workflow-process.js';

process.env.PARALLIX_FIXTURE_DEADLINE_MS = '120000';
const bundle = await bundleWorkflowChild();
try {
  for (const mode of (process.argv[2] ? [process.argv[2]] : ['active', 'lead', 'tmux'])) {
    const fixture = await workflowBoard(1, { cli: bundle.cli, providers: true });
    const children: ReturnType<typeof spawn>[] = [];
    const slug = fixture.slugs[0];
    const worktree = path.join(fixture.root, 'worktrees', slug);
    const marker = path.join(fixture.root, `${slug}.provider-1.entered`);
    const invoke = (args: string[]) => {
      const child = spawn(bundle.cli.command, [...bundle.cli.args, '--fixture-public', worktree, ...args], {
        cwd: worktree, env: { ...fixture.configuration.forwardedEnvironment, WORKFLOW_AGENT: 'codex' }, stdio: 'pipe',
      });
      children.push(child);
      let output = '';
      child.stdout!.on('data', data => { output += String(data); });
      child.stderr!.on('data', data => { output += String(data); });
      const exit = once(child, 'exit');
      return { child, exit, output: () => output };
    };
    const query = async (args: string[]) => {
      const command = invoke(args);
      const [code] = await command.exit;
      console.log(`[${mode}] px ${args.join(' ')} => ${code}\n${command.output()}`);
      assert.equal(code, 0, command.output());
      return command.output();
    };
    try {
      if (mode === 'tmux') {
        fs.writeFileSync(path.join(worktree, 'workflow.config.json'), JSON.stringify({ adapters: { terminal: { host: 'tmux', whenUnavailable: 'fail' } } }));
      }
      if (mode === 'lead') {
        const loaded = await fixture.store.load(missionId(slug));
        assert.equal(loaded.kind, 'found');
        if (loaded.kind === 'found') { await fixture.store.save({ ...loaded.mission, status: 'active', rawStatus: 'active', closedAt: null }, loaded.version); }
      }
      const command = invoke(mode === 'lead' ? ['lead', slug, '--poll', '60', '--budget', '0'] : ['active', slug, '--implementer', 'codex']);
      await until(() => fixture.entered(slug) || command.child.exitCode !== null, `${mode} admission`, 10000);
      assert.equal(command.child.exitCode, null, command.output());
      fixture.release(slug);
      await until(() => fs.existsSync(marker) || command.child.exitCode !== null, `${mode} provider`, 10000);
      assert.ok(fs.existsSync(marker), command.output());
      const original = (await fixture.service.current(slug))!;
      assert.ok(original?.owner, command.output());
      const provider = Number(fs.readFileSync(marker, 'utf8'));
      const processes = new WorkflowProcessAdapter(bundle.cli, worktree, fixture.configuration);
      await query(['status', slug]);
      const conflict = invoke(['active', slug, '--implementer', 'codex']);
      assert.notEqual((await conflict.exit)[0], 0);
      assert.match(conflict.output(), /owns this mission/);
      command.child.kill('SIGINT'); command.child.kill('SIGINT');
      const [code] = await command.exit;
      console.log(`[${mode}] SIGINT => ${code}\n${command.output()}`);
      assert.notEqual(code, 0);
      assert.equal((await fixture.service.operation(original.id))?.phase, 'stopped');
      assert.equal(await processes.alive(original.owner!), false);
      await until(() => { try { process.kill(provider, 0); return false; } catch { return true; } }, 'provider exit', 3000);
      await query(['status', slug]);
      await query(['stop', slug]);
      await query(['stop', slug]);
      const history = await query(['history', slug, 'list']);
      assert.match(history, /workflow|execute|codex/i);
      const retained = fixture.terminal.history(slug);
      assert.equal(retained.ok, true);
      if (mode === 'tmux' && retained.ok) { assert.ok(retained.runs.some(run => run.record.terminalHost === 'tmux')); }
      const count = retained.ok ? retained.runs.length : 0;
      fs.rmSync(marker, { force: true });
      const restarted = invoke(['active', slug, '--implementer', 'codex']);
      await until(() => fs.existsSync(marker) || restarted.child.exitCode !== null, 'public active restart', 10000);
      assert.ok(fs.existsSync(marker), restarted.output());
      const replacement = (await fixture.service.current(slug))!;
      assert.ok(replacement && replacement.id !== original.id);
      await query(['stop', slug]);
      await restarted.exit;
      assert.equal(await fixture.service.current(slug), null);
      const after = fixture.terminal.history(slug);
      assert.ok(after.ok && after.runs.length > count);
      console.log(`[${mode}] CONFIRMED owner ${original.owner!.pid} and provider ${provider} stopped; history ${count} -> ${after.ok ? after.runs.length : 0}; restart ${replacement.id} settled; cleanup follows.`);
    } finally {
      for (const child of children) {
        if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); }
      }
      await fixture.close();
    }
  }
} finally { bundle.close(); }
