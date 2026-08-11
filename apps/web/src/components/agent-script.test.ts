import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The portal serves the Windows agent at /downloads/TechpioAgent.ps1 so the
 * install one-liner works on a machine that has nothing yet. That file is a
 * committed copy of the canonical script in agent/windows/ - and a copy that
 * can drift hands out a stale agent from the very page that documents the
 * current one. This test is what makes the copy safe to have.
 */
describe('served agent script', () => {
  it('is byte-identical to the canonical script in agent/windows/', () => {
    const root = path.resolve(import.meta.dirname, '../../../..');
    const canonical = readFileSync(path.join(root, 'agent/windows/TechpioAgent.ps1'), 'utf8');
    const served = readFileSync(
      path.join(root, 'apps/web/public/downloads/TechpioAgent.ps1'),
      'utf8',
    );
    expect(served).toBe(canonical);
  });
});
