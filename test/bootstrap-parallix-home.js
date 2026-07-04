'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.PARALLIX_HOME) {
  process.env.PARALLIX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-test-home-'));
}

fs.mkdirSync(process.env.PARALLIX_HOME, { recursive: true });

const agentsLocalPath = path.join(process.env.PARALLIX_HOME, 'agents.local.json');
if (!fs.existsSync(agentsLocalPath)) {
  fs.writeFileSync(agentsLocalPath, '{"blocklist":{}}\n');
}
