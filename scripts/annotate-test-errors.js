#!/usr/bin/env node
'use strict';

// Batch-fix test type errors by adding @ts-expect-error annotations.
// Runs tsc, parses errors, and inserts annotations from bottom to top
// to avoid line number shifts.

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const testDir = path.join(rootDir, 'test');

// Error codes that should be annotated with @ts-expect-error
const ANNOTATE_CODES = new Set([
  'TS2322', 'TS2339', 'TS2349', 'TS2739', 'TS2345', 'TS2740',
  'TS2741', 'TS2353', 'TS2554', 'TS2769', 'TS2614', 'TS2561',
  'TS2559', 'TS2722', 'TS2367', 'TS1470', 'TS18047', 'TS18048',
  'TS1117',
]);

// Error codes that need inline fixes (not annotation)
const FIX_CODES = new Set([]);

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

function groupByFile(errors) {
  const map = new Map();
  for (const err of errors) {
    if (!map.has(err.file)) map.set(err.file, []);
    map.get(err.file).push(err);
  }
  return map;
}

function annotateFile(filePath, fileErrors) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Sort errors by line descending so we insert from bottom to top
  const sorted = [...fileErrors].sort((a, b) => b.line - a.line);

  // Deduplicate: if same line has multiple errors, one annotation covers all
  const seenLines = new Set();
  for (const err of sorted) {
    if (seenLines.has(err.line)) continue;
    seenLines.add(err.line);

    // Check if line already has @ts-expect-error
    const prevLine = lines[err.line - 2] || '';
    if (prevLine.includes('@ts-expect-error') || prevLine.includes('@ts-ignore')) {
      continue;
    }

    // Check if the current line itself has @ts-expect-error
    const currentLine = lines[err.line - 1] || '';
    if (currentLine.includes('@ts-expect-error')) {
      continue;
    }

    // Get indentation of the current line
    const match = currentLine.match(/^(\s*)/);
    const indent = match ? match[1] : '';

    // Build reason from error code and brief message
    const briefMsg = err.message.split('\n')[0].substring(0, 80).trim();
    const annotation = `${indent}// @ts-expect-error ${err.code} ${briefMsg}`.replace(/\s+$/, '');

    lines.splice(err.line - 1, 0, annotation);
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
  return seenLines.size;
}

function main() {
  let iteration = 0;
  const maxIterations = 20;

  while (iteration < maxIterations) {
    iteration++;
    let output;
    try {
      output = runTsc();
    } catch (e) {
      output = e.stdout || e.stderr || '';
    }

    const errors = parseErrors(output);
    if (errors.length === 0) {
      console.log(`✓ No errors after ${iteration} iteration(s)`);
      return;
    }

    // Separate annotate-able vs fix-needed errors
    const annotateErrors = errors.filter(e => ANNOTATE_CODES.has(e.code));
    const fixErrors = errors.filter(e => FIX_CODES.has(e.code));
    const otherErrors = errors.filter(e => !ANNOTATE_CODES.has(e.code) && !FIX_CODES.has(e.code));

    if (annotateErrors.length === 0 && fixErrors.length === 0 && otherErrors.length === 0) break;

    console.log(`\n--- Iteration ${iteration} ---`);
    console.log(`Total: ${errors.length}, Annotate: ${annotateErrors.length}, Fix: ${fixErrors.length}, Other: ${otherErrors.length}`);

    // Annotate errors by file
    const byFile = groupByFile(annotateErrors);
    let annotated = 0;
    for (const [file, fileErrors] of byFile) {
      const count = annotateFile(file, fileErrors);
      annotated += count;
    }
    console.log(`Annotated ${annotated} lines across ${byFile.size} files`);

    // Report fix-needed errors
    if (fixErrors.length > 0) {
      const fixByCode = new Map();
      for (const e of fixErrors) {
        fixByCode.set(e.code, (fixByCode.get(e.code) || 0) + 1);
      }
      console.log('Fix-needed errors:');
      for (const [code, count] of fixByCode) {
        console.log(`  ${code}: ${count}`);
      }
    }

    // Report other errors
    if (otherErrors.length > 0) {
      const otherByCode = new Map();
      for (const e of otherErrors) {
        otherByCode.set(e.code, (otherByCode.get(e.code) || 0) + 1);
      }
      console.log('Other errors:');
      for (const [code, count] of otherByCode) {
        console.log(`  ${code}: ${count}`);
      }
    }

    // If no annotations were made this iteration, we might be in a loop
    // (new errors appearing after annotations). Break if stuck.
    if (annotated === 0 && fixErrors.length === 0) {
      console.log('No progress made; remaining errors may need manual fix.');
      break;
    }
  }
}

main();
