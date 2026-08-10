// Release metadata for the canonical ESM bundle (TASK-2285, ADR 0044 §"Verification
// and release gates" item 9: "locked dependencies, vulnerability/license audits,
// checksums, SBOM, and third-party notices").
//
// The published tarball ships only build/ plus LICENSE, README.md and
// NOTICES; it installs no node_modules. The third-party code that reaches a user is
// therefore exactly the set esbuild inlined into build/px.mjs, and the build's
// metafile is the authoritative record of that set — not package.json's dependency
// list, which also covers build-only and optional runtime packages. This module
// derives the bundled closure from the metafile, cross-references package-lock.json
// for integrity hashes, and emits:
//
//   NOTICES         third-party notices, license texts deduplicated by content
//   build/sbom.json CycloneDX 1.5 software bill of materials
//
// scripts/build-canonical-bundle.ts calls generateReleaseMetadata() after staging the
// bundle and before writing build/manifest.sha256, so the checksum manifest covers the
// SBOM too.

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

// SPDX identifiers accepted in a package published under AGPL-3.0-or-later.
// A dependency outside this set is a license-audit violation: it must be removed,
// replaced, or the list extended by an explicit licensing decision.
const ALLOWED_LICENSES = new Set([
  // BlueOak-1.0.0 is the OSI-approved permissive license used by the glob/minipass
  // family; it imposes no copyleft or attribution-beyond-notice obligation.
  '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause', 'CC0-1.0', 'ISC', 'MIT',
  'MIT-0', 'MPL-2.0', 'Python-2.0', 'Unlicense', 'WTFPL',
  '(MIT OR CC0-1.0)', '(MIT OR Apache-2.0)', '(Apache-2.0 OR MPL-1.1)',
  'AGPL-3.0-or-later',
]);

const LICENSE_FILE_PATTERN = /^(LICENSE|LICENCE|COPYING|NOTICE)(\.\w+)?$/i;

/**
 * Owning package directory for a bundle input path, or null for first-party source.
 *
 * esbuild reports inputs as repo-relative paths. Everything under node_modules
 * belongs to a third-party package; the owning directory is the last
 * `node_modules/<name>` (or `node_modules/@scope/<name>`) segment on the path,
 * which correctly attributes nested (non-hoisted) copies to themselves.
 */
function owningPackageLocation(inputPath: string): string | null {
  const segments = inputPath.split('/');
  let location: string | null = null;
  for (let index = 0; index < segments.length; index += 1) {
    if (segments[index] !== 'node_modules') { continue; }
    const scoped = (segments[index + 1] || '').startsWith('@');
    const end = index + (scoped ? 3 : 2);
    if (end > segments.length) { continue; }
    location = segments.slice(0, end).join('/');
  }
  return location;
}

/** A third-party package statically inlined into the canonical bundle. */
interface BundledPackage {
  name: string;
  version: string;
  license: string;
  resolved: string | null;
  integrity: string | null;
  homepage: string | null;
  location: string;
  packageDir: string;
}

interface EsbuildMetafile { inputs: Record<string, unknown>; }

/**
 * Third-party packages statically inlined into the canonical bundle.
 *
 * @param rootDir repository root
 * @param metafile esbuild metafile from the canonical bundle build
 */
function bundledPackages(rootDir: string, metafile: EsbuildMetafile): BundledPackage[] {
  if (!metafile || typeof metafile.inputs !== 'object') {
    throw new Error('bundledPackages requires the esbuild metafile from the canonical bundle build');
  }
  const lock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));

  // The same name@version can be installed at several paths (npm nests
  // conflicting versions). Notices and SBOM components are per released
  // artifact, not per install path: dedupe on identity.
  const byIdentity = new Map<string, BundledPackage>();
  for (const inputPath of Object.keys(metafile.inputs)) {
    const location = owningPackageLocation(inputPath.split(path.sep).join('/'));
    if (location === null) { continue; }
    const packageDir = path.join(rootDir, location);
    const manifestPath = path.join(packageDir, 'package.json');
    if (!fs.existsSync(manifestPath)) { continue; }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const identity = `${manifest.name}@${manifest.version}`;
    if (byIdentity.has(identity)) { continue; }
    const lockEntry = (lock.packages || {})[location] || {};
    byIdentity.set(identity, {
      name: manifest.name || path.basename(location),
      version: manifest.version || '0.0.0',
      license: normalizeLicense(manifest.license || manifest.licenses || lockEntry.license),
      resolved: lockEntry.resolved || null,
      integrity: lockEntry.integrity || null,
      homepage: manifest.homepage || repositoryUrl(manifest.repository) || null,
      location,
      packageDir,
    });
  }
  return [...byIdentity.values()]
    .sort((a, b) => (a.name === b.name ? a.version.localeCompare(b.version) : a.name.localeCompare(b.name)));
}

function normalizeLicense(license: unknown): string {
  if (typeof license === 'string') { return license; }
  if (Array.isArray(license)) { return license.map(item => (item && item.type) || String(item)).join(' OR '); }
  if (license && typeof license === 'object' && 'type' in license) { return String((license as { type: unknown }).type); }
  return 'UNKNOWN';
}

function repositoryUrl(repository: unknown): string | null {
  if (typeof repository === 'string') { return repository; }
  if (repository && typeof repository === 'object' && 'url' in repository) { return String((repository as { url: unknown }).url); }
  return null;
}

/** Dependencies whose declared license is outside ALLOWED_LICENSES. */
function licenseViolations(packages: BundledPackage[]): string[] {
  return packages
    .filter(entry => !ALLOWED_LICENSES.has(entry.license))
    .map(entry => `${entry.name}@${entry.version}: unapproved license ${entry.license}`);
}

function licenseText(packageDir: string): string | null {
  const candidates = fs.readdirSync(packageDir, { withFileTypes: true })
    .filter(item => item.isFile() && LICENSE_FILE_PATTERN.test(item.name))
    .map(item => item.name)
    .sort();
  if (candidates.length === 0) { return null; }
  return candidates
    .map(name => fs.readFileSync(path.join(packageDir, name), 'utf8').replace(/\r\n/g, '\n').trimEnd())
    .join('\n\n');
}

/**
 * Render NOTICES: an index of every bundled package, then each distinct license
 * text once, attributed to the packages that ship it.
 */
function renderNotices(packages: BundledPackage[], rootManifest: Record<string, string>): string {
  const lines = [
    `THIRD-PARTY NOTICES for ${rootManifest.name} ${rootManifest.version}`,
    '',
    `${rootManifest.name} itself is licensed under ${rootManifest.license}; see LICENSE.`,
    '',
    'The published package is a single bundled ESM payload (build/px.mjs). The',
    'third-party packages listed below are statically inlined into that payload by',
    'the build, so their notices are reproduced here. This file is generated by',
    'scripts/release-metadata.ts from package-lock.json; do not edit it by hand.',
    '',
    `Bundled third-party packages: ${packages.length}`,
    '',
    '='.repeat(78),
    'INDEX',
    '='.repeat(78),
    '',
  ];
  for (const entry of packages) {
    lines.push(`${entry.name}@${entry.version} — ${entry.license}${entry.homepage ? ` — ${entry.homepage}` : ''}`);
  }

  // Group by license text so a shared MIT body is reproduced once rather than
  // eighty times. Packages that ship no license file are reported by SPDX id only.
  const byText = new Map<string, { text: string; packages: BundledPackage[] }>();
  const withoutText: BundledPackage[] = [];
  for (const entry of packages) {
    const text = licenseText(entry.packageDir);
    if (text === null) { withoutText.push(entry); continue; }
    const key = crypto.createHash('sha256').update(text).digest('hex');
    if (!byText.has(key)) { byText.set(key, { text, packages: [] }); }
    byText.get(key).packages.push(entry);
  }

  lines.push('', '='.repeat(78), 'LICENSE TEXTS', '='.repeat(78));
  for (const { text, packages: covered } of [...byText.values()].sort(
    (a, b) => a.packages[0].name.localeCompare(b.packages[0].name),
  )) {
    lines.push('', '-'.repeat(78));
    for (const entry of covered) { lines.push(`${entry.name}@${entry.version} (${entry.license})`); }
    lines.push('-'.repeat(78), '', text);
  }

  if (withoutText.length > 0) {
    lines.push('', '='.repeat(78), 'PACKAGES WITHOUT A BUNDLED LICENSE FILE', '='.repeat(78), '');
    lines.push('These packages declare an SPDX license identifier but ship no license file;');
    lines.push('the canonical text is the published SPDX text for the identifier shown.', '');
    for (const entry of withoutText) {
      lines.push(`${entry.name}@${entry.version} — ${entry.license}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/** CycloneDX 1.5 SBOM. Deterministic: no timestamp, no serial number, sorted components. */
function renderSbom(packages: BundledPackage[], rootManifest: Record<string, string>): Record<string, unknown> {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        'bom-ref': `pkg:npm/${rootManifest.name}@${rootManifest.version}`,
        name: rootManifest.name,
        version: rootManifest.version,
        licenses: [{ license: { id: rootManifest.license } }],
        description: rootManifest.description,
      },
      tools: [{ name: 'scripts/release-metadata.ts', vendor: rootManifest.name }],
    },
    components: packages.map(entry => ({
      type: 'library',
      'bom-ref': `pkg:npm/${entry.name}@${entry.version}`,
      name: entry.name,
      version: entry.version,
      purl: `pkg:npm/${entry.name}@${entry.version}`,
      licenses: [{ license: { name: entry.license } }],
      ...(entry.homepage ? { externalReferences: [{ type: 'website', url: entry.homepage }] } : {}),
      ...(entry.integrity ? { hashes: integrityHashes(entry.integrity) } : {}),
    })),
  };
}

function integrityHashes(integrity: string): Array<{ alg: string; content: string }> {
  return String(integrity).split(/\s+/).flatMap(item => {
    const [algorithm, value] = item.split('-');
    const alg = ({ sha512: 'SHA-512', sha256: 'SHA-256', sha1: 'SHA-1' } as Record<string, string>)[algorithm];
    if (!alg || !value) { return []; }
    return [{ alg, content: Buffer.from(value, 'base64').toString('hex') }];
  });
}

/**
 * Write NOTICES and build/sbom.json.
 *
 * @throws when a dependency's declared license is outside ALLOWED_LICENSES.
 */
function generateReleaseMetadata(rootDir: string, buildDir: string, metafile: EsbuildMetafile): BundledPackage[] {
  const rootManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const packages = bundledPackages(rootDir, metafile);

  const violations = licenseViolations(packages);
  if (violations.length > 0) {
    throw new Error(`License audit failed (ADR 0044 release gate 9):\n${violations.map(item => `- ${item}`).join('\n')}`);
  }

  fs.writeFileSync(path.join(rootDir, 'NOTICES'), renderNotices(packages, rootManifest));
  fs.mkdirSync(buildDir, { recursive: true });
  fs.writeFileSync(path.join(buildDir, 'sbom.json'), `${JSON.stringify(renderSbom(packages, rootManifest), null, 2)}\n`);
  return packages;
}

// Not runnable standalone: the metafile only exists inside a bundle build.
// `npm run build` (and therefore `prepack`) regenerates NOTICES and build/sbom.json.
export {
  ALLOWED_LICENSES,
  bundledPackages,
  generateReleaseMetadata,
  licenseViolations,
  normalizeLicense,
  owningPackageLocation,
  renderNotices,
  renderSbom,
};
export type { BundledPackage };
