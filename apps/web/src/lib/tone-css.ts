import { TONES, TONE_PALETTE_LIGHT, TONE_PALETTE_DARK } from '@techpioasset/ui-tokens';

/**
 * Emits the status-tone palette as CSS custom properties.
 *
 * Generated from the shared token package rather than hand-copied into the
 * stylesheet, so spec section 7's "consistent colors and icons throughout the web
 * and mobile applications" cannot quietly break when a tone is retuned - there is
 * one place to change and both clients read it.
 */
export function buildToneCss(): string {
  const block = (palette: typeof TONE_PALETTE_LIGHT) =>
    TONES.map((tone) => {
      const { fg, bg, border, solid } = palette[tone];
      return [
        `--tone-${tone}-fg:${fg}`,
        `--tone-${tone}-bg:${bg}`,
        `--tone-${tone}-border:${border}`,
        `--tone-${tone}-solid:${solid}`,
      ].join(';');
    }).join(';');

  return `:root{${block(TONE_PALETTE_LIGHT)}}.dark{${block(TONE_PALETTE_DARK)}}`;
}
