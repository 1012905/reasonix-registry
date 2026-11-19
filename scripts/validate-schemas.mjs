#!/usr/bin/env node
// Validates every manifest and index.json against schemas/. The validator below
// implements the JSON Schema subset these schemas use, so the gate needs no
// npm install and no lockfile to trust.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildIndex, ROOT } from './build-index.mjs';

const SCHEMAS = Object.freeze({
  mcp: 'mcp.schema.json',
  plugins: 'plugin.schema.json',
  skills: 'skill.schema.json',
  themes: 'theme.schema.json',
});

function typeMatches(value, type) {
  const wanted = Array.isArray(type) ? type : [type];
  return wanted.some((name) => {
    if (name === 'integer') return Number.isInteger(value);
    if (name === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (name === 'array') return Array.isArray(value);
    if (name === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
    if (name === 'null') return value === null;
    return typeof value === name;
  });
}

function validate(value, schema, at, errors) {
  if (!schema || typeof schema !== 'object') return;

  if ('const' in schema && value !== schema.const) {
    errors.push(`${at}: must equal ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.type && !typeMatches(value, schema.type)) {
    const wanted = Array.isArray(schema.type) ? schema.type.join(' or ') : schema.type;
    errors.push(`${at}: must be ${wanted}`);
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((allowed) => allowed === value)) {
    errors.push(`${at}: must be one of ${schema.enum.join(', ')}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${at}: must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${at}: must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${at}: does not match ${schema.pattern}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${at}: must be at least ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${at}: must be at most ${schema.maximum}`);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${at}: must hold at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${at}: must hold at most ${schema.maxItems} items`);
    }
    value.forEach((item, index) => validate(item, schema.items, `${at}[${index}]`, errors));
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${at}: missing required field "${key}"`);
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      if (key in properties) {
        validate(child, properties[key], `${at}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        errors.push(`${at}: unknown field "${key}"`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validate(child, schema.additionalProperties, `${at}.${key}`, errors);
      }
    }
  }
}

async function loadSchema(name, errors) {
  const file = path.join(ROOT, 'schemas', name);
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    errors.push(`schemas/${name}: ${err.message}`);
    return null;
  }
}

async function main() {
  const errors = [];
  const built = await buildIndex(ROOT);
  errors.push(...built.errors);

  const schemas = {};
  for (const [kind, name] of Object.entries(SCHEMAS)) {
    const schema = await loadSchema(name, errors);
    if (schema) schemas[kind] = schema;
  }
  const indexSchema = await loadSchema('index.schema.json', errors);

  let manifestCount = 0;
  for (const manifest of built.manifests) {
    const schema = schemas[manifest.kind];
    if (!schema) continue;
    validate(manifest.document, schema, manifest.label, errors);
    manifestCount += 1;
  }

  let indexChecked = false;
  try {
    const document = JSON.parse(await readFile(path.join(ROOT, 'index.json'), 'utf8'));
    if (indexSchema) {
      validate(document, indexSchema, 'index.json', errors);
      indexChecked = true;
    }
  } catch (err) {
    errors.push(`index.json: ${err.message}`);
  }

  for (const warning of built.warnings) console.warn(`warning: ${warning}`);
  if (errors.length > 0) {
    for (const error of errors) console.error(`error: ${error}`);
    console.error(`\n${errors.length} schema problem(s)`);
    process.exitCode = 1;
    return;
  }
  console.log(`schemas: ${manifestCount} manifests and ${indexChecked ? 'index.json' : 'no index'} validated`);
}

main().catch((err) => {
  console.error(`error: ${err.stack ?? err.message}`);
  process.exitCode = 1;
});
