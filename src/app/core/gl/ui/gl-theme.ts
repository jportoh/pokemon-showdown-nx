import { Service, computed, inject } from '@angular/core';
import { AppSettings, Appearance, ThemeId } from '@core/settings/app-settings';
import { Rgba, rgba } from '../gl-renderer';
import { PaletteRole, THEME_HEX, paletteHex } from './palettes';

export type { PaletteRole } from './palettes';

export type Palette = Readonly<Record<PaletteRole, Rgba>> & { readonly appearance: Appearance };

function buildPalette(appearance: Appearance, theme: ThemeId): Palette {
  const hexes = paletteHex(appearance, theme);
  const colours = Object.fromEntries(Object.entries(hexes).map(([role, hex]) => [role, rgba(hex)])) as Record<PaletteRole, Rgba>;
  return { ...colours, appearance };
}

const PALETTES = Object.fromEntries(
  (['dark', 'light'] as const).map((appearance) => [
    appearance,
    Object.fromEntries((Object.keys(THEME_HEX[appearance]) as ThemeId[]).map((theme) => [theme, buildPalette(appearance, theme)])),
  ]),
) as Record<Appearance, Record<ThemeId, Palette>>;

/**
 * A theme's swatch, where Settings shows the themes to choose from: its hue (the outline, which tints
 * its panels and borders) and its accent (the buttons, the highlights).
 */
export function themeSwatch(appearance: Appearance, theme: ThemeId): { hue: Rgba; accent: Rgba } {
  const palette = PALETTES[appearance][theme];
  return { hue: palette.outline, accent: palette.accent };
}

/** The palette of the theme and appearance chosen in Settings, for everything drawn on the canvas. */
@Service()
export class GlTheme {
  private readonly settings = inject(AppSettings);

  readonly palette = computed(() => {
    const { appearance, theme } = this.settings.settings();
    const palettes = PALETTES[appearance] ?? PALETTES.light;
    return palettes[theme] ?? palettes.zafiro;
  });
}
