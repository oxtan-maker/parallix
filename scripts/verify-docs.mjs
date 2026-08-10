#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authoredDocs = [
  'README.md',
  'docs/authority-reference.md',
  'docs/use-cases.md',
  'docs/doc-standards.md'
];
const failures = [];

function report(file, line, message) {
  failures.push(`${file}:${line}: ${message}`);
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

function verifyImplementationEvidence(file, text) {
  const patterns = [
    { regex: /\b(?:src|lib)\/[A-Za-z0-9_./-]+(?::\d+)?/g, message: 'volatile source-path evidence is not allowed in authored docs' },
    { regex: /\btest\/[A-Za-z0-9_./-]+\.[cm]?[jt]sx?\b/g, message: 'volatile test-inventory evidence is not allowed in authored docs' }
  ];
  let inFence = false;
  for (const [index, rawLine] of text.split('\n').entries()) {
    if (/^\s*(?:```|~~~)/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = rawLine.replace(/https?:\/\/\S+/g, '');
    for (const { regex, message } of patterns) {
      for (const _match of line.matchAll(regex)) report(file, index + 1, message);
    }
  }
}

function verifyLinks(file, text) {
  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+['"][^)]*['"])?\)/g;
  for (const match of text.matchAll(linkPattern)) {
    let target = match[1].replace(/^<|>$/g, '');
    if (!target || target.startsWith('#') || /^(?:[a-z]+:|\/\/)/i.test(target)) continue;
    target = decodeURIComponent(target.split('#', 1)[0]);
    const resolved = path.resolve(repoRoot, path.dirname(file), target);
    if (!fs.existsSync(resolved)) report(file, lineNumber(text, match.index), `relative Markdown link target does not exist: ${match[1]}`);
  }
}

for (const file of authoredDocs) {
  const absolutePath = path.join(repoRoot, file);
  const text = fs.readFileSync(absolutePath, 'utf8');
  verifyImplementationEvidence(file, text);
  verifyLinks(file, text);
}

if (failures.length > 0) {
  console.error('FAIL: documentation drift checks failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('PASS: authored documentation contains no volatile implementation evidence and relative links resolve');
