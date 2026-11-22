import { Service, computed, inject } from '@angular/core';
import { AppSettings, Appearance, ThemeId } from '@core/settings/app-settings';
import { Rgba, rgba } from '../gl-renderer';

/** The roles each theme colours itself (its hue). */
type ThemeRole = 'bg' | 'bar' | 'panel' | 'outline' | 'rim' | 'select' | 'button' | 'input' | 'ink' | 'muted' | 'accent' | 'accentHover' | 'accentText' | 'danger' | 'teal';

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
 * Each theme's palettes, dark and light. Each was checked for WCAG AA: ink and muted on panel/select/bar,
 * white on accent, accentText/danger/teal on panel and bar.
 */
const THEME_HEX: Record<Appearance, Record<ThemeId, Record<ThemeRole, string>>> = {
  dark: {
    zafiro: {
      bg: '#0a1620', bar: '#050e16', panel: '#102332', outline: '#3f88ad', rim: '#1b3a50', select: '#1a4562', button: '#153246', input: '#071118',
      ink: '#e3f2fa', muted: '#9ec3d5', accent: '#0b76a0', accentHover: '#085f82', accentText: '#6fd3ff', danger: '#ff8a80', teal: '#ffc46b',
    },
    noche: {
      bg: '#121821', bar: '#0b1016', panel: '#1c2632', outline: '#5b7690', rim: '#2b3a4a', select: '#2c4157', button: '#26374a', input: '#0f151c',
      ink: '#e8eef3', muted: '#a9b8c6', accent: '#c94e39', accentHover: '#a83e2c', accentText: '#ff9a85', danger: '#ff8a80', teal: '#7fd1b9',
    },
    ciruela: {
      bg: '#16111e', bar: '#0d0913', panel: '#221a2e', outline: '#8467b0', rim: '#352946', select: '#3c2d55', button: '#2d2240', input: '#110c17',
      ink: '#f1ebf8', muted: '#bcb0cf', accent: '#b8336a', accentHover: '#982955', accentText: '#ff8cc0', danger: '#ff8a80', teal: '#f3c56b',
    },
    esmeralda: {
      bg: '#0e1915', bar: '#08110d', panel: '#15261e', outline: '#4f8f6d', rim: '#22392d', select: '#23432f', button: '#1d3427', input: '#0a130f',
      ink: '#e5f3ea', muted: '#a5c4b2', accent: '#b8432b', accentHover: '#963522', accentText: '#ff9f80', danger: '#ff8a80', teal: '#f0d36b',
    },
    pokeball: {
      bg: '#151313', bar: '#0c0b0b', panel: '#221e1e', outline: '#7a6f6f', rim: '#342e2e', select: '#403434', button: '#2d2727', input: '#0f0e0e',
      ink: '#f3efef', muted: '#c0b6b6', accent: '#c62a2a', accentHover: '#a32121', accentText: '#ff8f85', danger: '#ffa24d', teal: '#ffd35c',
    },
    ocaso: {
      bg: '#12122a', bar: '#0a0a1b', panel: '#1c1c3c', outline: '#6f6fc0', rim: '#2b2b55', select: '#30305f', button: '#24244a', input: '#0c0c1f',
      ink: '#eceaff', muted: '#b4b2de', accent: '#c0400f', accentHover: '#9e340c', accentText: '#ffa577', danger: '#ff8a9a', teal: '#7de3cf',
    },
  },
  light: {
    zafiro: {
      bg: '#e6eff5', bar: '#d3e3ee', panel: '#f7fbfd', outline: '#3f88ad', rim: '#c4dbe8', select: '#cfe6f3', button: '#e2eef5', input: '#ffffff',
      ink: '#0d2230', muted: '#3f5f72', accent: '#0b76a0', accentHover: '#085f82', accentText: '#075a7c', danger: '#b3261e', teal: '#8a5300',
    },
    noche: {
      bg: '#eceff2', bar: '#dde3e9', panel: '#fafbfc', outline: '#5b7690', rim: '#d3dbe3', select: '#d5e0ea', button: '#e6ebf0', input: '#ffffff',
      ink: '#141c25', muted: '#4a5a6a', accent: '#c94e39', accentHover: '#a83e2c', accentText: '#a83e2c', danger: '#b3261e', teal: '#17664f',
    },
    ciruela: {
      bg: '#f0ebf5', bar: '#e4dced', panel: '#fcfafd', outline: '#8467b0', rim: '#ddd2e8', select: '#e3d6f0', button: '#ece4f3', input: '#ffffff',
      ink: '#1e1428', muted: '#5a4b6c', accent: '#b8336a', accentHover: '#982955', accentText: '#982955', danger: '#b3261e', teal: '#8a5300',
    },
    esmeralda: {
      bg: '#e7f2ec', bar: '#d5e8dd', panel: '#f8fcf9', outline: '#4f8f6d', rim: '#c8e0d2', select: '#cde6d6', button: '#e2f0e7', input: '#ffffff',
      ink: '#0f2219', muted: '#3f5f4e', accent: '#b8432b', accentHover: '#963522', accentText: '#963522', danger: '#b3261e', teal: '#7a5a00',
    },
    pokeball: {
      bg: '#f1eeee', bar: '#e5dfdf', panel: '#fcfbfb', outline: '#7a6f6f', rim: '#ddd6d6', select: '#e8dcdc', button: '#eee8e8', input: '#ffffff',
      ink: '#1d1818', muted: '#5a5050', accent: '#c62a2a', accentHover: '#a32121', accentText: '#a32121', danger: '#923f00', teal: '#7a5a00',
    },
    ocaso: {
      bg: '#ebebf7', bar: '#dcdcf0', panel: '#fbfbfe', outline: '#6f6fc0', rim: '#d3d3ec', select: '#d8d8f2', button: '#e6e6f6', input: '#ffffff',
      ink: '#16163a', muted: '#4f4f78', accent: '#c0400f', accentHover: '#9e340c', accentText: '#9e340c', danger: '#b3243a', teal: '#16675a',
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
