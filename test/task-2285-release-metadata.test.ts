// task-2285 — release metadata for the canonical ESM bundle published to npm.
// (Hermetic: it reads committed files and build outputs, and crosses no process,
// Git, or network boundary, so it belongs in the default suite.)
//
// Covers ADR 0044 release gate 9 (license audit, checksums, SBOM, third-party
// notices) and the package-shape criteria that the audit script cannot express:
// package.json metadata, the bundle payload root, and the SEA-shared entry point.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ALLOWED_LICENSES,
  bundledPackages,
  licenseViolations,
  normalizeLicense,
  owningPackageLocation,
  renderNotices,
  renderSbom,
} = require('../scripts/release-metadata.ts');

const ROOT = path.resolve(__dirname, '..');
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
  assert.deepEqual(packageJson.files, ['NOTICES', 'build/', 'LICENSE', 'README.md', 'CHANGELOG.md']);
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

test('task-2285 checksum manifest covers every build/ file except itself', () => {
  const buildDir = path.join(ROOT, 'build');
  const recorded = new Map(
    fs.readFileSync(path.join(buildDir, 'manifest.sha256'), 'utf8')
      .split('\n').filter(Boolean)
      .map(line => { const [digest, ...rest] = line.split(/\s+/); return [rest.join(' '), digest]; }),
  );
  const walk = (dir: string, prefix = ''): string[] => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry: any) => (entry.isDirectory()
      ? walk(path.join(dir, entry.name), `${prefix}${entry.name}/`)
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
  assert.throws(() => bundledPackages(ROOT, {}), /requires the esbuild metafile/);
});

test('task-2285 notices deduplicate a shared license text across packages', () => {
  const fixture = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'px-notices-'));
  const packages = ['alpha', 'beta'].map(name => {
    const packageDir = path.join(fixture, 'node_modules', name);
    fs.mkdirSync(packageDir, { recursive: true });
    fs.writeFileSync(path.join(packageDir, 'LICENSE'), 'MIT License\n\nShared body.\n');
    return { name, version: '1.0.0', license: 'MIT', homepage: null, packageDir };
  });
  const notices = renderNotices(packages, packageJson);
  assert.equal(notices.split('Shared body.').length - 1, 1, 'identical texts appear once');
  assert.match(notices, /alpha@1\.0\.0 \(MIT\)\nbeta@1\.0\.0 \(MIT\)/);
  fs.rmSync(fixture, { recursive: true, force: true });
});

test('task-2285 SBOM records subresource hashes from the lockfile integrity', () => {
  const sbom = renderSbom(
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
