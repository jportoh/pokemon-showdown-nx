import { Service, computed, inject } from '@angular/core';
import { AppSettings, Appearance, ThemeId } from '@core/settings/app-settings';
import { Rgba, rgba } from '../gl-renderer';

/** The roles each theme colours itself (its hue). */
type ThemeRole = 'bg' | 'bar' | 'panel' | 'outline' | 'rim' | 'select' | 'button' | 'input' | 'ink' | 'muted' | 'accent' | 'accentHover' | 'accentText' | 'danger' | 'teal' | 'hero';

/**
 * The roles only the appearance (light or dark) colours, the same in every theme: the focus ring, disabled
 * controls, the logo, the nature's lowered stat, the EV bars' free segments and `contrast`, the ink for
 * text on accentText/teal/danger fills.
 */
type ModeRole = 'focus' | 'disabledFill' | 'disabledBorder' | 'disabledInk' | 'logo' | 'logoInk' | 'lowered' | 'segmentFree' | 'contrast';

/** The retro palette's roles. */
export type PaletteRole = ThemeRole | ModeRole;

export type Palette = Readonly<Record<PaletteRole, Rgba>> & { readonly appearance: Appearance };

/**
 * Each theme's palettes, dark and light. Each was checked for WCAG AA: ink and muted on bg/panel/select/bar,
 * white on accent, accentText/danger/teal on bg, panel and bar. `hero` lights the home menu's trainer side
 * (the dark themes' select; a deeper tint of bg in the light ones, whose bg is a mid tone the near-white
 * panels stand out on).
 */
const THEME_HEX: Record<Appearance, Record<ThemeId, Record<ThemeRole, string>>> = {
  dark: {
    zafiro: {
      bg: '#0a1620', bar: '#050e16', panel: '#102332', outline: '#3f88ad', rim: '#1b3a50', select: '#1a4562', button: '#153246', input: '#071118',
      ink: '#e3f2fa', muted: '#9ec3d5', accent: '#0b76a0', accentHover: '#085f82', accentText: '#6fd3ff', danger: '#ff8a80', teal: '#ffc46b', hero: '#1a4562',
    },
    noche: {
      bg: '#121821', bar: '#0b1016', panel: '#1c2632', outline: '#5b7690', rim: '#2b3a4a', select: '#2c4157', button: '#26374a', input: '#0f151c',
      ink: '#e8eef3', muted: '#a9b8c6', accent: '#c94e39', accentHover: '#a83e2c', accentText: '#ff9a85', danger: '#ff8a80', teal: '#7fd1b9', hero: '#2c4157',
    },
    grafito: {
      bg: '#131517', bar: '#0b0c0e', panel: '#1d2023', outline: '#70767e', rim: '#2d3135', select: '#363b40', button: '#272b2f', input: '#0e1011',
      ink: '#ececee', muted: '#b3b8be', accent: '#56616d', accentHover: '#46505a', accentText: '#c3ccd6', danger: '#ff8a80', teal: '#f0c86b', hero: '#363b40',
    },
    esmeralda: {
      bg: '#0e1915', bar: '#08110d', panel: '#15261e', outline: '#4f8f6d', rim: '#22392d', select: '#23432f', button: '#1d3427', input: '#0a130f',
      ink: '#e5f3ea', muted: '#a5c4b2', accent: '#b8432b', accentHover: '#963522', accentText: '#ff9f80', danger: '#ff8a80', teal: '#f0d36b', hero: '#23432f',
    },
    pokeball: {
      bg: '#151313', bar: '#0c0b0b', panel: '#221e1e', outline: '#7a6f6f', rim: '#342e2e', select: '#403434', button: '#2d2727', input: '#0f0e0e',
      ink: '#f3efef', muted: '#c0b6b6', accent: '#c62a2a', accentHover: '#a32121', accentText: '#ff8f85', danger: '#ffa24d', teal: '#ffd35c', hero: '#403434',
    },
    ocaso: {
      bg: '#12122a', bar: '#0a0a1b', panel: '#1c1c3c', outline: '#6f6fc0', rim: '#2b2b55', select: '#30305f', button: '#24244a', input: '#0c0c1f',
      ink: '#eceaff', muted: '#b4b2de', accent: '#c0400f', accentHover: '#9e340c', accentText: '#ffa577', danger: '#ff8a9a', teal: '#7de3cf', hero: '#30305f',
    },
  },
  light: {
    zafiro: {
      bg: '#b9d0df', bar: '#d3e3ee', panel: '#f7fbfd', outline: '#3f88ad', rim: '#c4dbe8', select: '#cfe6f3', button: '#e2eef5', input: '#ffffff',
      ink: '#0d2230', muted: '#2c4757', accent: '#0b76a0', accentHover: '#085f82', accentText: '#075a7c', danger: '#a4231b', teal: '#7b4a00', hero: '#8dbcd8',
    },
    noche: {
      bg: '#c6ced6', bar: '#dde3e9', panel: '#fafbfc', outline: '#5b7690', rim: '#d3dbe3', select: '#d5e0ea', button: '#e6ebf0', input: '#ffffff',
      ink: '#141c25', muted: '#344352', accent: '#c94e39', accentHover: '#a83e2c', accentText: '#943727', danger: '#a4231b', teal: '#16604a', hero: '#a0b2c5',
    },
    grafito: {
      bg: '#c7c9cc', bar: '#dfe1e3', panel: '#fafafa', outline: '#6f747b', rim: '#d6d8db', select: '#dde0e3', button: '#e8e9eb', input: '#ffffff',
      ink: '#17191b', muted: '#3d4146', accent: '#56616d', accentHover: '#46505a', accentText: '#3e4751', danger: '#9b211a', teal: '#6d4a00', hero: '#a8adb3',
    },
    esmeralda: {
      bg: '#bed9ca', bar: '#d5e8dd', panel: '#f8fcf9', outline: '#4f8f6d', rim: '#c8e0d2', select: '#cde6d6', button: '#e2f0e7', input: '#ffffff',
      ink: '#0f2219', muted: '#2a4637', accent: '#b8432b', accentHover: '#963522', accentText: '#963522', danger: '#aa241d', teal: '#725400', hero: '#97ceb0',
    },
    pokeball: {
      bg: '#d2caca', bar: '#e5dfdf', panel: '#fcfbfb', outline: '#7a6f6f', rim: '#ddd6d6', select: '#e8dcdc', button: '#eee8e8', input: '#ffffff',
      ink: '#1d1818', muted: '#443838', accent: '#c62a2a', accentHover: '#a32121', accentText: '#a32121', danger: '#8d3d00', teal: '#6d5100', hero: '#bea7a7',
    },
    ocaso: {
      bg: '#bebee1', bar: '#dcdcf0', panel: '#fbfbfe', outline: '#6f6fc0', rim: '#d3d3ec', select: '#d8d8f2', button: '#e6e6f6', input: '#ffffff',
      ink: '#16163a', muted: '#3a3a5f', accent: '#c0400f', accentHover: '#9e340c', accentText: '#8b2e0b', danger: '#951e30', teal: '#13584d', hero: '#8d8dd8',
    },
  },
};

/** The appearance's own colours; a null `contrast` is each theme's bar (dark ink on the bright fills). */
const MODE_HEX: Record<Appearance, Record<Exclude<ModeRole, 'contrast'>, string> & { contrast: string | null }> = {
  dark: {
    focus: '#facc15', disabledFill: '#374151', disabledBorder: '#4b5563', disabledInk: '#9ca3af',
    logo: '#f2c14e', logoInk: '#ffffff', lowered: '#8fb8ee', segmentFree: '#3d5064', contrast: null,
  },
  light: {
    focus: '#b45309', disabledFill: '#e5e7eb', disabledBorder: '#d1d5db', disabledInk: '#6b7280',
    logo: '#a86f00', logoInk: '#0d2230', lowered: '#2f5f9e', segmentFree: '#b6c4d1', contrast: '#ffffff',
  },
};

function buildPalette(appearance: Appearance, theme: ThemeId): Palette {
  const themeHex = THEME_HEX[appearance][theme];
  const { contrast, ...mode } = MODE_HEX[appearance];
  const hexes: Record<PaletteRole, string> = { ...themeHex, ...mode, contrast: contrast ?? themeHex.bar };
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
