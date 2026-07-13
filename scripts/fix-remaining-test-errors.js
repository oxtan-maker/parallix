#!/usr/bin/env node
'use strict';

// Fix remaining TS18047/TS18048 (possibly null/undefined) and TS1117 errors.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');

function runTsc() {
  let output = '';
  try {
    output = execSync(
      'npx tsc --noEmit --project tsconfig.test.json 2>&1',
      { cwd: rootDir, encoding: 'utf8', shell: true, maxBuffer: 10 * 1024 * 1024 }
    );
  } catch (e) {
    output = e.stdout || e.stderr || '';
  }
  return output;
}

function parseErrors(output) {
  const lines = output.trim().split('\n');
  const errors = [];
  const re = /^(.+?)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.+)$/;
  for (const line of lines) {
    const m = line.match(re);
    if (m) {
      errors.push({
        file: m[1],
        line: parseInt(m[2], 10),
        col: parseInt(m[3], 10),
        code: m[4],
        message: m[5],
      });
    }
  }
  return errors;
}

// Fix TS18047/TS18048: add ! after the variable name
function fixNullableErrors(errors) {
  const nullableErrors = errors.filter(e => e.code === 'TS18047' || e.code === 'TS18048');
  const varRe = /'(.*?)' is possibly/;

  // Group by file
  const byFile = new Map();
  for (const err of nullableErrors) {
    if (!byFile.has(err.file)) byFile.set(err.file, []);
    byFile.get(err.file).push(err);
  }

  let fixed = 0;
  for (const [filePath, fileErrors] of byFile) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Process from bottom to top
    const sorted = [...fileErrors].sort((a, b) => b.line - a.line);
    for (const err of sorted) {
      const varMatch = err.message.match(varRe);
      if (!varMatch) continue;
      const varName = varMatch[1];

      const lineIdx = err.line - 1;
      const line = lines[lineIdx];

      // Find the variable at or near the column position
      // The error column points to the start of the variable
      const beforeCol = line.substring(0, err.col - 1);
      const fromCol = line.substring(err.col - 1);

      // Check if variable is already followed by !
      const afterVar = fromCol.substring(varName.length);
      if (afterVar.startsWith('!')) {
        continue; // Already fixed
      }

      // Replace the variable at the column position with varName + !
      // Need to be careful: the variable might appear multiple times on the line
      // Find the exact occurrence at the column
      let searchPos = err.col - 1;
      let foundPos = line.indexOf(varName, searchPos);
      if (foundPos === -1 || foundPos !== searchPos) {
        // Try searching from the start of the line portion after the column
        foundPos = line.indexOf(varName, Math.max(0, err.col - 1 - varName.length));
      }

      if (foundPos >= 0) {
        // Check character before varName is a word boundary
        const beforeChar = foundPos > 0 ? line[foundPos - 1] : '';
        const afterChar = line[foundPos + varName.length] || '';

        if (!/\w/.test(beforeChar) && !/\w/.test(afterChar)) {
          lines[lineIdx] = line.substring(0, foundPos + varName.length) + '!' + line.substring(foundPos + varName.length);
          fixed++;
        } else {
          console.log(`  WARN: Could not place ! for '${varName}' at ${filePath}:${err.line}:${err.col}`);
          console.log(`    Line: ${line.trim()}`);
        }
      } else {
        console.log(`  WARN: Could not find '${varName}' at ${filePath}:${err.line}:${err.col}`);
        console.log(`    Line: ${line.trim()}`);
      }
    }

    fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  }
  return fixed;
}

function main() {
  let output = runTsc();
  let errors = parseErrors(output);

  if (errors.length === 0) {
    console.log('No errors to fix.');
    return;
  }

  console.log(`Found ${errors.length} errors:`);
  const byCode = new Map();
  for (const e of errors) {
    byCode.set(e.code, (byCode.get(e.code) || 0) + 1);
  }
  for (const [code, count] of byCode) {
    console.log(`  ${code}: ${count}`);
  }

  // Fix nullable errors
  const nullableFixed = fixNullableErrors(errors);
  console.log(`Fixed ${nullableFixed} nullable errors`);

  // Re-run to check remaining
  output = runTsc();
  errors = parseErrors(output);
  console.log(`Remaining errors: ${errors.length}`);
  if (errors.length > 0) {
    for (const e of errors) {
      console.log(`  ${e.file}:${e.line} ${e.code} ${e.message.split('\n')[0].substring(0, 80)}`);
    }
  }
}

main();
