import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import process from 'node:process';
import React from 'react';
import {render, Text} from 'ink';
import {logicalAsset} from './asset.js';

const mode = process.argv.includes('--mode=tty') ? 'tty' : 'headless';

function forcedSourceMappedError(): never {
  throw new Error('TASK-2277 intentional source-map error');
}

function runProof(): string {
  const db = new DatabaseSync(':memory:');
  const sqliteValue = db.prepare('select 44 as value').get() as {value: number};
  db.close();

  const assetDigest = createHash('sha256').update(logicalAsset.text).digest('hex').slice(0, 12);
  const subprocessVersion = execFileSync(process.execPath, ['--version'], {encoding: 'utf8'}).trim();
  return JSON.stringify({
    inkInitialized: false,
    logicalAssetKey: logicalAsset.key,
    assetDigest,
    sqliteValue: sqliteValue.value,
    subprocessVersion,
  });
}

if (process.argv.includes('--force-error')) {
  forcedSourceMappedError();
}

if (mode === 'tty') {
  const inkApp = render(<Text>TASK-2277 Ink proof</Text>);
  inkApp.unmount();
  console.log(JSON.stringify({inkInitialized: true}));
} else {
  console.log(runProof());
}
