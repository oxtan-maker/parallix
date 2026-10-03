// Behavior-owned suite (TASK-2622.17, unit): the published package and canonical bundle, its release
// metadata, and release publication trust. Hermetic: reads committed files and build output and uses
// injected process runners, so it crosses no process, Git, or network boundary. Legacy case names unchanged.
//
// Sections keep their historical provenance:
//   task-2285 release metadata (was test/task-2285-release-metadata.test.ts)
//   task-2381 SEA payload kept out of the tarball (was test/task-2381-repro.test.ts)
//   task-1391 import-equals syntax guard (was test/task-1391-import-equals-syntax.test.ts)
//   task-2288 canonical bundle as the sole executable target (was test/task-2279-assets-and-rollback-shim.test.ts)
//   task-2509 release publication trust (was test/task-2509-release-publish.test.ts)
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ALLOWED_LICENSES,
  bundledPackages,
  licenseViolations,
  normalizeLicense,
  owningPackageLocation,
  renderNotices,
  renderSbom,
} from '../scripts/release-metadata.js';
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
import { violationsFor } from '../scripts/package-content-audit.ts';
import { isNewerNormalVersion, parseNormalVersion, publishTrustedRelease, validateMetadata, validateTrustedRelease } from '../scripts/release-publish.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';

// ---- task-2285 release metadata for the canonical ESM bundle ----
describe('task-2285 release metadata for the canonical ESM bundle', () => {
  // task-2285 — release metadata for the canonical ESM bundle published to npm.
  // (Hermetic: it reads committed files and build outputs, and crosses no process,
  // Git, or network boundary, so it belongs in the default suite.)
  //
  // Covers ADR 0044 release gate 9 (license audit, checksums, SBOM, third-party
  // notices) and the package-shape criteria that the audit script cannot express:
  // package.json metadata, the bundle payload root, and the SEA-shared entry point.
  const ROOT = path.resolve(import.meta.dirname, '..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

  test('task-2285 package metadata declares the CLI-only ESM boundary', () => {
    assert.equal(packageJson.type, 'module');
    assert.equal(packageJson.bin.px, 'build/px.mjs');
    assert.equal(packageJson.engines.node, '>=22.23.1');
    assert.equal(Object.hasOwn(packageJson, 'main'), false, 'no programmatic main entry');
    assert.equal(Object.hasOwn(packageJson, 'exports'), false, 'no root export map');
    assert.equal(Object.hasOwn(packageJson, 'types'), false, 'no published declarations');
    // No runtime install closure: everything reachable is bundled, and the one
    // dynamically imported agent SDK is an explicitly optional peer.
    assert.equal(Object.hasOwn(packageJson, 'dependencies'), false);
    assert.equal(packageJson.peerDependenciesMeta['@earendil-works/pi-coding-agent'].optional, true);
  });

  test('task-2285 files allowlist ships only the bundle payload and release metadata', () => {
    // TASK-2381: the SEA payload under build/sea/ is negated out of the allowlist —
    // it ships via scripts/package-native-release.ts and build/manifest.sha256
    // deliberately does not cover it.
    assert.deepEqual(packageJson.files, ['NOTICES', 'build/', '!build/sea', 'LICENSE', 'README.md']);
  });

  test('task-2285 bin path is the bundler entry point reused as SEA input', () => {
    const bundler = fs.readFileSync(path.join(ROOT, 'scripts', 'build-canonical-bundle.ts'), 'utf8');
    assert.match(bundler, /const output = path\.join\(buildDir, 'px\.mjs'\)/);
    assert.match(bundler, /outfile: output/);
    assert.equal(packageJson.bin.px, 'build/px.mjs');
    assert.ok(fs.existsSync(path.join(ROOT, packageJson.bin.px)), 'bin target must exist after npm run build');
  });

  test('task-2285 build/ is a self-contained payload root with staged runtime assets', () => {
    const marker = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'package.json'), 'utf8'));
    assert.equal(marker.name, packageJson.name, 'packageRoot() anchors asset resolution on this name');
    assert.equal(marker.type, 'module');
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'asset-manifest.json'), 'utf8'));
    for (const asset of manifest.assets) {
      const staged = path.join(ROOT, 'build', asset.key);
      assert.ok(fs.existsSync(staged), `${asset.key} must be staged under build/`);
      assert.equal(
        crypto.createHash('sha256').update(fs.readFileSync(staged)).digest('hex'),
        asset.sha256,
        `${asset.key} staged copy must match the manifest digest`,
      );
    }
  });

  test('task-2285 build/ stages every canonical SQLite migration byte-for-byte', () => {
    const sourceDir = path.join(ROOT, 'src', 'adapters', 'sqlite', 'migrations');
    const stagedDir = path.join(ROOT, 'build', 'migrations');
    const sourceFiles = fs.readdirSync(sourceDir).filter(file => file.endsWith('.sql')).sort();
    assert.deepEqual(
      fs.readdirSync(stagedDir).filter(file => file.endsWith('.sql')).sort(),
      sourceFiles,
      'the published CLI must carry the complete operator-schema migration set',
    );
    for (const file of sourceFiles) {
      assert.deepEqual(
        fs.readFileSync(path.join(stagedDir, file)),
        fs.readFileSync(path.join(sourceDir, file)),
        `${file} must retain its immutable source bytes in build/`,
      );
    }
  });

  test('task-2285 checksum manifest covers every build/ file except itself', () => {
    const buildDir = path.join(ROOT, 'build');
    const recorded = new Map(
      fs.readFileSync(path.join(buildDir, 'manifest.sha256'), 'utf8')
        .split('\n').filter(Boolean)
        .map(line => { const [digest, ...rest] = line.split(/\s+/); return [rest.join(' '), digest]; }),
    );
    const walk = (dir: string, prefix = ''): string[] => fs.readdirSync(dir, { withFileTypes: true })
      .flatMap((entry: any) => (entry.isDirectory()
        ? (entry.name === 'sea' ? [] : walk(path.join(dir, entry.name), `${prefix}${entry.name}/`))
          // build/sea is owned by the SEA build script and is not part of the
          // canonical bundle's checksum manifest (task-2286).
        : [`${prefix}${entry.name}`]));
    const present = walk(buildDir).filter(file => file !== 'manifest.sha256').sort();
    assert.deepEqual(present, [...recorded.keys()].sort(), 'manifest must list exactly the build outputs');
    for (const file of present) {
      assert.equal(
        crypto.createHash('sha256').update(fs.readFileSync(path.join(buildDir, file))).digest('hex'),
        recorded.get(file),
        `${file} digest must match manifest.sha256`,
      );
    }
  });

  test('task-2285 SBOM and NOTICES describe the same bundled package set', () => {
    const sbom = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'sbom.json'), 'utf8'));
    const notices = fs.readFileSync(path.join(ROOT, 'NOTICES'), 'utf8');
    assert.equal(sbom.bomFormat, 'CycloneDX');
    assert.equal(sbom.specVersion, '1.5');
    assert.equal(sbom.metadata.component.name, packageJson.name);
    assert.ok(sbom.components.length > 0, 'the Ink runtime is bundled, so the SBOM is non-empty');
    assert.match(notices, new RegExp(`Bundled third-party packages: ${sbom.components.length}\\b`));
    // js/incomplete-sanitization: the .replace() calls escape RegExp metacharacters
    // so the constructed pattern matches a literal package name; output feeds an
    // assert.match, not a shell or a browser. No injection surface, test-only.
    for (const component of sbom.components) {
      assert.match(notices, new RegExp(`${component.name.replace(/[/@.]/g, '\\$&')}@${component.version.replace(/\./g, '\\.')}`));
    }
    // ink and react are the reason the bundle is not first-party-only (TASK-2282).
    const names = sbom.components.map((component: any) => component.name);
    assert.ok(names.includes('ink'));
    assert.ok(names.includes('react'));
    // The pi coding-agent SDK is loaded through an opaque dynamic import, so it is
    // not inlined and must not be claimed as bundled content.
    assert.equal(names.includes('@earendil-works/pi-coding-agent'), false);
  });

  test('task-2285 every bundled package carries an approved license', () => {
    const sbom = JSON.parse(fs.readFileSync(path.join(ROOT, 'build', 'sbom.json'), 'utf8'));
    const packages = sbom.components.map((component: any) => ({
      name: component.name,
      version: component.version,
      license: component.licenses[0].license.name,
    }));
    assert.deepEqual(licenseViolations(packages), []);
  });

  test('task-2285 license audit rejects an unapproved dependency license', () => {
    assert.equal(ALLOWED_LICENSES.has('GPL-3.0-only'), false);
    assert.deepEqual(
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      licenseViolations([{ name: 'copyleft-lib', version: '1.0.0', license: 'GPL-3.0-only' }]),
      ['copyleft-lib@1.0.0: unapproved license GPL-3.0-only'],
    );
  });

  test('task-2285 bundled-package discovery attributes nested copies to themselves', () => {
    assert.equal(owningPackageLocation('src/entry/px.ts'), null);
    assert.equal(owningPackageLocation('node_modules/ink/build/index.js'), 'node_modules/ink');
    assert.equal(
      owningPackageLocation('node_modules/@alcalzone/ansi-tokenize/dist/index.js'),
      'node_modules/@alcalzone/ansi-tokenize',
    );
    assert.equal(
      owningPackageLocation('node_modules/ink/node_modules/string-width/index.js'),
      'node_modules/ink/node_modules/string-width',
    );
  });

  test('task-2285 release metadata requires the bundle metafile', () => {
    assert.throws(() => bundledPackages(ROOT, undefined), /requires the esbuild metafile/);
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    assert.throws(() => bundledPackages(ROOT, {}), /requires the esbuild metafile/);
  });

  test('task-2285 notices deduplicate a shared license text across packages', () => {
    const fixture = registeredMkdtemp('px-notices-');
    const packages = ['alpha', 'beta'].map(name => {
      const packageDir = path.join(fixture, 'node_modules', name);
      fs.mkdirSync(packageDir, { recursive: true });
      fs.writeFileSync(path.join(packageDir, 'LICENSE'), 'MIT License\n\nShared body.\n');
      return { name, version: '1.0.0', license: 'MIT', homepage: null, packageDir };
    });
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
    const notices = renderNotices(packages, packageJson);
    assert.equal(notices.split('Shared body.').length - 1, 1, 'identical texts appear once');
    assert.match(notices, /alpha@1\.0\.0 \(MIT\)\nbeta@1\.0\.0 \(MIT\)/);
    fs.rmSync(fixture, { recursive: true, force: true });
  });

  test('task-2285 SBOM records subresource hashes from the lockfile integrity', () => {
    const sbom = renderSbom(
  // @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      [{
        name: 'ink', version: '6.8.0', license: 'MIT', homepage: null,
        integrity: 'sha512-AAAAAA==',
      }],
      packageJson,
    );
    assert.equal(sbom.components[0].purl, 'pkg:npm/ink@6.8.0');
    assert.equal(sbom.components[0].hashes[0].alg, 'SHA-512');
    assert.equal(sbom.components[0].hashes[0].content, Buffer.from('AAAAAA==', 'base64').toString('hex'));
  });

  test('task-2285 normalizes the legacy license manifest spellings', () => {
    assert.equal(normalizeLicense('MIT'), 'MIT');
    assert.equal(normalizeLicense({ type: 'ISC' }), 'ISC');
    assert.equal(normalizeLicense([{ type: 'MIT' }, { type: 'Apache-2.0' }]), 'MIT OR Apache-2.0');
    assert.equal(normalizeLicense(undefined), 'UNKNOWN');
    assert.equal(ALLOWED_LICENSES.has('UNKNOWN'), false, 'an undeclared license fails the audit');
  });
});

// ---- task-2381 SEA payload never reaches the npm tarball ----
describe('task-2381 SEA payload never reaches the npm tarball', () => {
  // TASK-2381 reproduction: the SEA payload under build/sea/ must never reach the
  // npm tarball. build/sea/ is written by scripts/build-sea.ts and released via
  // scripts/package-native-release.ts; build/manifest.sha256 deliberately does not
  // cover it, so a packed build/sea/** made checksumViolations() fail publishing.
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  const PACKAGE_FILES_WITH_SEA = [
    'build/px.mjs',
    'build/px.mjs.map',
    'build/asset-manifest.json',
    'build/manifest.sha256',
    'build/package.json',
    'build/sbom.json',
    'build/config/x',
    'build/migrations/x',
    'build/prompts/x',
    'build/templates/x',
    'package.json',
    'README.md',
    'LICENSE',
    'NOTICES',
    'build/sea/px',
    'build/sea/manifest.sha256',
  ];

  test('violationsFor flags build/sea payload files as forbidden package files', () => {
    const violations = violationsFor(PACKAGE_FILES_WITH_SEA);
    assert.ok(
      violations.includes('forbidden package file: build/sea/px'),
      `expected build/sea/px to be forbidden, got: ${JSON.stringify(violations)}`,
    );
    assert.ok(
      violations.includes('forbidden package file: build/sea/manifest.sha256'),
      `expected build/sea/manifest.sha256 to be forbidden, got: ${JSON.stringify(violations)}`,
    );
    // The negation must not eat the rest of the build/ payload.
    assert.deepEqual(
      violations.filter(violation => !violation.startsWith('forbidden package file: build/sea/')),
      [],
    );
  });

  test('package.json files allowlist negates the SEA payload directory', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    assert.ok(
      manifest.files.some((entry: string) => /^!build\/sea/.test(entry)),
      `expected a !build/sea negation in files, got: ${JSON.stringify(manifest.files)}`,
    );
    for (const required of ['build/', 'LICENSE', 'README.md', 'NOTICES']) {
      assert.ok(manifest.files.includes(required), `files must still contain ${required}`);
    }
  });
});

// ---- task-1391 runtime entry points avoid import-equals syntax ----
describe('task-1391 runtime entry points avoid import-equals syntax', () => {
  /**
   * Regression test for task-1391: TypeScript import-equals syntax errors.
   *
   * Node.js native TypeScript strip-only mode does not support the TypeScript
   * `import X = require(Y)` (import-equals) declaration or `export =` statements.
   * This test verifies that no such patterns remain in the runtime px.ts or
   * lib/index.ts,
   * which are the two files that serve as the entry point and barrel re-export.
   *
   * At the mission's parent commit (before the fix), this test fails because
   * the runtime px.ts contains `import missionStart = require('./lib/commands/mission-start.js')`
   * and runtime lib/index.ts contains ~19 import-equals declarations.
   *
   * After the fix, all import-equals declarations are replaced with standard ESM
   * imports and all export = statements are replaced with ESM named/default exports.
   */
  const repoRoot = path.resolve(import.meta.dirname, '..');
  const pxTsPath = path.join(repoRoot, 'src', 'entry', 'px.ts');
  const libIndexPath = path.join(repoRoot, 'src', 'interfaces', 'cli', 'runtime.ts');

  // Regex matches TypeScript import-equals: `import X = require('...')`
  // Also matches the variant: `import X = require("...")`
  const IMPORT_EQUALS_RE = /import\s+\w+\s*=\s*require\s*\(/;

  // Regex matches `export =` (but not `export {` or `export default`)
  const EXPORT_EQUALS_RE = /^export\s*=\s*/m;

  // Regex matches `export =` in a comment or string (negative filter)
  // We need to distinguish `export = fn` from `export { fn }`

  function readFileSafe(filePath) {
    try {
      return fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      return '';
    }
  }

  function findImportEqualsMatches(content, filePath) {
    const matches = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      if (IMPORT_EQUALS_RE.test(lines[i])) {
        matches.push({ lineNum, content: lines[i].trim() });
      }
    }
    return matches;
  }

  function findExportEqualsMatches(content, filePath) {
    const matches = [];
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1;
      const trimmed = lines[i].trim();
      // Match `export =` but not `export {` or `export default`
      if (/^export\s*=/.test(trimmed) && !/^export\s*\{/.test(trimmed)) {
        matches.push({ lineNum, content: trimmed });
      }
    }
    return matches;
  }

  test('px.ts must not contain import-equals declarations', () => {
    const content = readFileSafe(pxTsPath);
    const matches = findImportEqualsMatches(content, pxTsPath);
    assert.strictEqual(
      matches.length,
      0,
      `px.ts contains ${matches.length} import-equals declaration(s) which Node.js strip-only mode does not support:\n${matches.map(m => `  line ${m.lineNum}: ${m.content}`).join('\n')}`
    );
  });

  test('px.ts must not contain export = statements', () => {
    const content = readFileSafe(pxTsPath);
    const matches = findExportEqualsMatches(content, pxTsPath);
    assert.strictEqual(
      matches.length,
      0,
      `px.ts contains ${matches.length} export = statement(s):\n${matches.map(m => `  line ${m.lineNum}: ${m.content}`).join('\n')}`
    );
  });

  test('lib/index.ts must not contain import-equals declarations', () => {
    const content = readFileSafe(libIndexPath);
    const matches = findImportEqualsMatches(content, libIndexPath);
    assert.strictEqual(
      matches.length,
      0,
      `lib/index.ts contains ${matches.length} import-equals declaration(s) which Node.js strip-only mode does not support:\n${matches.map(m => `  line ${m.lineNum}: ${m.content}`).join('\n')}`
    );
  });

  test('lib/index.ts must not contain export = statements', () => {
    const content = readFileSafe(libIndexPath);
    const matches = findExportEqualsMatches(content, libIndexPath);
    assert.strictEqual(
      matches.length,
      0,
      `lib/index.ts contains ${matches.length} export = statement(s):\n${matches.map(m => `  line ${m.lineNum}: ${m.content}`).join('\n')}`
    );
  });
});

// ---- task-2288 canonical bundle is the sole executable package target ----
describe('task-2288 canonical bundle is the sole executable package target', () => {
  const ROOT = path.resolve(import.meta.dirname, '..');

  // TASK-2288 retired the transitional CommonJS rollback tree. The build no longer
  // emits dist/; build/px.mjs is the sole executable product target, and rollback
  // is the coherent phase documented in docs/npm-package-major-migration.md rather
  // than a second distribution shipped alongside the bundle.
  test('task-2288 build emits the canonical bundle as the sole executable package target', () => {
    for (const file of ['build/px.mjs', 'build/px.mjs.map']) {
      assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} must exist after npm run build`);
    }
    assert.ok(!fs.existsSync(path.join(ROOT, 'dist')),
      'the transitional CommonJS dist/ tree must not be emitted by the build');

    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.bin.px, 'build/px.mjs', 'package bin must point at the canonical bundle');
    assert.ok(!pkg.main, 'package must not declare a CommonJS main entry');
  });
});

// ---- task-2509 release publication trust ----
describe('task-2509 release publication trust', () => {
  test('task-2509: release metadata accepts only matching normal SemVer versions', () => {
    assert.deepEqual(parseNormalVersion('1.5.120'), [1, 5, 120]);
    assert.equal(parseNormalVersion('1.5.120-beta.1'), null);
    assert.equal(validateMetadata({ version: '1.5.120' }, { version: '1.5.120' }), '1.5.120');
    assert.throws(() => validateMetadata({ version: 'bad' }, { version: 'bad' }), /normal SemVer/);
    assert.throws(() => validateMetadata({ version: '1.5.120' }, { version: '1.5.119' }), /must match/);
  });

  test('task-2509: normal releases must advance the current normal release', () => {
    assert.equal(isNewerNormalVersion('1.5.120', '1.5.119'), true);
    assert.equal(isNewerNormalVersion('1.5.119', '1.5.119'), false);
    assert.equal(isNewerNormalVersion('1.5.118', '1.5.119'), false);
  });

  function withReleaseRoot(run: (root: string) => void) {
    const root = registeredMkdtemp('task-2509-release-');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '1.5.120' }));
    fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ version: '1.5.120' }));
    try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }

  test('task-2509: tag collision and another SHA publication fail closed', () => {
    withReleaseRoot(root => {
      const tagElsewhere = (command: string) => command === 'git'
        ? { status: 0, stdout: 'other-sha\n', stderr: '' }
        : { status: 1, stdout: '', stderr: 'E404 Not Found' };
      assert.throws(() => validateTrustedRelease(root, 'trusted-sha', tagElsewhere), /not trusted SHA/);

      const publishedElsewhere = (command: string, args: string[]) => {
        if (command === 'npm' && args[2] === 'gitHead') { return { status: 0, stdout: '"other-sha"', stderr: '' }; }
        if (command === 'npm' && args[1].includes('@1.5.120')) { return { status: 0, stdout: '"1.5.120"', stderr: '' }; }
        if (command === 'npm') { return { status: 0, stdout: '"1.5.119"', stderr: '' }; }
        return { status: 1, stdout: '', stderr: '' };
      };
      assert.throws(() => validateTrustedRelease(root, 'trusted-sha', publishedElsewhere), /different SHA/);
    });
  });

  test('task-2509: npm lookup errors fail closed', () => {
    withReleaseRoot(root => {
      assert.throws(
        () => validateTrustedRelease(root, 'trusted-sha', () => ({ status: 1, stdout: '', stderr: 'E503 registry unavailable' })),
        /npm view.*failed/,
      );
    });
  });

  test('task-2509: release flow publishes, tags, and creates the matching release', () => {
    withReleaseRoot(root => {
      const calls: string[][] = [];
      const run = (executable: string, args: string[]) => {
        calls.push([executable, ...args]);
        if (executable === 'npm' && args[0] === 'view' && args[1].includes('@1.5.120')) {
          return { status: 1, stdout: '', stderr: 'E404 Not Found' };
        }
        if (executable === 'npm' && args[0] === 'view') { return { status: 0, stdout: '"1.5.119"', stderr: '' }; }
        if (executable === 'git' && args[0] === 'rev-parse') { return { status: 1, stdout: '', stderr: '' }; }
        if (executable === 'gh' && args[0] === 'release' && args[1] === 'view') {
          return { status: 1, stdout: '', stderr: 'release not found' };
        }
        return { status: 0, stdout: '', stderr: '' };
      };
      publishTrustedRelease(root, 'trusted-sha', run);
      assert.deepEqual(calls.filter(call => call[0] === 'git' && call[1] === 'tag'), [['git', 'tag', 'v1.5.120', 'trusted-sha']]);
      assert.ok(calls.some(call => call.join(' ') === 'npm publish --access public --provenance --registry=https://registry.npmjs.org'));
      assert.ok(calls.some(call => call.join(' ') === 'gh release create v1.5.120 --target trusted-sha --generate-notes'));
    });
  });

  test('task-2509: rerun reuses the existing GitHub Release by its verified tag', () => {
    withReleaseRoot(root => {
      const calls: string[][] = [];
      const run = (executable: string, args: string[]) => {
        calls.push([executable, ...args]);
        if (executable === 'git') { return { status: 0, stdout: 'trusted-sha\n', stderr: '' }; }
        if (executable === 'npm' && args[2] === 'gitHead') { return { status: 0, stdout: '"trusted-sha"', stderr: '' }; }
        if (executable === 'npm' && args[0] === 'view') { return { status: 0, stdout: '"1.5.120"', stderr: '' }; }
        // A release whose stored targetCommitish is a branch name is still bound to its tag.
        if (executable === 'gh') { return { status: 0, stdout: 'tag: v1.5.120\ntarget: main\n', stderr: '' }; }
        return { status: 0, stdout: '', stderr: '' };
      };
      publishTrustedRelease(root, 'trusted-sha', run);
      assert.ok(!calls.some(call => call[0] === 'npm' && call[1] === 'publish'));
      assert.ok(!calls.some(call => call[0] === 'git' && (call[1] === 'tag' || call[1] === 'push')));
      assert.ok(!calls.some(call => call[0] === 'gh' && call[2] === 'create'));
    });
  });

  test('task-2509: rerun accepts publication and tag only for the same trusted SHA', () => {
    withReleaseRoot(root => {
      const sameSha = (command: string, args: string[]) => {
        if (command === 'git') { return { status: 0, stdout: 'trusted-sha\n', stderr: '' }; }
        if (args[2] === 'gitHead') { return { status: 0, stdout: '"trusted-sha"', stderr: '' }; }
        return { status: 0, stdout: '"1.5.120"', stderr: '' };
      };
      assert.deepEqual(validateTrustedRelease(root, 'trusted-sha', sameSha), {
        version: '1.5.120', tag: 'v1.5.120', alreadyPublished: true, tagExists: true,
      });
    });
  });
});
