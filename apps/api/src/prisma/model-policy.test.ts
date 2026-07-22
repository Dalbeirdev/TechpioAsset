import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  SOFT_DELETABLE_MODELS,
  UNDELETABLE_MODELS,
  UndeletableModelError,
} from './model-policy.js';

/**
 * These lists drive runtime behaviour but live separately from the schema, so
 * they can silently drift: add `deletedAt` to a model and forget the list, and
 * archived rows keep appearing in every query. Parsing the schema and comparing
 * turns that into a test failure.
 */
const schemaPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../prisma/schema.prisma',
);
const schema = readFileSync(schemaPath, 'utf8');

interface ParsedModel {
  name: string;
  body: string;
}

function parseModels(source: string): ParsedModel[] {
  const models: ParsedModel[] = [];
  const pattern = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    models.push({ name: match[1] as string, body: match[2] as string });
  }
  return models;
}

const models = parseModels(schema);
const modelNames = new Set(models.map((m) => m.name));
const modelsWithDeletedAt = new Set(
  models.filter((m) => /^\s*deletedAt\s+DateTime\?/m.test(m.body)).map((m) => m.name),
);

describe('schema parsing sanity', () => {
  it('found the schema and a plausible number of models', () => {
    expect(models.length).toBeGreaterThan(40);
  });
});

describe('soft-deletable model list', () => {
  it('names only models that exist', () => {
    for (const name of SOFT_DELETABLE_MODELS) {
      expect(modelNames.has(name), `${name} is listed but not in schema.prisma`).toBe(true);
    }
  });

  it('names only models that actually have a deletedAt column', () => {
    for (const name of SOFT_DELETABLE_MODELS) {
      expect(modelsWithDeletedAt.has(name), `${name} is listed but has no deletedAt field`).toBe(
        true,
      );
    }
  });

  it('covers every model that has a deletedAt column', () => {
    const missing = [...modelsWithDeletedAt].filter((name) => !SOFT_DELETABLE_MODELS.has(name));
    expect(
      missing,
      `these models have deletedAt but are not filtered: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});

describe('undeletable model list', () => {
  it('names only models that exist', () => {
    for (const name of UNDELETABLE_MODELS) {
      expect(modelNames.has(name), `${name} is listed but not in schema.prisma`).toBe(true);
    }
  });

  it('does not overlap the soft-deletable list', () => {
    const overlap = [...UNDELETABLE_MODELS].filter((name) => SOFT_DELETABLE_MODELS.has(name));
    expect(overlap, `a model cannot be both append-only and soft-deletable: ${overlap}`).toEqual(
      [],
    );
  });

  it('protects the records spec section 22 names explicitly', () => {
    for (const name of ['AuditLog', 'AssetAssignment', 'AssetTransfer', 'DisposalRecord']) {
      expect(UNDELETABLE_MODELS.has(name), `${name} must be append-only`).toBe(true);
    }
  });
});

describe('UndeletableModelError', () => {
  it('names the model and the attempted operation', () => {
    const error = new UndeletableModelError('AuditLog', 'delete');
    expect(error.message).toContain('AuditLog');
    expect(error.message).toContain('deleted');
    expect(error.name).toBe('UndeletableModelError');
  });
});
