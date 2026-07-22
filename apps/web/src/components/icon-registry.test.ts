import { describe, it, expect } from 'vitest';
import { STATUS_TOKEN_REGISTRY } from '@techpioasset/ui-tokens';
import { ICON_REGISTRY, resolveIcon } from './icon-registry';

/**
 * A token naming an icon the registry does not export renders nothing at all -
 * a silent, easily-missed visual bug. Asserting the mapping here turns it into a
 * build failure.
 */
describe('icon registry', () => {
  it.each(STATUS_TOKEN_REGISTRY)('$name icons all resolve', ({ tokens }) => {
    for (const [key, token] of Object.entries(tokens)) {
      expect(resolveIcon(token.icon), `${key} -> ${token.icon} is not registered`).toBeDefined();
    }
  });

  it('exports a real component for every registered name', () => {
    for (const [name, Icon] of Object.entries(ICON_REGISTRY)) {
      expect(
        Icon,
        `${name} resolved to undefined - is it a valid lucide-react export?`,
      ).toBeTruthy();
    }
  });
});
