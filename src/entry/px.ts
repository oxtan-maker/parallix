#!/usr/bin/env node

import { run } from '../platform/runtime/px.js';

process.setSourceMapsEnabled(true);

run().then(code => {
  process.exitCode = code;
});
