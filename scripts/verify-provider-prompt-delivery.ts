/** Manual public-CLI smoke: disposable Git/database state and fake providers only. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seedMissionDatabase } from '../test/fixtures/review-state-db.js';
import { missionId, type Mission } from '../src/domain/mission.js';
import { agentFamily } from '../src/domain/agents.js';
import { changeRevision, reviewFindingId } from '../src/domain/review.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'px-prompt-manual-'));
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const large = 'café contract 🌍\n'.repeat(12000);
const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
process.once('exit', cleanup);
process.once('SIGINT', () => { cleanup(); process.exit(130); });
process.once('SIGTERM', () => { cleanup(); process.exit(143); });
try {
  for (const family of ['claude', 'opencode', 'qwen'] as const) {
    for (const role of ['review', 'act-on-review'] as const) {
      const directory = path.join(root, family, role);
      const slug = 'task-99991';
      const worktree = path.join(directory, 'repo');
      const bin = path.join(directory, 'bin');
      const home = path.join(directory, 'operator');
      const artifacts = path.join(worktree, '.workflow', 'review');
      fs.mkdirSync(artifacts, { recursive: true });
      fs.mkdirSync(bin, { recursive: true });
      const git = (args: string[]) => {
        const result = spawnSync('git', args, { cwd: worktree, encoding: 'utf8' });
        if (result.status !== 0) { throw new Error(result.stderr); }
        return result.stdout.trim();
      };
      git(['init', '-q', '-b', 'main']);
      git(['config', 'user.email', 'fixture@example.invalid']);
      git(['config', 'user.name', 'Disposable verification']);
      fs.writeFileSync(path.join(worktree, 'README.md'), 'Disposable prompt delivery fixture\n');
      fs.writeFileSync(path.join(worktree, '.gitignore'), '.workflow/\n');
      fs.mkdirSync(path.join(worktree, 'backlog', 'tasks'), { recursive: true });
      fs.writeFileSync(path.join(worktree, 'backlog', 'tasks', `${slug} - Fixture.md`), `---\nid: TASK-99991\ntitle: Fixture\nstatus: review\nassignee: [claude]\nlabels: [ai_sdlc]\n---\n`);
      fs.writeFileSync(path.join(worktree, 'workflow.config.json'), JSON.stringify({
        adapters: { review: { provider: 'none', tmpDir: artifacts },
          agents: { runners: { custom: 'opencode' },
            steps: { review: { eligible: ['claude', 'codex', 'qwen', 'custom'], selection: 'random' },
              'act-on-review': { eligible: ['claude', 'codex', 'qwen', 'custom'], selection: 'random' } } } },
      }));
      git(['add', '.']); git(['commit', '-qm', 'initial']);
      git(['checkout', '-qb', `mission/${slug}`]);
      const revision = git(['rev-parse', 'HEAD']);
      const receipt = path.join(artifacts, 'received');
      const providerExit = path.join(artifacts, 'provider-exit');
      const fallback = path.join(artifacts, 'pi-fallback');
      const observedFamily = path.join(artifacts, 'provider-family');
      const cli = [process.execPath, '--import', path.join(repository, 'node_modules/tsx/dist/loader.mjs'),
        path.join(repository, 'src/entry/px.ts')].map(quote).join(' ');
      const selected = family === 'opencode' ? 'custom' : family;
      const writes = role === 'review'
        ? `${cli} verdict approve --slug ${slug} --actor ${selected} --comment 'Disposable fake-provider smoke verdict'`
        : `${cli} resolve --slug ${slug} --actor ${selected} --blocked 'Disposable smoke simulates an unavailable external fixture dependency'`;
      for (const executable of ['claude', 'opencode', 'qwen', 'codex', 'vibe', 'pi']) {
        const content = executable === 'pi'
          ? `#!/bin/sh\ntouch ${quote(fallback)}\nexit 99\n`
          : `#!/bin/sh
set -eu
case "$*" in *--version*) echo 'fixture 1.0'; exit 0;; *--help*) echo '--format json'; exit 0;; esac
# Refuse additional launches rather than overwrite the measured first receipt.
(set -C; cat > ${quote(receipt)})
printf '%s' ${quote(executable)} > ${quote(observedFamily)}
${writes}
printf '0\n' > ${quote(providerExit)}
printf 'provider-receipt-complete\n'
exit 0
`;
        fs.writeFileSync(path.join(bin, executable), content, { mode: 0o700 });
      }
      const restore = await seedMissionDatabase(home, slug, worktree);
      try {
        const loaded = await restore.store.load(missionId(slug));
        if (loaded.kind !== 'found' || !loaded.mission.review) { throw new Error('fixture mission missing'); }
        const round = loaded.mission.review.rounds[0];
        const reviewer = role === 'review' ? selected : 'codex';
        const implementer = role === 'review' ? 'codex' : selected;
        const mission: Mission = { ...loaded.mission,
          brief: { goal: 'Verify oversized CLI delivery', why: 'No argv prompt', scope: 'Disposable state', outOfScope: ['Paid calls'] },
          checkpoints: [{ missionId: missionId(slug), name: 'CP-1', firstLine: 'Fixture proof',
            goalCheck: [{ criterion: 'fixture', evidence: large }], nextActionText: 'Inspect receipt' }],
          review: { ...loaded.mission.review, rounds: [{ ...round,
            reviewer: agentFamily(reviewer), implementer: agentFamily(implementer),
            subject: { ...round.subject, revision: changeRevision(revision) },
            ...(role === 'act-on-review' ? { phase: 'fixing' as const, disposition: 'REQUEST_CHANGES' as const,
              decision: { kind: 'changes-requested' as const, decidedAt: new Date().toISOString(),
                findings: [{ id: reviewFindingId('F1'), summary: 'Disposable fixture dependency', location: null }], comment: 'Disposable request' } } : {}),
          }] },
        };
        await restore.store.save(mission, loaded.version);
        const result = spawnSync(process.execPath,
          ['--import', path.join(repository, 'node_modules/tsx/dist/loader.mjs'), path.join(repository, 'src/entry/px.ts'),
            'review', slug, '--reviewer', reviewer, '--implementer', implementer, '--max-attempts', '1'],
          { cwd: worktree, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
            env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: directory, PARALLIX_HOME: home,
              OPENCODE_BIN: path.join(bin, 'opencode'), PARALLIX_NO_TUI: '1', PARALLIX_TEST_NO_FORGEJO: '1' } });
        if (!fs.existsSync(receipt)) { throw new Error(`${family}/${role}: no receipt\n${result.stdout}\n${result.stderr}`); }
        const received = fs.readFileSync(receipt, 'utf8');
        if (result.status !== 0 || fs.readFileSync(observedFamily, 'utf8') !== family
          || !received.includes(JSON.stringify(large).slice(1, -1)) || Buffer.byteLength(received) <= 188583
          || !fs.existsSync(providerExit) || fs.existsSync(fallback)) { throw new Error(`${family}/${role}: invalid delivery (${Buffer.byteLength(received)} bytes, provider exit recorded=${fs.existsSync(providerExit)}, fallback=${fs.existsSync(fallback)})\n${result.stdout}\n${result.stderr}`); }
        console.log(JSON.stringify({ family, role, bytes: Buffer.byteLength(received), providerExit: 0,
          cliExit: result.status, piFallback: false, cliDiagnostic: result.status ? result.stdout + result.stderr : undefined }));
      } finally { await restore(); }
    }
  }
} finally { cleanup(); }
