#!/usr/bin/env node
// Git compatibility shim for the unit-test PATH (see bootstrap-parallix-home.js).
// macOS still ships Git 2.24 on some supported workstations, whose `git init`
// lacks `-b`. This shim rewrites that one spelling and forwards everything else
// to the real executable named by PARALLIX_TEST_REAL_GIT.
import cp from 'node:child_process';

const args = process.argv.slice(2);
const realGit = process.env.PARALLIX_TEST_REAL_GIT;
const initIndex = args.indexOf('init');

if (initIndex !== -1 && args[initIndex + 1] === '-b' && args[initIndex + 2]) {
  const branch = args[initIndex + 2];
  const initArgs = [...args.slice(0, initIndex), 'init', ...args.slice(initIndex + 3)];
  const init = cp.spawnSync(realGit, initArgs, { stdio: 'inherit' });
  if (init.status !== 0) { process.exit(init.status || 1); }
  const cwdIndex = initArgs.indexOf('-C');
  const target = cwdIndex !== -1
    ? initArgs[cwdIndex + 1]
    : (initArgs.length > 1 ? initArgs[initArgs.length - 1] : process.cwd());
  const checkout = cp.spawnSync(realGit, ['-C', target, 'checkout', '-b', branch], { stdio: 'inherit' });
  process.exit(checkout.status || 0);
}

const result = cp.spawnSync(realGit, args, { stdio: 'inherit' });
process.exit(result.status || 0);
