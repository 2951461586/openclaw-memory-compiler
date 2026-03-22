#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const pkgPath = path.join(root, 'package.json');
const manifestPath = path.join(root, 'openclaw.plugin.json');
const readmePath = path.join(root, 'README.md');
const migrationPath = path.join(root, 'MIGRATION.md');
const licensePath = path.join(root, 'LICENSE');
const changelogPath = path.join(root, 'CHANGELOG.md');
const docsReadmePath = path.join(root, 'docs', 'README.md');
const docsConfigPath = path.join(root, 'docs', 'CONFIG.md');
const docsFaqPath = path.join(root, 'docs', 'FAQ.md');
const docsPublishingPath = path.join(root, 'docs', 'PUBLISHING.md');
const cleanInstallSmokePath = path.join(root, 'scripts', 'memory-compiler', 'clean-install-smoke.mjs');
const trustedInstallSmokePath = path.join(root, 'scripts', 'memory-compiler', 'trusted-install-smoke.mjs');
const testDir = path.join(root, 'test');

function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

const checks = [];
function check(name, ok, details = {}) { checks.push({ name, ok, ...details }); }

const pkg = exists(pkgPath) ? readJson(pkgPath) : null;
const manifest = exists(manifestPath) ? readJson(manifestPath) : null;

check('package-json-present', !!pkg, { path: pkgPath });
check('plugin-manifest-present', !!manifest, { path: manifestPath });
check('readme-present', exists(readmePath), { path: readmePath });
check('migration-doc-present', exists(migrationPath), { path: migrationPath });
check('license-present', exists(licensePath), { path: licensePath });
check('changelog-present', exists(changelogPath), { path: changelogPath });
check('docs-readme-present', exists(docsReadmePath), { path: docsReadmePath });
check('docs-config-present', exists(docsConfigPath), { path: docsConfigPath });
check('docs-faq-present', exists(docsFaqPath), { path: docsFaqPath });
check('docs-publishing-present', exists(docsPublishingPath), { path: docsPublishingPath });
check('clean-install-smoke-present', exists(cleanInstallSmokePath), { path: cleanInstallSmokePath });
check('trusted-install-smoke-present', exists(trustedInstallSmokePath), { path: trustedInstallSmokePath });
check('tests-present', exists(testDir) && fs.readdirSync(testDir).some(x => x.endsWith('.mjs')), { path: testDir });

if (pkg) {
  check('package-not-private', pkg.private !== true, { private: pkg.private === true });
  check('package-has-license', typeof pkg.license === 'string' && pkg.license.trim().length > 0, { license: pkg.license || null });
  check('package-has-bin', !!pkg.bin && !!pkg.bin['memory-compiler'], { bin: pkg.bin || null });
  check('package-has-openclaw-extension', Array.isArray(pkg.openclaw?.extensions) && pkg.openclaw.extensions.length >= 1, { openclaw: pkg.openclaw || null });
  check('package-has-peer-openclaw', typeof pkg.peerDependencies?.openclaw === 'string', { peerDependencies: pkg.peerDependencies || null });
  check('package-has-author', typeof pkg.author === 'string' && pkg.author.trim().length > 0, { author: pkg.author || null });
  check('package-has-keywords', Array.isArray(pkg.keywords) && pkg.keywords.length >= 3, { keywords: pkg.keywords || [] });
  check('package-has-install-smoke', typeof pkg.scripts?.['smoke:install'] === 'string', { smokeInstall: pkg.scripts?.['smoke:install'] || null });
  check('package-has-clean-install-smoke', typeof pkg.scripts?.['smoke:clean-install'] === 'string', { cleanInstallSmoke: pkg.scripts?.['smoke:clean-install'] || null });
  check('package-has-trusted-install-smoke', typeof pkg.scripts?.['smoke:trusted-install'] === 'string', { trustedInstallSmoke: pkg.scripts?.['smoke:trusted-install'] || null });
  check('package-has-test-script', typeof pkg.scripts?.test === 'string', { test: pkg.scripts?.test || null });
}

if (manifest) {
  check('manifest-has-id', typeof manifest.id === 'string' && manifest.id === 'memory-compiler', { id: manifest.id || null });
  check('manifest-has-version', typeof manifest.version === 'string' && manifest.version.length > 0, { version: manifest.version || null });
  check('manifest-has-configSchema', !!manifest.configSchema && typeof manifest.configSchema === 'object', {});
}

if (pkg && manifest) {
  check('package-and-manifest-version-match', pkg.version === manifest.version, {
    packageVersion: pkg.version || null,
    manifestVersion: manifest.version || null,
  });
}

const failed = checks.filter(x => !x.ok);
const out = {
  ok: failed.length === 0,
  root,
  checks,
  failedCount: failed.length,
  failed,
};
process.stdout.write(JSON.stringify(out, null, 2) + '\n');
if (failed.length > 0) process.exitCode = 1;
