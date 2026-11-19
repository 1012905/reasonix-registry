#!/usr/bin/env node
// Builds index.json from the four content directories.
//
// Determinism is part of the contract: the index carries no timestamp and every
// field is rebuilt from the manifests, so `--check` can fail a pull request
// whose index.json is stale. The digest algorithm is stated in README.md.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KIND_DIRS = Object.freeze({
  mcp: 'mcp',
  plugins: 'plugins',
  skills: 'skills',
  themes: 'themes',
});
const KIND_ORDER = ['mcp', 'plugins', 'skills', 'themes'];
const MANIFEST_NAME = Object.freeze({ plugins: 'plugin.json', skills: 'skill.json', themes: 'theme.json' });
const IGNORED_FILES = new Set(['.gitkeep', '.DS_Store', 'Thumbs.db']);
const SKIP_DIRS = new Set(['.git']);

const ID_RE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const LICENSE_RE = /^[A-Za-z0-9.+-]{2,64}$/;
const SHA_RE = /^[a-f0-9]{64}$/;
const PLATFORMS = new Set(['windows', 'macos', 'linux', 'any']);
const FRONTENDS = new Set(['studio', 'cli']);
const IMAGE_RE = /^(background|preview)\.(webp|png|jpg|jpeg)$/;

const CAPS = Object.freeze({
  mcp: { entryBytes: 32 * 1024, files: 1, fileBytes: 32 * 1024, binary: false },
  plugins: { entryBytes: 1024 * 1024, files: 200, fileBytes: 256 * 1024, binary: false },
  skills: { entryBytes: 256 * 1024, files: 64, fileBytes: 256 * 1024, binary: false },
  themes: { entryBytes: 8 * 1024 * 1024, files: 64, fileBytes: 8 * 1024 * 1024, binary: true },
});

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const rel = (...parts) => parts.join('/');

async function readText(file, label, errors) {
  try {
    return await readFile(file, 'utf8');
  } catch (err) {
    errors.push(`${label}: cannot read (${err.code ?? err.message})`);
    return null;
  }
}

async function readJson(file, label, errors) {
  const text = await readText(file, label, errors);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    errors.push(`${label}: invalid JSON (${err.message})`);
    return null;
  }
}

async function listDir(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
}

function checkCommon(manifest, id, label, errors) {
  if (manifest.id !== id) {
    errors.push(`${label}: id "${manifest.id}" must equal the entry name "${id}"`);
  }
  for (const field of ['version', 'minVersion']) {
    if (typeof manifest[field] !== 'string' || !SEMVER_RE.test(manifest[field])) {
      errors.push(`${label}: ${field} must be a semver string`);
    }
  }
  if (typeof manifest.license !== 'string' || !LICENSE_RE.test(manifest.license)) {
    errors.push(`${label}: license must be an SPDX identifier`);
  }
  const compat = manifest.compat;
  if (!compat || typeof compat !== 'object' || Array.isArray(compat)) {
    errors.push(`${label}: compat is required`);
    return;
  }
  for (const name of ['platforms', 'frontends']) {
    const list = compat[name];
    if (!Array.isArray(list) || list.length === 0) {
      errors.push(`${label}: compat.${name} must be a non-empty array`);
      continue;
    }
    const allowed = name === 'platforms' ? PLATFORMS : FRONTENDS;
    for (const value of list) {
      if (!allowed.has(value)) {
        errors.push(`${label}: compat.${name} has unknown value "${value}"`);
      }
    }
  }
}

function parseFrontmatter(text, label, errors) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) {
    errors.push(`${label}: missing YAML frontmatter`);
    return null;
  }
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    fields[key] = line
      .slice(colon + 1)
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1');
  }
  return fields;
}

function looksBinary(buf) {
  const limit = Math.min(buf.length, 8192);
  for (let i = 0; i < limit; i++) if (buf[i] === 0) return true;
  return false;
}

async function collectFiles(root, relDir, errors, label) {
  const files = [];
  async function walk(relPath) {
    const entries = await listDir(path.join(root, relPath));
    if (entries === null) {
      errors.push(`${label}: cannot list ${relPath}`);
      return;
    }
    for (const dirent of entries) {
      const childRel = rel(relPath, dirent.name);
      const childAbs = path.join(root, childRel);
      if (dirent.isSymbolicLink()) {
        errors.push(`${label}: ${childRel} is a symlink; content must be committed as files`);
        continue;
      }
      if (dirent.isDirectory()) {
        if (!SKIP_DIRS.has(dirent.name)) await walk(childRel);
        continue;
      }
      if (!dirent.isFile() || IGNORED_FILES.has(dirent.name)) continue;
      if (/[\r\n\t]/.test(dirent.name)) {
        errors.push(`${label}: ${childRel} has a control character in its name`);
        continue;
      }
      const info = await lstat(childAbs);
      const bytes = await readFile(childAbs);
      files.push({ path: childRel, size: info.size, sha256: sha256(bytes), bytes });
    }
  }
  await walk(relDir);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

async function finishEntry(kind, id, files, manifest, errors) {
  const label = `${KIND_DIRS[kind]}/${id}`;
  const caps = CAPS[kind];
  let totalBytes = 0;
  for (const file of files) {
    totalBytes += file.size;
    if (file.size > caps.fileBytes) {
      errors.push(`${label}: ${file.path} is ${file.size} bytes, over the ${caps.fileBytes} byte per-file cap`);
    }
    if (!caps.binary && looksBinary(file.bytes)) {
      errors.push(`${label}: ${file.path} looks binary; commit text only`);
    }
  }
  if (files.length > caps.files) {
    errors.push(`${label}: ${files.length} files, over the cap of ${caps.files}`);
  }
  if (totalBytes > caps.entryBytes) {
    errors.push(`${label}: ${totalBytes} bytes, over the ${caps.entryBytes} byte entry cap`);
  }
  const listing = files.map((file) => `${file.sha256}\t${file.path}\n`).join('');
  return {
    entry: {
      id,
      kind,
      version: manifest.version,
      url: kind === 'mcp' ? `mcp/${id}.json` : `${KIND_DIRS[kind]}/${id}/`,
      sha256: sha256(listing),
      files: files.map((file) => ({ path: file.path, sha256: file.sha256, size: file.size })),
      minVersion: manifest.minVersion,
      compat: {
        platforms: [...(manifest.compat?.platforms ?? [])],
        frontends: [...(manifest.compat?.frontends ?? [])],
      },
      license: manifest.license,
      revoked: false,
    },
    stats: { kind, id, files: files.length, bytes: totalBytes },
    manifest,
  };
}

async function loadSkill(root, id, errors) {
  const label = `skills/${id}`;
  const dir = path.join(root, 'skills', id);
  const manifest = await readJson(path.join(dir, 'skill.json'), `${label}/skill.json`, errors);
  if (!manifest) return null;
  checkCommon(manifest, id, `${label}/skill.json`, errors);

  const body = await readText(path.join(dir, 'SKILL.md'), `${label}/SKILL.md`, errors);
  if (body !== null) {
    const fields = parseFrontmatter(body, `${label}/SKILL.md`, errors);
    if (fields) {
      if (fields.name !== id) errors.push(`${label}/SKILL.md: frontmatter name must be "${id}"`);
      if (!fields.description) errors.push(`${label}/SKILL.md: frontmatter description is required`);
    }
  }
  const files = await collectFiles(root, `skills/${id}`, errors, label);
  const hasManifest = files.some((file) => file.path === `skills/${id}/skill.json`);
  const hasBody = files.some((file) => file.path === `skills/${id}/SKILL.md`);
  if (!hasManifest) errors.push(`${label}: skill.json is required`);
  if (!hasBody) errors.push(`${label}: SKILL.md is required`);
  return finishEntry('skills', id, files, manifest, errors);
}

async function loadTheme(root, id, errors) {
  const label = `themes/${id}`;
  const dir = path.join(root, 'themes', id);
  const manifest = await readJson(path.join(dir, 'theme.json'), `${label}/theme.json`, errors);
  if (!manifest) return null;
  checkCommon(manifest, id, `${label}/theme.json`, errors);

  if (manifest.schemaVersion !== 1) {
    errors.push(`${label}/theme.json: schemaVersion must be 1`);
  }
  const tokens = manifest.tokens;
  for (const scheme of ['light', 'dark']) {
    const set = tokens?.[scheme];
    if (!set || typeof set !== 'object' || Object.keys(set).length === 0) {
      errors.push(`${label}/theme.json: tokens.${scheme} must name at least one colour`);
      continue;
    }
    for (const [token, value] of Object.entries(set)) {
      if (typeof value !== 'string' || value.length === 0) {
        errors.push(`${label}/theme.json: tokens.${scheme}.${token} must be a non-empty string`);
      }
    }
  }

  const files = await collectFiles(root, `themes/${id}`, errors, label);
  const assets = files.filter((file) => file.path.startsWith(`themes/${id}/assets/`));
  for (const file of assets) {
    const name = file.path.slice(`themes/${id}/assets/`.length);
    if (name.includes('/') || !IMAGE_RE.test(name)) {
      errors.push(`${label}: assets/${name} must be background.<ext> or preview.<ext>`);
    }
  }
  if (!files.some((file) => file.path === `themes/${id}/theme.json`)) {
    errors.push(`${label}: theme.json is required`);
  }
  const image = manifest.background?.image;
  if (typeof image === 'string' && image.length > 0) {
    if (!assets.some((file) => file.path === `themes/${id}/assets/${image}`)) {
      errors.push(`${label}: theme.json names "${image}" but assets/${image} is missing`);
    }
  }
  return finishEntry('themes', id, files, manifest, errors);
}

async function loadMcp(root, id, errors) {
  const label = `mcp/${id}.json`;
  const manifest = await readJson(path.join(root, 'mcp', `${id}.json`), label, errors);
  if (!manifest) return null;
  checkCommon(manifest, id, label, errors);

  const transport = manifest.transport;
  if (!transport || typeof transport !== 'object') {
    errors.push(`${label}: transport is required`);
  } else if (transport.type === 'stdio') {
    if (typeof transport.command !== 'string' || transport.command.length === 0) {
      errors.push(`${label}: stdio transport needs a command`);
    }
    if (transport.url !== undefined) errors.push(`${label}: stdio transport must not carry a url`);
  } else if (transport.type === 'http') {
    if (typeof transport.url !== 'string' || !/^https:\/\//.test(transport.url)) {
      errors.push(`${label}: http transport needs an https url`);
    }
    if (transport.command !== undefined) {
      errors.push(`${label}: http transport must not carry a command`);
    }
  } else {
    errors.push(`${label}: transport.type must be stdio or http`);
  }

  const bytes = await readFile(path.join(root, label));
  const files = [{ path: label, size: bytes.length, sha256: sha256(bytes), bytes }];
  return finishEntry('mcp', id, files, manifest, errors);
}

async function loadPlugin(root, id, errors) {
  const label = `plugins/${id}`;
  const dir = path.join(root, 'plugins', id);
  const manifest = await readJson(path.join(dir, 'plugin.json'), `${label}/plugin.json`, errors);
  if (!manifest) return null;
  checkCommon(manifest, id, `${label}/plugin.json`, errors);

  const native = await readJson(
    path.join(dir, 'package', 'reasonix-plugin.json'),
    `${label}/package/reasonix-plugin.json`,
    errors,
  );
  if (native) {
    if (native.apiVersion !== 'reasonix.io/plugin/v2') {
      errors.push(`${label}/package/reasonix-plugin.json: apiVersion must be reasonix.io/plugin/v2`);
    }
    if (native.name !== id) {
      errors.push(`${label}/package/reasonix-plugin.json: name must be "${id}"`);
    }
    if (native.version !== manifest.version) {
      errors.push(`${label}: plugin.json version must equal the package manifest version`);
    }
  } else {
    errors.push(`${label}: package/reasonix-plugin.json is required`);
  }

  const platforms = new Set();
  if (Array.isArray(manifest.binaries)) {
    for (const [index, binary] of manifest.binaries.entries()) {
      const at = `${label}/plugin.json: binaries[${index}]`;
      if (typeof binary?.sha256 !== 'string' || !SHA_RE.test(binary.sha256)) {
        errors.push(`${at}.sha256 must be 64 lowercase hex characters`);
      }
      if (!Number.isInteger(binary?.size) || binary.size < 1) {
        errors.push(`${at}.size must be a positive integer`);
      }
      if (platforms.has(binary?.platform)) {
        errors.push(`${at}.platform "${binary?.platform}" is declared twice`);
      }
      platforms.add(binary?.platform);
    }
  }

  const files = await collectFiles(root, `plugins/${id}`, errors, label);
  for (const required of ['plugin.json', 'package/reasonix-plugin.json']) {
    if (!files.some((file) => file.path === `plugins/${id}/${required}`)) {
      errors.push(`${label}: ${required} is required`);
    }
  }
  return finishEntry('plugins', id, files, manifest, errors);
}

export async function loadRevocations(root, errors) {
  const text = await readText(path.join(root, 'revoked.json'), 'revoked.json', errors);
  if (text === null) return new Map();
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    errors.push(`revoked.json: invalid JSON (${err.message})`);
    return new Map();
  }
  const list = doc?.revocations;
  if (!Array.isArray(list)) {
    errors.push('revoked.json: revocations must be an array');
    return new Map();
  }
  const byEntry = new Map();
  for (const [index, item] of list.entries()) {
    const at = `revoked.json: revocations[${index}]`;
    if (!KIND_ORDER.includes(item?.kind)) {
      errors.push(`${at}.kind must be one of ${KIND_ORDER.join(', ')}`);
      continue;
    }
    if (typeof item?.id !== 'string' || !ID_RE.test(item.id)) {
      errors.push(`${at}.id must be a valid entry id`);
      continue;
    }
    if (typeof item?.reason !== 'string' || item.reason.trim().length < 5) {
      errors.push(`${at}.reason is required`);
    }
    if (!Array.isArray(item?.versions) || item.versions.length === 0) {
      errors.push(`${at}.versions must be a non-empty array`);
      continue;
    }
    for (const version of item.versions) {
      if (version !== '*' && !SEMVER_RE.test(version)) {
        errors.push(`${at}.versions has "${version}", which is neither "*" nor semver`);
      }
    }
    const key = `${item.kind}/${item.id}`;
    const known = byEntry.get(key) ?? new Set();
    for (const version of item.versions) known.add(version);
    byEntry.set(key, known);
  }
  return byEntry;
}

export async function buildIndex(root = ROOT) {
  const errors = [];
  const warnings = [];
  const stats = [];
  const entries = [];
  const manifests = [];

  for (const kind of KIND_ORDER) {
    const kindDir = path.join(root, KIND_DIRS[kind]);
    const dirents = await listDir(kindDir);
    if (dirents === null) continue;

    if (kind === 'mcp') {
      for (const dirent of dirents) {
        if (!dirent.isFile() || !dirent.name.endsWith('.json')) continue;
        const id = dirent.name.slice(0, -'.json'.length);
        if (!ID_RE.test(id)) {
          errors.push(`mcp/${dirent.name}: file name is not a valid entry id`);
          continue;
        }
        const built = await loadMcp(root, id, errors);
        if (built) {
          entries.push(built.entry);
          stats.push(built.stats);
          manifests.push({ kind, id, label: `mcp/${id}.json`, document: built.manifest });
        }
      }
      continue;
    }

    const loaders = { skills: loadSkill, themes: loadTheme, plugins: loadPlugin };
    for (const dirent of dirents) {
      if (!dirent.isDirectory()) {
        errors.push(`${KIND_DIRS[kind]}/${dirent.name}: only entries directories belong here`);
        continue;
      }
      if (!ID_RE.test(dirent.name)) {
        errors.push(`${KIND_DIRS[kind]}/${dirent.name}: directory name is not a valid entry id`);
        continue;
      }
      const built = await loaders[kind](root, dirent.name, errors);
      if (built) {
        entries.push(built.entry);
        stats.push(built.stats);
        manifests.push({
          kind,
          id: dirent.name,
          label: `${KIND_DIRS[kind]}/${dirent.name}/${MANIFEST_NAME[kind]}`,
          document: built.manifest,
        });
      }
    }
  }

  const revocations = await loadRevocations(root, errors);
  for (const entry of entries) {
    const versions = revocations.get(`${entry.kind}/${entry.id}`);
    entry.revoked = Boolean(versions && (versions.has('*') || versions.has(entry.version)));
    if (versions && !entry.revoked) {
      warnings.push(
        `revoked.json: ${entry.kind}/${entry.id} revokes ${[...versions].join(', ')} but the tree holds ${entry.version}`,
      );
    }
  }
  for (const key of revocations.keys()) {
    if (!entries.some((entry) => `${entry.kind}/${entry.id}` === key)) {
      warnings.push(`revoked.json: ${key} has no entry; the row disappears from index.json`);
    }
  }

  entries.sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const index = { schemaVersion: 1, entries };
  return { index, text: `${JSON.stringify(index, null, 2)}\n`, errors, warnings, stats, manifests };
}

function firstDifference(expected, actual) {
  const a = expected.split('\n');
  const b = actual.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      return `line ${i + 1}:\n  expected: ${a[i] ?? '<end>'}\n  actual:   ${b[i] ?? '<end>'}`;
    }
  }
  return 'byte order differs';
}

async function main() {
  const flags = process.argv.slice(2);
  const unknown = flags.filter((flag) => !['--check', '--caps', '--write'].includes(flag));
  if (unknown.length > 0) {
    console.error(`usage: node scripts/build-index.mjs [--check|--caps]`);
    console.error(`unknown: ${unknown.join(' ')}`);
    process.exitCode = 2;
    return;
  }
  if (flags.includes('--check') && flags.includes('--caps')) {
    console.error('build-index: --check and --caps are separate runs');
    process.exitCode = 2;
    return;
  }

  const { text, errors, warnings, stats } = await buildIndex(ROOT);
  for (const warning of warnings) console.warn(`warning: ${warning}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`error: ${error}`);
    console.error(`\n${errors.length} problem(s); index.json was not written`);
    process.exitCode = 1;
    return;
  }

  if (flags.includes('--caps')) {
    console.log('entry'.padEnd(40), 'files'.padStart(5), 'bytes'.padStart(10), 'cap'.padStart(10));
    for (const entry of stats) {
      const cap = CAPS[entry.kind].entryBytes;
      console.log(
        `${entry.kind}/${entry.id}`.padEnd(40),
        String(entry.files).padStart(5),
        String(entry.bytes).padStart(10),
        String(cap).padStart(10),
      );
    }
    console.log(`\n${stats.length} entries within their caps`);
    return;
  }

  if (flags.includes('--check')) {
    const current = await readIndex(ROOT);
    if (current === null) {
      console.error('error: index.json is missing or unreadable; run node scripts/build-index.mjs');
      process.exitCode = 1;
      return;
    }
    if (current !== text) {
      console.error('error: index.json is stale');
      console.error(firstDifference(text, current));
      console.error('\nrun: node scripts/build-index.mjs');
      process.exitCode = 1;
      return;
    }
    console.log(`index.json is current (${stats.length} entries)`);
    return;
  }

  await writeFile(path.join(ROOT, 'index.json'), text);
  console.log(`wrote index.json (${stats.length} entries)`);
}

async function readIndex(root) {
  try {
    return await readFile(path.join(root, 'index.json'), 'utf8');
  } catch {
    return null;
  }
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invoked) {
  main().catch((err) => {
    console.error(`error: ${err.stack ?? err.message}`);
    process.exitCode = 1;
  });
}
