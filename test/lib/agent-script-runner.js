#!/usr/bin/env node
import path from 'node:path';

const launchers = JSON.parse(process.env.PARALLIX_TEST_LAUNCHERS || '{}');
const body = launchers[path.basename(process.argv[1])] || launchers[path.basename(process.argv0)];

if (typeof body !== 'string') {
  process.exit(0);
}

// eslint-disable-next-line no-eval
eval(body);
