#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const authoredDocs = [
  'README.md',
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

// npm manifest metadata must point at the operator-confirmed canonical
// location. Compare repository.url, homepage, and bugs.url against the local
// `git remote get-url origin` (no network) and fail on disagreement. npm URL
// fields and the Git remote may differ in transport syntax (git+https vs
// https) or a trailing .git; canonicalLocation() collapses those
// representational differences to the shared host + owner/repo so the same
// location compares equal regardless of field shape (a #readme fragment on
// homepage, an /issues suffix on bugs.url, a git+ prefix on repository.url).
function canonicalLocation(value) {
  // scp-style SSH remotes (git@host:owner/repo.git) are not parseable by
  // new URL(); collapse the leading user@host:path form to ssh:// so the
  // same location compares equal to an https field. Only representational
  // differences are folded here, per the mission transport-syntax rule.
  const normalized = value.replace(/^[^@/]+@([^:/]+):(.+)$/, 'ssh://$1/$2');
  let parsed;
  try {
    parsed = new URL(normalized);
  } catch {
    return null;
  }
  const segments = parsed.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/\.git$/, ''));
  const repoPath = segments.slice(0, 2).join('/');
  return `${parsed.hostname}/${repoPath}`.toLowerCase();
}

function originRemoteUrl(repoRoot) {
  // PARALLIX_ORIGIN_REMOTE_URL lets the verifier run against a synthetic
  // remote in tests without touching the checkout's actual origin. When
  // unset, the authoritative source is the local Git remote: this check is
  // offline by design and never makes an HTTP request.
  const override = process.env.PARALLIX_ORIGIN_REMOTE_URL;
  if (override) return override.trim();
  const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim();
}

const manifestPath = path.join(repoRoot, 'package.json');
if (fs.existsSync(manifestPath)) {
  const origin = originRemoteUrl(repoRoot);
  if (!origin) {
    report(
      'package.json',
      1,
      'npm metadata cannot be verified: no origin remote (set PARALLIX_ORIGIN_REMOTE_URL or configure git remote origin)',
    );
  } else {
    const originLocation = canonicalLocation(origin);
    if (!originLocation) {
      report(
        'package.json',
        1,
        `npm metadata origin remote "${origin}" is not a parseable URL; cannot verify manifest metadata`,
      );
    } else {
      const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      const manifestFields = {
        'repository.url': pkg.repository?.url,
        homepage: pkg.homepage,
        'bugs.url': pkg.bugs?.url,
      };
      for (const [field, value] of Object.entries(manifestFields)) {
        if (typeof value !== 'string' || !value.trim()) continue;
        const location = canonicalLocation(value);
        if (!location) {
          report(
            'package.json',
            1,
            `npm metadata field ${field} "${value}" is not a parseable URL`,
          );
        } else if (location !== originLocation) {
          report(
            'package.json',
            1,
            `npm metadata field ${field} "${value}" disagrees with origin remote "${origin}"`,
          );
        }
      }
    }
  }
}

for (const file of authoredDocs) {
  const absolutePath = path.join(repoRoot, file);
  if (!fs.existsSync(absolutePath)) {
    report(file, 1, 'authored doc listed in verify-docs.mjs no longer exists; remove it from authoredDocs or restore the file');
    continue;
  }
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
