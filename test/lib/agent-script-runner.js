#!/usr/bin/env node
'use strict';

const path = require('path');

const launchers = JSON.parse(process.env.PARALLIX_TEST_LAUNCHERS || '{}');
const body = launchers[path.basename(process.argv[1])] || launchers[path.basename(process.argv0)];

if (typeof body !== 'string') {
  process.exit(0);
}

// The test owns these bodies. This runner is deliberately a stable executable
// so unit tests do not create a new macOS-validated executable per launch.
// eslint-disable-next-line no-eval
eval(body);
